// ============================================================================
// Tests — PollenWatch helpers
// ============================================================================
// Locks down the source-specific scaling that drives card colour and the
// weather-card badge gating. Each test passes a synthetic hass-like
// fixture so behaviour is deterministic without depending on the live HA
// instance.
// ============================================================================

import { describe, it, expect } from 'vitest';

import {
  detectAvailableSources,
  detectAvailableTypes,
  detectPollenwatchInstalled,
  isActivePollen,
  pollenIcon,
  pollenLevel,
  pollenSensorId,
  pollenSeverityColor,
  resolvePollenTypes,
} from '../../src/utils/pollen';
import type { HassEntity } from '../../src/types/homeassistant';
import type { PollenSource, PollenType } from '../../src/types/strategy';
import { makeHass } from '../fixtures/hass';

function st(entity_id: string, state: string, unit?: string): HassEntity {
  return {
    entity_id,
    state,
    attributes: unit ? { unit_of_measurement: unit, state_class: 'measurement' } : {},
    last_changed: '2026-05-29T00:00:00Z',
    last_updated: '2026-05-29T00:00:00Z',
    context: { id: '', user_id: null, parent_id: null },
  } as HassEntity;
}

const SOURCES: PollenSource[] = ['analytics', 'open_meteo', 'polleninformation', 'google'];

describe('pollenSensorId', () => {
  it('routes analytics through the _consensus suffix', () => {
    expect(pollenSensorId('analytics', 'grass')).toBe(
      'sensor.pollenwatch_analytics_grass_consensus',
    );
  });

  it.each(SOURCES.filter((s) => s !== 'analytics'))(
    'builds <prefix><type> for %s',
    (src) => {
      expect(pollenSensorId(src, 'birch')).toBe(`sensor.pollenwatch_${src}_birch`);
    },
  );
});

describe('detectPollenwatchInstalled', () => {
  it('is true when any pollenwatch sensor exists', () => {
    const hass = makeHass({
      entities: [{ entity_id: 'sensor.pollenwatch_open_meteo_grass' }],
    });
    expect(detectPollenwatchInstalled(hass)).toBe(true);
  });

  it('is false on an instance without pollenwatch', () => {
    const hass = makeHass({ entities: [{ entity_id: 'sensor.living_room_temp' }] });
    expect(detectPollenwatchInstalled(hass)).toBe(false);
  });
});

describe('detectAvailableSources', () => {
  it('returns only sources whose prefix matches at least one sensor', () => {
    const hass = makeHass({
      entities: [
        { entity_id: 'sensor.pollenwatch_open_meteo_grass' },
        { entity_id: 'sensor.pollenwatch_analytics_grass_consensus' },
      ],
    });
    expect(detectAvailableSources(hass)).toEqual(['analytics', 'open_meteo']);
  });
});

describe('detectAvailableTypes', () => {
  it('lists only pollens with a sensor for the chosen source', () => {
    const hass = makeHass({
      entities: [
        { entity_id: 'sensor.pollenwatch_open_meteo_grass' },
        { entity_id: 'sensor.pollenwatch_open_meteo_birch' },
        { entity_id: 'sensor.pollenwatch_polleninformation_ragweed' },
      ],
    });
    expect(detectAvailableTypes(hass, 'open_meteo')).toEqual(['birch', 'grass']);
    expect(detectAvailableTypes(hass, 'polleninformation')).toEqual(['ragweed']);
    expect(detectAvailableTypes(hass, 'google')).toEqual([]);
  });
});

describe('resolvePollenTypes', () => {
  const hass = makeHass({
    entities: [
      { entity_id: 'sensor.pollenwatch_analytics_grass_consensus' },
      { entity_id: 'sensor.pollenwatch_analytics_birch_consensus' },
    ],
  });

  it('falls back to all detected types when config is empty', () => {
    expect(resolvePollenTypes(hass, 'analytics', undefined)).toEqual(['birch', 'grass']);
    expect(resolvePollenTypes(hass, 'analytics', [])).toEqual(['birch', 'grass']);
  });

  it('drops configured types with no backing sensor', () => {
    const configured: PollenType[] = ['grass', 'olive', 'birch'];
    expect(resolvePollenTypes(hass, 'analytics', configured)).toEqual(['grass', 'birch']);
  });
});

