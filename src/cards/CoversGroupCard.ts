// ====================================================================
// COVERS GROUP CARD — Reactive card for open/closed cover groups (LitElement)
// ====================================================================

import { LitElement, html, css, nothing, type PropertyValues } from 'lit';
import type { HomeAssistant } from '../types/homeassistant';
import { Registry } from '../Registry';
import { trackHassUpdate } from '../utils/debug';

declare global {
  interface Window {
    customCards?: Array<{ type: string; name: string; description: string }>;
  }
}

interface CoversGroupConfig {
  config?: any;
  group_type: 'open' | 'closed';
  device_classes?: string[];
}

// Pre-compiled RegExps for cover type name stripping
const COVER_TERMS = [
  'Rollo', 'Rollladen', 'Jalousie', 'Vorhang', 'Gardine',
  'Rolladen', 'Beschattung', 'Raffstore', 'Fenster',
  'Cover', 'Blind', 'Curtain', 'Shade', 'Shutter', 'Window',
];
const COVER_TERM_REGEXPS = COVER_TERMS.map(
  term => new RegExp(`^${term}\\s+|\\s+${term}$`, 'gi'),
);

const DEFAULT_DEVICE_CLASSES = ['awning', 'blind', 'curtain', 'shade', 'shutter', 'window'];

class Simon42CoversGroupCard extends LitElement {
  static properties = {
    _hass: { state: true },
  };

  private _hass: HomeAssistant | null = null;
  private _config!: CoversGroupConfig;
  private _deviceClasses!: string[];
  private _cachedFilteredIds: Set<string> | null = null;
  private _lastCoversList = '';

  // Reusable card pool
  private _tileCards: Map<string, any> = new Map();
  private _headingCard: any = null;

  static styles = css`
    :host {
      display: block;
    }
    :host([hidden]) {
      display: none;
    }
    .covers-section {
      display: flex;
      flex-direction: column;
      gap: 8px;
      width: 100%;
    }
    .cover-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
      gap: 8px;
    }
  `;

  setConfig(config: CoversGroupConfig): void {
    if (!config.group_type) throw new Error('You need to define group_type (open/closed)');
    this._config = config;
    this._deviceClasses = config.device_classes || DEFAULT_DEVICE_CLASSES;
  }

  set hass(hass: HomeAssistant) {
    trackHassUpdate('covers-group');
    const oldHass = this._hass;

    if (!oldHass || oldHass.entities !== hass.entities) {
      this._cachedFilteredIds = null;
    }

    // Skip if states unchanged — BUT only if we've successfully loaded once.
    if (oldHass && oldHass.states === hass.states && this._cachedFilteredIds) return;

    // Fast path: only check cover entities for changes
    if (oldHass && this._cachedFilteredIds) {
      let hasChange = false;
      for (const id of this._cachedFilteredIds) {
        if (oldHass.states[id] !== hass.states[id]) { hasChange = true; break; }
      }
      if (!hasChange) {
        this._propagateHass(hass);
        this._hass = hass;
        return;
      }
    }

    if (!this._cachedFilteredIds) {
      if (!Registry.initialized) {
        this._hass = hass;
        return;
      }
      this._cachedFilteredIds = new Set(this._getFilteredCoverEntities(hass));
    }

    this._propagateHass(hass);
    this._hass = hass;
  }

  get hass(): HomeAssistant | null { return this._hass; }

  private _propagateHass(hass: HomeAssistant): void {
    if (this._headingCard) this._headingCard.hass = hass;
    for (const card of this._tileCards.values()) {
      card.hass = hass;
    }
  }

  private _getFilteredCoverEntities(hass: HomeAssistant): string[] {
    return Registry.getVisibleEntityIdsForDomain('cover')
      .filter(id => {
        const state = hass.states[id];
        if (!state) return false;
        const deviceClass = (state.attributes as any)?.device_class as string | undefined;
        return this._deviceClasses.includes(deviceClass!) || !deviceClass;
      });
  }

  private _getRelevantCovers(): string[] {
    if (!this._hass || !this._cachedFilteredIds) return [];
    const isOpen = this._config.group_type === 'open';

    const relevant: string[] = [];
    for (const id of this._cachedFilteredIds) {
      const state = this._hass.states[id];
      if (!state) continue;
      if (isOpen) {
        if (state.state === 'open' || state.state === 'opening') relevant.push(id);
      } else {
        if (state.state === 'closed' || state.state === 'closing') relevant.push(id);
      }
    }

    relevant.sort((a, b) => {
      const stateA = this._hass!.states[a];
      const stateB = this._hass!.states[b];
      if (!stateA || !stateB) return 0;
      return new Date(stateB.last_changed).getTime() - new Date(stateA.last_changed).getTime();
    });

    return relevant;
  }

