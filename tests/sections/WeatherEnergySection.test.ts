// ============================================================================
// Tests — WeatherEnergySection
// ============================================================================
// These tests pin down the public contract of `createWeatherSection` and
// `createEnergySection` (incl. PR #225's `show_*_card` toggles and
// `weather_sensors` array). They run as pure functions — no DOM, no Lit,
// no HA runtime.
// ============================================================================

import { describe, it, expect } from 'vitest';

import {
  createEnergySection,
  createWeatherSection,
} from '../../src/sections/WeatherEnergySection';

describe('createWeatherSection — base behaviour', () => {
  it('returns null when no weather entity is available', () => {
    expect(createWeatherSection(null, true)).toBeNull();
  });

  it('returns null when show_weather is false', () => {
    expect(createWeatherSection('weather.home', false)).toBeNull();
  });

  it('returns heading + forecast for happy path', () => {
    const s = createWeatherSection('weather.home', true);
    expect(s).not.toBeNull();
    expect(s).toMatchObject({
      type: 'grid',
      cards: [
        expect.objectContaining({ type: 'heading' }),
        expect.objectContaining({ type: 'weather-forecast', entity: 'weather.home' }),
      ],
    });
  });

  it('uses the daily forecast variant', () => {
    const s = createWeatherSection('weather.home', true);
    const f = s?.cards?.find((c) => c.type === 'weather-forecast');
    expect(f).toMatchObject({ forecast_type: 'daily' });
  });
});

describe('createWeatherSection — show_weather_forecast_card', () => {
  it('omits the forecast card when showForecastCard=false', () => {
    const s = createWeatherSection('weather.home', true, false);
    expect(s).not.toBeNull();
    expect(s?.cards?.some((c) => c.type === 'weather-forecast')).toBe(false);
    expect(s?.cards?.some((c) => c.type === 'heading')).toBe(true);
  });

  it('still returns the section so target_section=weather cards have a home', () => {
    const s = createWeatherSection('weather.home', true, false);
    expect(s?.type).toBe('grid');
    expect(s?.cards).toBeDefined();
    expect(s?.cards?.length).toBeGreaterThan(0);
  });

  it('defaults showForecastCard to true (omitted = backwards-compatible)', () => {
    const s = createWeatherSection('weather.home', true);
    expect(s?.cards?.some((c) => c.type === 'weather-forecast')).toBe(true);
  });
});

describe('createWeatherSection — weather_sensors', () => {
  it('omits the sensor row when array is empty', () => {
    const s = createWeatherSection('weather.home', true, true, []);
    expect(s?.cards?.some((c) => c.type === 'markdown')).toBe(false);
  });

  it('omits the sensor row when array is omitted entirely', () => {
    const s = createWeatherSection('weather.home', true, true);
    expect(s?.cards?.some((c) => c.type === 'markdown')).toBe(false);
  });

  it('renders a markdown row containing each entity state template', () => {
    const s = createWeatherSection('weather.home', true, true, [
      { entity: 'sensor.outdoor_temperature', icon: 'mdi:thermometer', unit: '°C' },
      { entity: 'sensor.outdoor_humidity', icon: 'mdi:water-percent', unit: '%' },
    ]);
    const md = s?.cards?.find((c) => c.type === 'markdown');
    expect(md).toBeDefined();
    expect(md).toMatchObject({ text_only: true });
    expect((md as { content: string }).content).toContain('sensor.outdoor_temperature');
    expect((md as { content: string }).content).toContain('sensor.outdoor_humidity');
    expect((md as { content: string }).content).toContain('mdi:thermometer');
    expect((md as { content: string }).content).toContain('°C');
  });

  it('places the sensor row BEFORE the forecast card', () => {
    const s = createWeatherSection('weather.home', true, true, [
      { entity: 'sensor.foo' },
    ]);
    const cards = s?.cards || [];
    const mdIdx = cards.findIndex((c) => c.type === 'markdown');
    const fcIdx = cards.findIndex((c) => c.type === 'weather-forecast');
    expect(mdIdx).toBeGreaterThan(-1);
    expect(fcIdx).toBeGreaterThan(-1);
    expect(mdIdx).toBeLessThan(fcIdx);
  });

  it('renders sensor row even when forecast card is disabled', () => {
    const s = createWeatherSection('weather.home', true, false, [
      { entity: 'sensor.foo' },
    ]);
    expect(s?.cards?.some((c) => c.type === 'markdown')).toBe(true);
    expect(s?.cards?.some((c) => c.type === 'weather-forecast')).toBe(false);
  });

  it('applies round filter to the template when round is provided', () => {
    const s = createWeatherSection('weather.home', true, true, [
      { entity: 'sensor.wind', round: 1 },
    ]);
    const md = s?.cards?.find((c) => c.type === 'markdown') as { content: string };
    expect(md.content).toContain('| float(0) | round(1)');
  });

  it('falls back to mdi:gauge when icon is missing', () => {
    const s = createWeatherSection('weather.home', true, true, [
      { entity: 'sensor.foo' },
    ]);
    const md = s?.cards?.find((c) => c.type === 'markdown') as { content: string };
    expect(md.content).toContain('mdi:gauge');
  });
});

