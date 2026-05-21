// ============================================================================
// Tests — hostile YAML through the custom_*.parsed_config surface (T-2)
// ============================================================================
// The editor's YAML mutators store `yaml.load()` output as parsed_config
// on custom_views / custom_cards / custom_sections / custom_badges, and
// the strategy spreads those into emitted dashboard config. Hostile
// YAML must not:
//   - Pollute Object.prototype globally
//   - Carry __proto__ / constructor / prototype as prototype setters on
//     spread results
//   - Cause js-yaml to instantiate arbitrary JS types
//
// js-yaml v4.x's default loader excludes the `!!js/function` /
// `!!js/regexp` / `!!js/undefined` schemas — confirmed. These tests
// pin that and the prototype-pollution surface so a future js-yaml
// bump or refactor can't silently regress the claim.
// ============================================================================

import { describe, it, expect } from 'vitest';
import yaml from 'js-yaml';

describe('YAML mutators — hostile-input protection (T-2)', () => {
  it('yaml.load of __proto__ key does not mutate Object.prototype', () => {
    const sentinel = ({} as Record<string, unknown>).polluted;
    yaml.load('__proto__:\n  polluted: true');
    // Object.prototype must be untouched after parsing
    expect(({} as Record<string, unknown>).polluted).toBe(sentinel);
  });

  it('yaml.load of constructor.prototype key does not mutate Object.prototype', () => {
    const sentinel = ({} as Record<string, unknown>).hacked;
    yaml.load('constructor:\n  prototype:\n    hacked: true');
    expect(({} as Record<string, unknown>).hacked).toBe(sentinel);
  });

  it('spread of parsed_config with __proto__ as own property does not pollute', () => {
    const parsed = yaml.load('__proto__:\n  polluted: true') as Record<string, unknown>;
    // js-yaml gives __proto__ as a regular own property
    expect(Object.prototype.hasOwnProperty.call(parsed, '__proto__')).toBe(true);
    // Spreading carries it as own property to the new object (not as the prototype setter)
    const spread = { ...parsed, type: 'tile' };
    expect((spread as Record<string, unknown>).type).toBe('tile');
    // Object.prototype globally is unaffected
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('rejects yaml.load of !!js/function payloads (unsafe types schema not active)', () => {
    expect(() => yaml.load('!!js/function function(){return 1}')).toThrow();
  });

  it('rejects yaml.load of !!js/regexp', () => {
    expect(() => yaml.load('!!js/regexp /a/')).toThrow();
  });

  it('rejects yaml.load of !!js/undefined', () => {
    // The default schema doesn't recognise js/undefined; either throws
    // or returns the literal string. Both are acceptable; what matters
    // is no JS code execution side-effect.
    let executed = false;
    try {
      const result = yaml.load('!!js/undefined') as unknown;
      executed = result === undefined; // would only be true if the unsafe schema fired
    } catch {
      // Expected — default loader rejects unknown tags
    }
    expect(executed).toBe(false);
  });

  it('hostile YAML in a card config spread does not break view assembly', () => {
    // Simulate what oriel.ts does at custom_views emit time:
    //   { ...cv.parsed_config, title, path }
    const parsed = yaml.load(`
type: tile
__proto__:
  polluted: true
entity: light.foo
`) as Record<string, unknown>;
    const view = { ...parsed, title: 'X', path: 'x' };
    expect((view as Record<string, unknown>).type).toBe('tile');
    expect((view as Record<string, unknown>).entity).toBe('light.foo');
    // The own-property __proto__ is carried but doesn't alter the spread object's prototype
    expect(Object.getPrototypeOf(view)).toBe(Object.prototype);
    // Global prototype untouched
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});