  private _stripCoverType(entityId: string): string {
    const state = this._hass!.states[entityId];
    if (!state) return entityId;

    let name = state.attributes.friendly_name || entityId;

    for (const regex of COVER_TERM_REGEXPS) {
      regex.lastIndex = 0;
      name = name.replace(regex, '');
    }

    return name.trim() || state.attributes.friendly_name || entityId;
  }

  private _buildHeadingConfig(covers: string[]): any {
    const isOpen = this._config.group_type === 'open';
    return {
      type: 'heading',
      heading: `${isOpen ? 'Offene Rollos & Vorhänge' : 'Geschlossene Rollos & Vorhänge'} (${covers.length})`,
      icon: isOpen ? 'mdi:blinds-horizontal' : 'mdi:blinds',
      badges: [{
        type: 'button',
        icon: isOpen ? 'mdi:arrow-down' : 'mdi:arrow-up',
        text: isOpen ? 'Alle schließen' : 'Alle öffnen',
        tap_action: {
          action: 'perform-action',
          perform_action: isOpen ? 'cover.close_cover' : 'cover.open_cover',
          target: { entity_id: covers },
        },
      }],
    };
  }

  private _getOrCreateTileCard(entityId: string): any {
    let card = this._tileCards.get(entityId);
    if (card) return card;

    card = document.createElement('hui-tile-card');
    card.hass = this._hass;
    card.setConfig({
      type: 'tile',
      entity: entityId,
      name: this._stripCoverType(entityId),
      features: [{ type: 'cover-open-close' }],
      vertical: false,
      features_position: 'inline',
      state_content: ['current_position', 'last_changed'],
    });
    this._tileCards.set(entityId, card);
    return card;
  }

  private _calculateRenderKey(covers: string[]): string {
    return covers.map(id => {
      const state = this._hass!.states[id];
      if (!state) return id;
      if (state.state === 'opening' || state.state === 'closing') {
        const position = (state.attributes as any).current_position || 0;
        return `${id}:${state.state}:${position}`;
      }
      return `${id}:${state.state}`;
    }).join(',');
  }

  protected render() {
    if (!this._hass || !this._cachedFilteredIds) return nothing;

    const covers = this._getRelevantCovers();
    if (covers.length === 0) {
      this.hidden = true;
      return nothing;
    }
    this.hidden = false;

    return html`
      <div class="covers-section">
        <div id="heading"></div>
        <div class="cover-grid" id="grid"></div>
      </div>
    `;
  }

  protected updated(changedProps: PropertyValues): void {
    super.updated(changedProps);
    if (!this._hass || !this._cachedFilteredIds) return;

    const covers = this._getRelevantCovers();
    const coversKey = this._calculateRenderKey(covers);
    if (this._lastCoversList === coversKey) return;
    this._lastCoversList = coversKey;

    if (covers.length === 0) return;

    // Reconcile heading card
    const headingSlot = this.shadowRoot!.getElementById('heading');
    if (headingSlot) {
      if (!this._headingCard) {
        this._headingCard = document.createElement('hui-heading-card');
        headingSlot.appendChild(this._headingCard);
      }
      this._headingCard.hass = this._hass;
      this._headingCard.setConfig(this._buildHeadingConfig(covers));
    }

    // Reconcile tile cards in grid
    const grid = this.shadowRoot!.getElementById('grid');
    if (!grid) return;

    const activeIds = new Set(covers);

    // Remove cards for entities no longer in the list
    for (const [id, card] of this._tileCards) {
      if (!activeIds.has(id)) {
        if (card.parentNode === grid) grid.removeChild(card);
        this._tileCards.delete(id);
      }
    }

    // Add/reorder cards to match the desired order
    let prevNode: Node | null = null;
    for (const entityId of covers) {
      const card = this._getOrCreateTileCard(entityId);
      const nextSibling = prevNode ? prevNode.nextSibling : grid.firstChild;
      if (card !== nextSibling) {
        grid.insertBefore(card, nextSibling);
      }
      prevNode = card;
    }

    // Remove trailing stale nodes
    while (prevNode && prevNode.nextSibling) {
      grid.removeChild(prevNode.nextSibling);
    }
  }

  getCardSize(): number {
    const covers = this._getRelevantCovers();
    return Math.ceil(covers.length / 3) + 1;
  }
}

customElements.define('simon42-covers-group-card', Simon42CoversGroupCard);