describe('createWeatherSection — weather_sensors validation (security)', () => {
  it('drops entries with malformed entity ids', () => {
    const s = createWeatherSection('weather.home', true, true, [
      { entity: 'sensor.valid_one' },
      { entity: 'NOT VALID' },
      { entity: 'sensor.UPPER' }, // entity ids must be lowercase
      { entity: '") + states("other") + ("' }, // template injection attempt
      { entity: 'sensor.valid_two' },
    ]);
    const md = s?.cards?.find((c) => c.type === 'markdown') as { content: string };
    expect(md.content).toContain('sensor.valid_one');
    expect(md.content).toContain('sensor.valid_two');
    expect(md.content).not.toContain('NOT VALID');
    expect(md.content).not.toContain('sensor.UPPER');
    expect(md.content).not.toContain('states("other")');
  });

  it('does not render markdown row if every entry is invalid', () => {
    const s = createWeatherSection('weather.home', true, true, [
      { entity: 'no dot here' },
      { entity: '' },
      // @ts-expect-error — runtime-malformed config
      { icon: 'mdi:gauge' }, // missing entity
    ]);
    // Section still exists (heading + forecast) but no markdown
    expect(s).not.toBeNull();
    expect(s?.cards?.some((c) => c.type === 'markdown')).toBe(false);
  });

  it('falls back to mdi:gauge when icon contains attribute break-out', () => {
    const s = createWeatherSection('weather.home', true, true, [
      { entity: 'sensor.foo', icon: 'mdi:bug" onerror="alert(1)' },
    ]);
    const md = s?.cards?.find((c) => c.type === 'markdown') as { content: string };
    expect(md.content).not.toContain('onerror');
    expect(md.content).toContain('mdi:gauge');
  });

  it('falls back to mdi:gauge when icon has uppercase / underscores', () => {
    const s = createWeatherSection('weather.home', true, true, [
      { entity: 'sensor.foo', icon: 'MDI:THERMOMETER' },
      { entity: 'sensor.bar', icon: 'mdi:has_underscores' },
    ]);
    const md = s?.cards?.find((c) => c.type === 'markdown') as { content: string };
    expect(md.content).not.toContain('MDI:');
    expect(md.content).not.toContain('has_underscores');
    expect((md.content.match(/mdi:gauge/g) || []).length).toBe(2);
  });

  it('HTML-escapes the unit field', () => {
    const s = createWeatherSection('weather.home', true, true, [
      { entity: 'sensor.foo', unit: '<script>alert(1)</script>' },
      { entity: 'sensor.bar', unit: '"&\'<>' },
    ]);
    const md = s?.cards?.find((c) => c.type === 'markdown') as { content: string };
    expect(md.content).not.toContain('<script>');
    expect(md.content).toContain('&lt;script&gt;');
    expect(md.content).toContain('&quot;');
    expect(md.content).toContain('&amp;');
    expect(md.content).toContain('&#39;');
  });

  it('ignores non-integer round values', () => {
    const s = createWeatherSection('weather.home', true, true, [
      // @ts-expect-error — runtime-malformed config
      { entity: 'sensor.foo', round: 'one' },
      // @ts-expect-error — runtime-malformed config
      { entity: 'sensor.bar', round: 1.5 },
      { entity: 'sensor.baz', round: -1 },
    ]);
    const md = s?.cards?.find((c) => c.type === 'markdown') as { content: string };
    expect(md.content).not.toContain('round(');
    expect(md.content).toContain('sensor.foo');
    expect(md.content).toContain('sensor.bar');
    expect(md.content).toContain('sensor.baz');
  });
});

describe('createEnergySection', () => {
  it('returns null when show_energy is false', () => {
    expect(createEnergySection(false)).toBeNull();
  });

  it('returns heading + energy-distribution by default', () => {
    const s = createEnergySection(true);
    expect(s).toMatchObject({
      type: 'grid',
      cards: [
        expect.objectContaining({ type: 'heading' }),
        expect.objectContaining({ type: 'energy-distribution' }),
      ],
    });
  });

  it('respects link_dashboard parameter', () => {
    expect(
      createEnergySection(true, true)?.cards?.find((c) => c.type === 'energy-distribution')
    ).toMatchObject({ link_dashboard: true });
    expect(
      createEnergySection(true, false)?.cards?.find((c) => c.type === 'energy-distribution')
    ).toMatchObject({ link_dashboard: false });
  });

  it('omits distribution card when showDistributionCard=false', () => {
    const s = createEnergySection(true, true, false);
    expect(s?.cards?.some((c) => c.type === 'energy-distribution')).toBe(false);
    expect(s?.cards?.some((c) => c.type === 'heading')).toBe(true);
  });

  it('defaults showDistributionCard to true (backwards-compatible)', () => {
    const s = createEnergySection(true, true);
    expect(s?.cards?.some((c) => c.type === 'energy-distribution')).toBe(true);
  });
});
