// ====================================================================
// HealthTab — dashboard health check editor surface (v4.6.0)
// ====================================================================
// Surfaces config-drift issues detected by src/utils/health.ts. Each
// row shows the issue with severity icon + description; auto-fixable
// issues get a "Fix" button that pipes the patch through
// _fireConfigChanged.
//
// The tab hides entirely (returns nothing) when there are no issues —
// per the spec: "no issues" should be silent, not a green checkmark
// that adds visual noise to every editor load.
// ====================================================================

import { html, nothing, type TemplateResult } from 'lit';
import type { HomeAssistant } from '../../types/homeassistant';
import type { OrielConfig } from '../../types/strategy';
import { detectHealthIssues, type HealthSeverity } from '../../utils/health';
import { localize } from '../../utils/localize';

export interface HealthTabContext {
  hass: HomeAssistant;
  config: OrielConfig;
  /** Caller wires patches through _fireConfigChanged. */
  onApplyFix: (patched: OrielConfig) => void;
}

const SEVERITY_META: Record<HealthSeverity, { icon: string; colorVar: string }> = {
  error: { icon: 'mdi:alert-circle', colorVar: 'var(--error-color)' },
  warning: { icon: 'mdi:alert', colorVar: 'var(--warning-color, #ff9800)' },
  info: { icon: 'mdi:information-outline', colorVar: 'var(--info-color, var(--primary-color))' },
};

export function renderHealthTab(ctx: HealthTabContext): TemplateResult | typeof nothing {
  const issues = detectHealthIssues(ctx.config, ctx.hass);
  if (issues.length === 0) return nothing;

  return html`
    <div class="section">
      <div class="section-title">
        ${localize('editor.health.title') || 'Dashboard health check'}
      </div>
      <div class="description" style="margin-bottom: 12px;">
        ${localize('editor.health.desc') ||
          'Configuration issues detected. Fixes are one-click for orphaned references; YAML parse errors require editing in the relevant tab.'}
      </div>

      ${issues.map(
        (issue) => html`
          <div
            style="display: grid; grid-template-columns: auto 1fr auto; gap: 10px; align-items: center; border: 1px solid var(--divider-color); border-left: 4px solid ${SEVERITY_META[issue.severity].colorVar}; border-radius: 6px; padding: 10px 12px; margin-bottom: 8px;"
          >
            <ha-icon
              icon=${SEVERITY_META[issue.severity].icon}
              style="--mdc-icon-size: 24px; color: ${SEVERITY_META[issue.severity].colorVar};"
            ></ha-icon>
            <div>
              <div style="font-weight: 500;">
                ${localize(issue.titleKey) || issue.titleKey}
              </div>
              <div style="font-size: 0.85rem; color: var(--secondary-text-color); margin-top: 2px;">
                ${localize(issue.descKey) || issue.descKey}
              </div>
              ${issue.detail
                ? html`<div
                    style="font-family: monospace; font-size: 0.78rem; color: var(--secondary-text-color); margin-top: 4px;"
                  >
                    ${issue.detail}
                  </div>`
                : nothing}
            </div>
            ${issue.fix
              ? html`
                  <button
                    class="btn-primary"
                    style="padding: 6px 12px;"
                    @click=${() => {
                      const patched = issue.fix!(ctx.config);
                      ctx.onApplyFix(patched);
                    }}
                  >
                    ${localize(issue.ctaKey ?? 'editor.health.fix') || 'Fix'}
                  </button>
                `
              : html`<span
                  style="font-size: 0.78rem; color: var(--secondary-text-color); white-space: nowrap;"
                  >${localize('editor.health.no_auto_fix') || 'No auto-fix'}</span
                >`}
          </div>
        `,
      )}
    </div>
  `;
}
