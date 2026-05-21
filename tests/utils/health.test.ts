// ============================================================================
// Tests — health-check detector (F-4)
// ============================================================================
// Pins every detection rule with a concrete fixture. Each test also
// verifies the `fix()` function lifts the issue when applied — round-
// tripping ensures the auto-fix is correct.
// ============================================================================

import { describe, it, expect } from 'vitest';
import type { HomeAssistant } from '../../src/types/homeassistant';
import type { OrielConfig } from '../../src/types/strategy';
import { detectHealthIssues } from '../../src/utils/health';

function makeHass(opts: {
  existingEntities?: string[];
  existingAreas?: string[];
} = {}): HomeAssistant {
  const states: Record<string, unknown> = {};
  for (const id of opts.existingEntities ?? []) {
    states[id] = { state: 'on', entity_id: id, attributes: {} };
  }
  const areas: Record<string, unknown> = {};
  for (const id of opts.existingAreas ?? []) {
    areas[id] = { area_id: id, name: id };
  }
  return {
    states,
    areas,
    entities: {},
    locale: { language: 'en' },
  } as unknown as HomeAssistant;
}

describe('detectHealthIssues — empty cases', () => {
  it('returns [] when config is empty', () => {
    const config: OrielConfig = {} as OrielConfig;
    const issues = detectHealthIssues(config, makeHass());
    expect(issues).toEqual([]);
  });

  it('returns [] when every reference is valid', () => {
    const hass = makeHass({
      existingEntities: ['weather.home', 'sensor.power', 'light.x'],
      existingAreas: ['kitchen'],
    });
    const config: OrielConfig = {
      weather_entity: 'weather.home',
      power_badge_entity: 'sensor.power',
      room_pin_entities: ['light.x'],
      areas_options: { kitchen: { hidden: false } },
    } as unknown as OrielConfig;
    const issues = detectHealthIssues(config, hass);
    expect(issues).toEqual([]);
  });
});

describe('detectHealthIssues — orphan entity references', () => {
  it('detects stale weather_entity + fix removes it', () => {
    const hass = makeHass();
    const config = { weather_entity: 'weather.gone' } as unknown as OrielConfig;
    const issues = detectHealthIssues(config, hass);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.id).toBe('orphan-weather-entity');
    expect(issues[0]?.severity).toBe('warning');
    expect(issues[0]?.detail).toBe('weather.gone');
    const fixed = issues[0]?.fix?.(config);
    expect((fixed as OrielConfig).weather_entity).toBeUndefined();
  });

  it('detects stale power_badge_entity', () => {
    const config = { power_badge_entity: 'sensor.gone' } as unknown as OrielConfig;
    const issues = detectHealthIssues(config, makeHass());
    expect(issues).toHaveLength(1);
    expect(issues[0]?.id).toBe('orphan-power-badge-entity');
    const fixed = issues[0]?.fix?.(config);
    expect((fixed as OrielConfig).power_badge_entity).toBeUndefined();
  });

  it('detects stale house_mode_entity', () => {
    const config = { house_mode_entity: 'input_select.gone' } as unknown as OrielConfig;
    const issues = detectHealthIssues(config, makeHass());
    expect(issues).toHaveLength(1);
    expect(issues[0]?.id).toBe('orphan-house-mode-entity');
  });

  it('detects stale room_pin_entities + fix removes only the stale ones', () => {
    const hass = makeHass({ existingEntities: ['light.kept'] });
    const config = {
      room_pin_entities: ['light.gone', 'light.kept', 'switch.also_gone'],
    } as unknown as OrielConfig;
    const issues = detectHealthIssues(config, hass);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.id).toBe('orphan-room-pins');
    expect(issues[0]?.detail).toContain('light.gone');
    expect(issues[0]?.detail).toContain('switch.also_gone');
    expect(issues[0]?.detail).not.toContain('light.kept');
    const fixed = issues[0]?.fix?.(config) as { room_pin_entities: string[] };
    expect(fixed.room_pin_entities).toEqual(['light.kept']);
  });

  it('drops room_pin_entities entirely when every entry is stale', () => {
    const config = { room_pin_entities: ['light.gone'] } as unknown as OrielConfig;
    const issues = detectHealthIssues(config, makeHass());
    const fixed = issues[0]?.fix?.(config) as OrielConfig;
    expect(fixed.room_pin_entities).toBeUndefined();
  });

  it('detects stale light_favorite_entities + fix preserves valid ones', () => {
    const hass = makeHass({ existingEntities: ['light.a'] });
    const config = {
      light_favorite_entities: ['light.a', 'light.gone'],
    } as unknown as OrielConfig;
    const issues = detectHealthIssues(config, hass);
    expect(issues).toHaveLength(1);
    const fixed = issues[0]?.fix?.(config) as { light_favorite_entities: string[] };
    expect(fixed.light_favorite_entities).toEqual(['light.a']);
  });

  it('detects stale notification_triggers entries + fix prunes them', () => {
    const hass = makeHass({ existingEntities: ['binary_sensor.smoke'] });
    const config = {
      notification_triggers: [
        { entity: 'binary_sensor.smoke', title: 'Smoke' },
        { entity: 'binary_sensor.gone', title: 'Leak' },
      ],
    } as unknown as OrielConfig;
    const issues = detectHealthIssues(config, hass);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.id).toBe('orphan-notification-triggers');
    const fixed = issues[0]?.fix?.(config) as {
      notification_triggers: Array<{ entity: string }>;
    };
    expect(fixed.notification_triggers).toHaveLength(1);
    expect(fixed.notification_triggers[0]?.entity).toBe('binary_sensor.smoke');
  });

  it('drops notification_triggers entirely when every entry is stale', () => {
    const config = {
      notification_triggers: [{ entity: 'binary_sensor.gone' }],
    } as unknown as OrielConfig;
    const issues = detectHealthIssues(config, makeHass());
    const fixed = issues[0]?.fix?.(config) as OrielConfig;
    expect(fixed.notification_triggers).toBeUndefined();
  });
});