describe('pollenLevel — analytics', () => {
  it('passes through low/medium/high/none enums', () => {
    expect(pollenLevel('analytics', st('x', 'low'))).toBe('low');
    expect(pollenLevel('analytics', st('x', 'medium'))).toBe('medium');
    expect(pollenLevel('analytics', st('x', 'high'))).toBe('high');
    expect(pollenLevel('analytics', st('x', 'none'))).toBe('none');
  });

  it('is case-insensitive', () => {
    expect(pollenLevel('analytics', st('x', 'HIGH'))).toBe('high');
  });

  it('returns null for unknown enum values', () => {
    expect(pollenLevel('analytics', st('x', 'wat'))).toBe(null);
    expect(pollenLevel('analytics', st('x', 'unavailable'))).toBe(null);
  });
});

describe('pollenLevel — polleninformation (0–4)', () => {
  it('buckets the Austrian scale', () => {
    expect(pollenLevel('polleninformation', st('x', '0'))).toBe('none');
    expect(pollenLevel('polleninformation', st('x', '1'))).toBe('low');
    expect(pollenLevel('polleninformation', st('x', '2'))).toBe('medium');
    expect(pollenLevel('polleninformation', st('x', '3'))).toBe('high');
    expect(pollenLevel('polleninformation', st('x', '4'))).toBe('high');
  });
});

describe('pollenLevel — google (0–5)', () => {
  it('buckets the Google scale', () => {
    expect(pollenLevel('google', st('x', '0'))).toBe('none');
    expect(pollenLevel('google', st('x', '1'))).toBe('low');
    expect(pollenLevel('google', st('x', '2'))).toBe('low');
    expect(pollenLevel('google', st('x', '3'))).toBe('medium');
    expect(pollenLevel('google', st('x', '4'))).toBe('high');
    expect(pollenLevel('google', st('x', '5'))).toBe('high');
  });
});

describe('pollenLevel — open_meteo grains/m³', () => {
  it('uses the heuristic thresholds', () => {
    expect(pollenLevel('open_meteo', st('x', '0', 'grains/m³'))).toBe('none');
    expect(pollenLevel('open_meteo', st('x', '5', 'grains/m³'))).toBe('low');
    expect(pollenLevel('open_meteo', st('x', '15', 'grains/m³'))).toBe('medium');
    expect(pollenLevel('open_meteo', st('x', '90', 'grains/m³'))).toBe('high');
  });
});

describe('isActivePollen', () => {
  it('treats medium and high as active', () => {
    expect(isActivePollen('high')).toBe(true);
    expect(isActivePollen('medium')).toBe(true);
  });
  it('treats low/none/null as quiet', () => {
    expect(isActivePollen('low')).toBe(false);
    expect(isActivePollen('none')).toBe(false);
    expect(isActivePollen(null)).toBe(false);
  });
});

describe('pollenSeverityColor', () => {
  it('maps severity buckets to palette tokens', () => {
    expect(pollenSeverityColor('high')).toBe('red');
    expect(pollenSeverityColor('medium')).toBe('orange');
    expect(pollenSeverityColor('low')).toBe('yellow');
    expect(pollenSeverityColor('none')).toBe('green');
    expect(pollenSeverityColor(null)).toBe('disabled');
  });
});

describe('pollenIcon', () => {
  it('returns a non-empty mdi id for every pollen type', () => {
    for (const t of ['alder', 'birch', 'grass', 'mugwort', 'olive', 'ragweed'] as const) {
      expect(pollenIcon(t)).toMatch(/^mdi:/);
    }
  });
});
