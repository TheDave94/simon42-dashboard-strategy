// ====================================================================
// Usage tracker (v3.5.1, per-user namespaced + aged-out v4.5.0)
// ====================================================================
// Counts taps per entity in localStorage. After a threshold of total
// interactions, the editor surfaces a "suggested layout" banner that
// proposes a `sections_order` derived from where the user actually
// taps. Per-browser; never sent anywhere.
//
// Per-user namespacing (review §S-6): on a shared device (wall tablet,
// family iPad), each HA user gets their own usage profile. Without
// this, every user contributes to the same blob and the suggestion
// banner reflects whoever has used that browser, including former
// users. The storage key is `oriel_usage_v1:<userId>`; legacy
// non-namespaced data is migrated to the current user on first read.
//
// Age-out: entries older than MAX_AGE_DAYS are dropped on each read.
// Prevents stale data from a guest who used the tablet weeks ago
// dragging on current recommendations.
// ====================================================================

const STORAGE_KEY_PREFIX = 'oriel_usage_v1';
const LEGACY_STORAGE_KEY = 'oriel_usage_v1';
const THRESHOLD = 50; // taps before suggestion surfaces
const MAX_ENTRIES = 500;
const MAX_AGE_DAYS = 30;

/** User-scoped storage key. Falls back to a `:anon` namespace when we
 *  don't have a hass user id yet (early page load). */
let activeUserId: string | undefined;

/**
 * Set the active HA user id. Called from the editor / strategy at
 * mount time. Subsequent reads/writes namespace by this id.
 */
export function setActiveUser(userId: string | undefined): void {
  activeUserId = userId;
}

function storageKey(): string {
  return `${STORAGE_KEY_PREFIX}:${activeUserId ?? 'anon'}`;
}

interface UsageEntry {
  /** Domain count, e.g. "light" → 12 */
  domains: Record<string, number>;
  /** Per-entity-id count */
  entities: Record<string, number>;
  /** Total taps across all entities */
  total: number;
  /** ISO date of last tick — used to age out abandoned data */
  lastTick: string;
}

const empty = (): UsageEntry => ({
  domains: {},
  entities: {},
  total: 0,
  lastTick: new Date().toISOString(),
});

function read(): UsageEntry {
  if (typeof localStorage === 'undefined') return empty();
  try {
    let raw = localStorage.getItem(storageKey());
    // Migration: when a user-scoped slot is empty but the legacy key
    // exists, migrate it once. Only happens on first use post-v4.5.
    if (!raw && activeUserId) {
      const legacy = localStorage.getItem(LEGACY_STORAGE_KEY);
      if (legacy) {
        raw = legacy;
        localStorage.setItem(storageKey(), legacy);
        localStorage.removeItem(LEGACY_STORAGE_KEY);
      }
    }
    if (!raw) return empty();
    const parsed = JSON.parse(raw);
    if (typeof parsed !== 'object' || !parsed) return empty();
    const entry: UsageEntry = {
      domains: parsed.domains ?? {},
      entities: parsed.entities ?? {},
      total: parsed.total ?? 0,
      lastTick: parsed.lastTick ?? new Date().toISOString(),
    };
    // Age-out: drop the whole entry if it's older than MAX_AGE_DAYS.
    // Coarse but cheap; the user just builds fresh signal afterwards.
    const ageMs = Date.now() - Date.parse(entry.lastTick);
    if (Number.isFinite(ageMs) && ageMs > MAX_AGE_DAYS * 24 * 60 * 60 * 1000) {
      return empty();
    }
    return entry;
  } catch {
    return empty();
  }
}

function write(entry: UsageEntry): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(storageKey(), JSON.stringify(entry));
  } catch {
    /* quota exceeded or storage disabled */
  }
}

/**
 * HA entity-id shape: `domain.object_id` where each part is one or
 * more characters of [a-z0-9_]. Anything without a dot, anything with
 * HTML / event handlers / control characters is rejected. The
 * strategy emits only entity IDs matching this shape, so production
 * inputs always pass; the regex exists to guard against poisoned
 * upstream callers (review §T-2).
 */