describe('detectHealthIssues — favorite_entities (flat + viewport-keyed)', () => {
  it('handles flat array form', () => {
    const hass = makeHass({ existingEntities: ['light.kept'] });
    const config = {
      favorite_entities: ['light.kept', 'light.gone'],
    } as unknown as OrielConfig;
    const issues = detectHealthIssues(config, hass);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.detail).toContain('light.gone');
    const fixed = issues[0]?.fix?.(config) as { favorite_entities: string[] };
    expect(fixed.favorite_entities).toEqual(['light.kept']);
  });

  it('handles viewport-keyed map form — per-viewport issue + fix', () => {
    const hass = makeHass({ existingEntities: ['light.kept'] });
    const config = {
      favorite_entities: {
        default: ['light.kept', 'light.gone1'],
        phone: ['light.gone2'],
        wall: ['light.kept'],
      },
    } as unknown as OrielConfig;
    const issues = detectHealthIssues(config, hass);
    // One issue per viewport with stale entries
    expect(issues).toHaveLength(2);
    expect(issues.some((i) => i.detail?.includes('default'))).toBe(true);
    expect(issues.some((i) => i.detail?.includes('phone'))).toBe(true);
    // Applying the default-viewport fix
    const defaultIssue = issues.find((i) => i.id === 'orphan-favorite-entities-default');
    const fixed = defaultIssue?.fix?.(config) as {
      favorite_entities: Record<string, string[]>;
    };
    expect(fixed.favorite_entities.default).toEqual(['light.kept']);
    // Phone untouched (separate issue)
    expect(fixed.favorite_entities.phone).toEqual(['light.gone2']);
  });
});

describe('detectHealthIssues — areas_options', () => {
  it('detects entries for missing areas + fix drops them', () => {
    const hass = makeHass({ existingAreas: ['kitchen'] });
    const config = {
      areas_options: {
        kitchen: { hidden: false },
        garage_gone: { hidden: true },
        attic_gone: { hidden: false },
      },
    } as unknown as OrielConfig;
    const issues = detectHealthIssues(config, hass);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.id).toBe('orphan-areas-options');
    expect(issues[0]?.severity).toBe('info');
    const fixed = issues[0]?.fix?.(config) as { areas_options: Record<string, unknown> };
    expect(Object.keys(fixed.areas_options)).toEqual(['kitchen']);
  });

  it('drops areas_options entirely when every entry is stale', () => {
    const config = {
      areas_options: { garage_gone: { hidden: true } },
    } as unknown as OrielConfig;
    const issues = detectHealthIssues(config, makeHass());
    const fixed = issues[0]?.fix?.(config) as OrielConfig;
    expect(fixed.areas_options).toBeUndefined();
  });
});

describe('detectHealthIssues — YAML parse errors', () => {
  it('detects custom_views with _yaml_error', () => {
    const config = {
      custom_views: [
        { title: 'OK', _yaml_error: undefined },
        { title: 'Broken', _yaml_error: 'YAML parse failed at line 3' },
      ],
    } as unknown as OrielConfig;
    const issues = detectHealthIssues(config, makeHass());
    expect(issues).toHaveLength(1);
    expect(issues[0]?.id).toBe('orphan_custom_views_yaml');
    expect(issues[0]?.severity).toBe('error');
    expect(issues[0]?.fix).toBeUndefined(); // no auto-fix; needs human edit
  });

  it('detects custom_cards / custom_sections / custom_badges errors too', () => {
    const config = {
      custom_cards: [{ _yaml_error: 'bad' }],
      custom_sections: [{ _yaml_error: 'bad' }],
      custom_badges: [{ _yaml_error: 'bad' }],
    } as unknown as OrielConfig;
    const issues = detectHealthIssues(config, makeHass());
    expect(issues).toHaveLength(3);
    expect(issues.every((i) => i.severity === 'error')).toBe(true);
  });
});

describe('detectHealthIssues — ordering', () => {
  it('errors first, then warnings, then info', () => {
    const config = {
      custom_views: [{ _yaml_error: 'bad' }], // error
      weather_entity: 'weather.gone',          // warning
      areas_options: { gone: {} },             // info
    } as unknown as OrielConfig;
    const issues = detectHealthIssues(config, makeHass());
    expect(issues[0]?.severity).toBe('error');
    expect(issues[1]?.severity).toBe('warning');
    expect(issues[2]?.severity).toBe('info');
  });
});
