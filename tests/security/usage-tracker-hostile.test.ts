// ============================================================================
// Tests — usage-tracker trackTap hostile-input rejection (T-2)
// ============================================================================
// trackTap() now validates against ENTITY_ID_RE before recording. This
// pins the contract: hostile entityIds — __proto__, constructor, names
// without a dot, names with HTML — are silently dropped, never written
// to localStorage, and never alter Object.prototype.
// ============================================================================

import { describe, it, expect, beforeEach } from 'vitest';
import { setActiveUser, trackTap, reset } from '../../src/utils/usage-tracker';

beforeEach(() => {
  // Each test starts with a known clean slate. Use a stable user id so
  // we can read the storage key directly if needed.
  setActiveUser('test-user');
  reset();
  // Belt-and-braces against test bleed from prior failures
  if (typeof localStorage !== 'undefined') {
    localStorage.clear();
  }
});

describe('trackTap — hostile entityId rejection (T-2)', () => {
  it('rejects __proto__ as entityId', () => {
    const protoSentinel = ({} as Record<string, unknown>).polluted;
    trackTap('__proto__');
    expect(({} as Record<string, unknown>).polluted).toBe(protoSentinel);
    // And nothing was recorded
    const stored = localStorage.getItem('oriel_usage_v1:test-user');
    expect(stored).toBeNull();
  });

  it('rejects constructor as entityId', () => {
    trackTap('constructor');
    expect(localStorage.getItem('oriel_usage_v1:test-user')).toBeNull();
  });

  it('rejects entityId without a dot (malformed)', () => {
    trackTap('light_living_room');
    expect(localStorage.getItem('oriel_usage_v1:test-user')).toBeNull();
  });

  it('rejects entityId with HTML', () => {
    trackTap('<script>alert(1)</script>.x');
    expect(localStorage.getItem('oriel_usage_v1:test-user')).toBeNull();
  });

  it('rejects entityId with capital letters', () => {
    // HA entity IDs are lowercase. Reject mixed case as an additional canary.
    trackTap('Light.LivingRoom');
    expect(localStorage.getItem('oriel_usage_v1:test-user')).toBeNull();
  });

  it('accepts a legitimate entityId', () => {
    trackTap('light.living_room');
    const stored = localStorage.getItem('oriel_usage_v1:test-user');
    expect(stored).not.toBeNull();
    const parsed = JSON.parse(stored as string);
    expect(parsed.entities['light.living_room']).toBe(1);
    expect(parsed.domains['light']).toBe(1);
  });

  it('handles a wave of mixed valid + hostile inputs without polluting', () => {
    trackTap('__proto__');
    trackTap('light.x');
    trackTap('constructor');
    trackTap('sensor.y');
    trackTap('prototype');
    trackTap('switch.z');
    const stored = JSON.parse(localStorage.getItem('oriel_usage_v1:test-user') as string);
    expect(stored.entities['light.x']).toBe(1);
    expect(stored.entities['sensor.y']).toBe(1);
    expect(stored.entities['switch.z']).toBe(1);
    // The dangerous names were rejected upstream — must NOT have own
    // properties on the stored map. Reading `entities['__proto__']`
    // returns Object.prototype via inheritance, so an Object.hasOwn
    // check is the right gate here (not toBeUndefined).
    expect(Object.hasOwn(stored.entities, '__proto__')).toBe(false);
    expect(Object.hasOwn(stored.entities, 'constructor')).toBe(false);
    expect(Object.hasOwn(stored.entities, 'prototype')).toBe(false);
    expect(stored.total).toBe(3);
  });

  it('also rejects __proto__.x (dangerous-domain guard)', () => {
    trackTap('__proto__.x');
    expect(localStorage.getItem('oriel_usage_v1:test-user')).toBeNull();
  });

  it('also rejects constructor.x', () => {
    trackTap('constructor.x');
    expect(localStorage.getItem('oriel_usage_v1:test-user')).toBeNull();
  });
});