const ENTITY_ID_RE = /^[a-z_][a-z0-9_]*\.[a-z0-9_]+$/;

/**
 * Dangerous "domain" names — `__proto__`, `constructor`, `prototype`.
 * Even though the regex would pass `__proto__.x`, the resulting
 * `entry.domains['__proto__']` assignment is the prototype setter on
 * a plain object — that's exactly the surface §S-2 closed. Reject the
 * domain explicitly so trackTap remains a hardened input boundary.
 */
const DANGEROUS_DOMAINS = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * Record a tap on the given entity. Idempotent and silent on failure
 * — never throws back into the host card. Rejects entity IDs that
 * don't match HA's canonical shape OR use a dangerous domain
 * (closes review §T-2).
 */
export function trackTap(entityId: string | undefined): void {
  if (!entityId || typeof entityId !== 'string') return;
  if (!ENTITY_ID_RE.test(entityId)) return;
  const domain = entityId.split('.')[0] ?? '';
  if (DANGEROUS_DOMAINS.has(domain)) return;
  const entry = read();
  if (Object.keys(entry.entities).length >= MAX_ENTRIES && !(entityId in entry.entities)) {
    return; // cap pathological cases
  }
  entry.entities[entityId] = (entry.entities[entityId] ?? 0) + 1;
  entry.domains[domain] = (entry.domains[domain] ?? 0) + 1;
  entry.total += 1;
  entry.lastTick = new Date().toISOString();
  write(entry);
}

/** Reset tracker for the active user. Available via window. */
export function reset(): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.removeItem(storageKey());
  // Also clear the legacy non-namespaced key in case migration didn't
  // happen yet.
  localStorage.removeItem(LEGACY_STORAGE_KEY);
}

if (typeof window !== 'undefined') {
  (window as unknown as { orielUsageReset?: () => void }).orielUsageReset = reset;
}

/** Has the user crossed the suggestion threshold? */
export function hasEnoughData(): boolean {
  return read().total >= THRESHOLD;
}

/**
 * Compute a recommended sections_order based on observed usage.
 * Sections that map to high-tap domains float to the top. Sections
 * without observed taps keep their default position.
 */
export function recommendSectionsOrder(
  currentOrder: string[],
): { order: string[]; rationale: string[] } | null {
  const entry = read();
  if (entry.total < THRESHOLD) return null;
  // Map each section key to a domain score.
  const sectionWeight: Record<string, number> = {};
  const domainsForSection: Record<string, string[]> = {
    overview: ['light', 'switch', 'fan'],
    areas: ['light', 'cover', 'climate'],
    energy: ['sensor'], // mapped via heuristic, not reliable
    weather: ['weather'],
    plants: ['plant'],
    agenda: ['calendar'],
    todos: ['todo'],
    persons: ['person'],
    vacuums: ['vacuum'],
    maintenance: [],
    presence: ['binary_sensor'],
    custom_cards: [], // user-controlled, no signal
  };
  for (const [key, doms] of Object.entries(domainsForSection)) {
    sectionWeight[key] = doms.reduce(
      (sum, d) => sum + (entry.domains[d] ?? 0),
      0,
    );
  }
  const sorted = [...currentOrder].sort(
    (a, b) => (sectionWeight[b] ?? 0) - (sectionWeight[a] ?? 0),
  );
  // If no change, return null (no suggestion needed).
  const same = sorted.every((k, i) => k === currentOrder[i]);
  if (same) return null;
  const rationale = sorted.map((k) => {
    const weight = sectionWeight[k] ?? 0;
    return weight > 0 ? `${k}: ${weight} taps` : `${k}: unchanged`;
  });
  return { order: sorted, rationale };
}

/** Current total tap count, for the banner copy. */
export function getTotalTaps(): number {
  return read().total;
}
