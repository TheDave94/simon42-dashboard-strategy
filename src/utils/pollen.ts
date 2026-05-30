// ====================================================================
// POLLEN — PollenWatch integration helpers
// ====================================================================
// Detection + parsing for the PollenWatch HACS integration's sensor
// fleet. Generate-time only — the reactive card imports type aliases
// and pure functions, never builds dependencies on Registry from here
// (Registry isn't initialised inside the card itself).
//
// PollenWatch exposes four sub-sources, each emitting one sensor per
// pollen type:
//
//   sensor.pollenwatch_open_meteo_<type>          (grains/m³, float)
//   sensor.pollenwatch_polleninformation_<type>   (0–4, Austrian scale)
//   sensor.pollenwatch_google_<type>              (0–5, Google scale)
//   sensor.pollenwatch_analytics_<type>_consensus (enum: none/low/medium/high)
//
// `analytics` is the only enum source and the cleanest for tile colour;
// the other three are raw measurements with provider-specific scales.
// ====================================================================

import type { HomeAssistant, HassEntity } from '../types/homeassistant';
import {
  ALL_POLLEN_SOURCES,
  ALL_POLLEN_TYPES,
  type PollenSource,
  type PollenType,
} from '../types/strategy';

/**
 * Severity bucket every source maps into. Drives badge gating, tile
 * colour, and the chip strip. Non-numeric / unavailable states resolve
 * to null so callers can choose how to display "unknown".
 */
export type PollenLevel = 'none' | 'low' | 'medium' | 'high';

const SOURCE_PREFIX: Record<PollenSource, string> = {
  open_meteo: 'sensor.pollenwatch_open_meteo_',
  polleninformation: 'sensor.pollenwatch_polleninformation_',
  google: 'sensor.pollenwatch_google_',
  analytics: 'sensor.pollenwatch_analytics_',
};

/**
 * True when ANY `sensor.pollenwatch_*` exists in this hass instance.
 * Used to gate the editor subgroup so users without the integration
 * never see the controls.
 */
export function detectPollenwatchInstalled(hass: HomeAssistant): boolean {
  for (const id of Object.keys(hass.states)) {
    if (id.startsWith('sensor.pollenwatch_')) return true;
  }
  return false;
}

/**
 * Sources for which at least one sensor exists. Drives the editor's
 * source dropdown so the user only sees options they can actually pick.
 */
export function detectAvailableSources(hass: HomeAssistant): PollenSource[] {
  const out: PollenSource[] = [];
  for (const src of ALL_POLLEN_SOURCES) {
    const prefix = SOURCE_PREFIX[src];
    if (Object.keys(hass.states).some((id) => id.startsWith(prefix))) {
      out.push(src);
    }
  }
  return out;
}

/**
 * Entity id of the canonical sensor for a (source, type) pair.
 *
 * Analytics is keyed `<prefix><type>_consensus` rather than `<prefix><type>`
 * because the integration also emits divergence binary_sensors with the
 * same root. Other sources emit `<prefix><type>` directly.
 */
export function pollenSensorId(source: PollenSource, type: PollenType): string {
  if (source === 'analytics') {
    return `${SOURCE_PREFIX.analytics}${type}_consensus`;
  }
  return `${SOURCE_PREFIX[source]}${type}`;
}

/**
 * Pollen types for which a sensor exists at the given source. Preserves
 * the canonical `ALL_POLLEN_TYPES` order so editor chip ordering stays
 * stable across hass instances.
 */
export function detectAvailableTypes(
  hass: HomeAssistant,
  source: PollenSource,
): PollenType[] {
  return ALL_POLLEN_TYPES.filter(
    (type) => hass.states[pollenSensorId(source, type)] !== undefined,
  );
}

/**
 * Resolve the configured types against what the source actually exposes.
 * Empty / missing config falls back to all detected types so a fresh
 * install shows every available pollen by default.
 */
export function resolvePollenTypes(
  hass: HomeAssistant,
  source: PollenSource,
  configured: PollenType[] | undefined,
): PollenType[] {
  const available = detectAvailableTypes(hass, source);
  if (!configured || configured.length === 0) return available;
  const availableSet = new Set(available);
  return configured.filter((t) => availableSet.has(t));
}

/**
 * Map a raw entity state into a normalised severity level. The mapping
 * is source-specific because the underlying scales differ:
 *
 *   - analytics       — enum string, direct passthrough
 *   - polleninformation — 0–4 Austrian scale (≥3 = high)
 *   - google          — 0–5 Google scale (≥4 = high, 3 = medium, 1–2 = low)
 *   - open_meteo      — grains/m³ heuristic (≥50 = high, ≥10 = medium)
 *
 * Returns null when the state is missing / unavailable / unparseable.
 */
export function pollenLevel(
  source: PollenSource,
  state: HassEntity | undefined,
): PollenLevel | null {
  if (!state) return null;
  const raw = state.state;
  if (raw === 'unavailable' || raw === 'unknown' || raw === 'none' || raw === '') {
    return raw === 'none' ? 'none' : null;
  }

  if (source === 'analytics') {
    const v = raw.toLowerCase();
    if (v === 'none' || v === 'low' || v === 'medium' || v === 'high') return v;
    return null;
  }

  const n = Number(raw);
  if (!Number.isFinite(n)) return null;

  if (source === 'polleninformation') {
    if (n <= 0) return 'none';
    if (n >= 3) return 'high';
    if (n >= 2) return 'medium';
    return 'low';
  }
  if (source === 'google') {
    if (n <= 0) return 'none';
    if (n >= 4) return 'high';
    if (n >= 3) return 'medium';
    return 'low';
  }
  // open_meteo
  if (n <= 0) return 'none';
  if (n >= 50) return 'high';
  if (n >= 10) return 'medium';
  return 'low';
}

/**
 * "Active" — worth raising on the weather-section badge row. medium and
 * high count; low and none stay quiet so the row only appears when
 * something actually warrants attention.
 */
export function isActivePollen(level: PollenLevel | null): boolean {
  return level === 'medium' || level === 'high';
}

/** Severity → HA palette token used by tiles, chips, badges. */
export function pollenSeverityColor(level: PollenLevel | null): string {
  switch (level) {
    case 'high':
      return 'red';
    case 'medium':
      return 'orange';
    case 'low':
      return 'yellow';
    case 'none':
      return 'green';
    default:
      return 'disabled';
  }
}

/** MDI icon per pollen type — purely cosmetic; falls back to flower. */
export function pollenIcon(type: PollenType): string {
  switch (type) {
    case 'grass':
      return 'mdi:grass';
    case 'birch':
    case 'alder':
      return 'mdi:tree';
    case 'olive':
      return 'mdi:tree-outline';
    case 'mugwort':
    case 'ragweed':
      return 'mdi:flower-pollen';
    default:
      return 'mdi:flower-pollen';
  }
}
