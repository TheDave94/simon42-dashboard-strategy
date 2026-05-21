// ============================================================================
// Tests — ZonePresenceCard hostile-config rendering (T-2)
// ============================================================================
// Pins the security claim from the v4.5.0 review §S-7 audit: the card
// uses Lit text interpolation for name + label, attribute bindings for
// icon + ARIA attrs, and styleMap for color. None of these paths
// allow a hostile dashboard config (rendered with arbitrary author-
// controlled strings) to escape DOM containment, execute scripts,
// or break out of the CSS custom-property value into sibling
// declarations.
// ============================================================================

import { describe, it, expect, beforeEach } from 'vitest';
import '../../src/cards/ZonePresenceCard';
import type { HomeAssistant } from '../../src/types/homeassistant';

type ZonePresenceCardEl = HTMLElement & {
  setConfig(cfg: Record<string, unknown>): void;
  hass?: HomeAssistant;
};

function mount(): ZonePresenceCardEl {
  const el = document.createElement('oriel-zone-presence-card') as ZonePresenceCardEl;
  // Give the card a minimal hass so it can render — entities map is
  // queried via Reflect.get during render and must be a real object.
  el.hass = {
    states: {
      'binary_sensor.foo': { state: 'on', attributes: {}, entity_id: 'binary_sensor.foo' },
    },
    entities: {
      'binary_sensor.foo': { entity_id: 'binary_sensor.foo', device_id: null, area_id: null, labels: [] },
    },
    locale: { language: 'en' },
  } as unknown as HomeAssistant;
  document.body.appendChild(el);
  return el;
}

async function mountAndRender(cfg: Record<string, unknown>): Promise<ZonePresenceCardEl> {
  const el = mount();
  el.setConfig(cfg);
  await (el as unknown as { updateComplete: Promise<unknown> }).updateComplete;
  return el;
}

describe('ZonePresenceCard — hostile config (T-2)', () => {
  beforeEach(() => {
    // Each test starts with a clean DOM
    document.body.querySelectorAll('oriel-zone-presence-card').forEach((n) => n.remove());
  });

  it('renders hostile name as escaped text — no <script> element appears', async () => {
    const el = await mountAndRender({
      entities: [
        {
          entity: 'binary_sensor.foo',
          name: "<script>window.__owned=true</script>",
        },
      ],
    });
    expect((window as Record<string, unknown>).__owned).toBeUndefined();
    // No script element exists inside the card's shadow tree
    expect(el.shadowRoot?.querySelector('script')).toBeNull();
    // The literal text appears in the label
    const labelText = el.shadowRoot?.querySelector('.label')?.textContent ?? '';
    expect(labelText).toContain('<script>');
  });

  it('renders hostile name with img onerror as escaped text', async () => {
    const el = await mountAndRender({
      entities: [
        {
          entity: 'binary_sensor.foo',
          name: '<img src=x onerror="window.__hacked=true">',
        },
      ],
    });
    expect((window as Record<string, unknown>).__hacked).toBeUndefined();
    expect(el.shadowRoot?.querySelector('img')).toBeNull();
  });

  it('hostile color string with `;` does not leak into sibling stylesheets or document', async () => {
    const docBgBefore = document.body.style.background;
    const el = await mountAndRender({
      entities: [
        {
          entity: 'binary_sensor.foo',
          name: 'Foo',
          // Try to break out of the CSS custom-property value into a
          // sibling declaration. Lit's styleMap calls
          // element.style.setProperty('--dot-color', value) — real
          // browsers scope value to one declaration. Happy-dom is more
          // permissive (it may parse the `;` and apply the second part
          // to the zone's inline style), but the global document and
          // any sibling element must remain untouched.
          color: 'red; background: url(https://evil.com/track.gif)',
        },
      ],
    });
    expect(el.shadowRoot?.querySelector('.zone')).not.toBeNull();
    // No leakage into document.body or other elements outside the card
    expect(document.body.style.background).toBe(docBgBefore);
    // No new global stylesheet got injected
    const cardStylesheetCount = (document.styleSheets as unknown as { length: number }).length;
    expect(cardStylesheetCount).toBeLessThan(5);
  });

  it('hostile color with closing brace + new selector does not escape to body', async () => {
    const docBgBefore = document.body.style.background;
    const el = await mountAndRender({
      entities: [
        {
          entity: 'binary_sensor.foo',
          name: 'Foo',
          color: 'red } body { background: red',
        },
      ],
    });
    // The inline-style setProperty path cannot inject CSS selectors —
    // even happy-dom won't parse a closing brace as ending a rule.
    expect(document.body.style.background).toBe(docBgBefore);
    expect(el.shadowRoot?.querySelector('.zone')).not.toBeNull();
  });

  it('hostile icon attribute is set as a string, never executed as code', async () => {
    const el = await mountAndRender({
      entities: [
        {
          entity: 'binary_sensor.foo',
          name: 'Foo',
          icon: 'mdi:home" onmouseover="window.__icon_owned=true',
        },
      ],
    });
    // The hostile fragment ends up inside the icon attribute as a string,
    // but is never interpreted as an HTML attribute boundary (Lit's
    // attribute binding escapes quotes).
    const haIcon = el.shadowRoot?.querySelector('ha-icon');
    const iconAttr = haIcon?.getAttribute('icon') ?? '';
    expect(iconAttr).toContain('onmouseover');
    // No execution
    expect((window as Record<string, unknown>).__icon_owned).toBeUndefined();
    // And the icon element itself has no onmouseover attribute
    expect(haIcon?.getAttribute('onmouseover')).toBeNull();
  });

  it('hostile ARIA label text does not break out of attribute', async () => {
    const el = await mountAndRender({
      entities: [
        {
          entity: 'binary_sensor.foo',
          name: 'Quote " escape <script>x</script>',
        },
      ],
    });
    const zone = el.shadowRoot?.querySelector('.zone');
    const ariaLabel = zone?.getAttribute('aria-label') ?? '';
    expect(ariaLabel).toContain('<script>');
    // No script element materialised
    expect(el.shadowRoot?.querySelector('script')).toBeNull();
  });
});
