import { useEffect, useMemo, useState } from 'react';
import App from '../App';
import type { WidgetConfigInput } from '../types/widget';
import chimeBell from '@/assets/brand/chime-bell.png';
import chimeWordmark from '@/assets/brand/chime-wordmark.png';
import chimeWordmarkSmile from '@/assets/brand/chime-wordmark-smile.png';
import type {
  AdminApiClient,
  AdminWidgetConfig,
  AdminWidgetCopy,
  AdminWidgetTheme,
} from './adminApi';
import '../index.css';
import './widgetStudio.css';
import { describeMissingConnection } from './adminConnection';

interface WidgetStudioProps {
  api: AdminApiClient;
  onNotify?: (message: string) => void;
}

const FALLBACK_CONFIG: AdminWidgetConfig = {
  id: null,
  organizationSlug: 'sea-and-kin',
  slug: 'booking',
  theme: {
    primaryColor: '#42c79a',
    accentColor: '#ffd36e',
    surfaceColor: '#fffef9',
    textColor: '#102a24',
    logoVariant: 'wordmark-smile',
    cardStyle: 'soft',
    cornerStyle: 'rounded',
    fontStyle: 'modern',
    showPoweredBy: true,
  },
  copy: {
    businessName: 'Sea & Kin Studio',
    headerTitle: 'Book with Sea & Kin',
    eyebrow: 'Appointment concierge',
    description: 'Choose a service, then pick the date and time that works best for you.',
    confirmationMessage: 'Your appointment is confirmed. We look forward to seeing you.',
  },
  locale: 'en-US',
  timeZone: 'Pacific/Honolulu',
  isActive: true,
  version: 0,
};

const PALETTES = [
  { name: 'Chime mint', colors: ['#42c79a', '#ffd36e', '#fffef9', '#102a24'] },
  { name: 'Coastal', colors: ['#2fa9a0', '#f2c66d', '#fbfdfb', '#173632'] },
  { name: 'Citrus', colors: ['#4c9b72', '#f6a94a', '#fffdf5', '#26352d'] },
  { name: 'Clay', colors: ['#b9684d', '#e8b968', '#fffaf6', '#362a26'] },
] as const;

const LOGOS = [
  { id: 'wordmark', label: 'Clean wordmark', src: chimeWordmark },
  { id: 'wordmark-smile', label: 'Friendly smile', src: chimeWordmarkSmile },
  { id: 'bell', label: 'Bell icon', src: chimeBell },
] as const;

function ColorControl({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="widget-color-control">
      <span>{label}</span>
      <span className="widget-color-control__input">
        <input type="color" value={value} onChange={(event) => onChange(event.target.value)} />
        <input
          type="text"
          value={value}
          maxLength={7}
          spellCheck={false}
          onChange={(event) => onChange(event.target.value)}
          aria-label={`${label} hex value`}
        />
      </span>
    </label>
  );
}

export default function WidgetStudio({ api, onNotify }: WidgetStudioProps) {
  const [draft, setDraft] = useState<AdminWidgetConfig>(FALLBACK_CONFIG);
  const [saved, setSaved] = useState<AdminWidgetConfig>(FALLBACK_CONFIG);
  const [loading, setLoading] = useState(api.configured);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewSize, setPreviewSize] = useState<'desktop' | 'mobile'>('desktop');

  useEffect(() => {
    if (!api.configured) return;
    let cancelled = false;
    setLoading(true);
    void api.getWidgetConfig()
      .then(({ config }) => {
        if (cancelled) return;
        setDraft(config);
        setSaved(config);
        setError(null);
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : 'Unable to load the widget design.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [api]);

  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  const previewConfig = useMemo<WidgetConfigInput>(() => ({
    businessName: draft.copy.businessName,
    headerTitle: draft.copy.headerTitle,
    headerEyebrow: draft.copy.eyebrow,
    description: draft.copy.description,
    confirmationMessage: draft.copy.confirmationMessage,
    theme: draft.theme,
    api: { baseUrl: '' },
    payment: { demoMode: true, required: true, currency: 'USD' },
  }), [draft]);

  function updateTheme<K extends keyof AdminWidgetTheme>(key: K, value: AdminWidgetTheme[K]) {
    setDraft((current) => ({ ...current, theme: { ...current.theme, [key]: value } }));
  }

  function updateCopy<K extends keyof AdminWidgetCopy>(key: K, value: AdminWidgetCopy[K]) {
    setDraft((current) => ({ ...current, copy: { ...current.copy, [key]: value } }));
  }

  function applyPalette(colors: readonly [string, string, string, string]) {
    setDraft((current) => ({
      ...current,
      theme: {
        ...current.theme,
        primaryColor: colors[0],
        accentColor: colors[1],
        surfaceColor: colors[2],
        textColor: colors[3],
      },
    }));
  }

  async function saveDesign() {
    setSaving(true);
    setError(null);
    try {
      if (!api.configured) {
        // This claimed a save and kept the draft in memory. Nothing reached
        // Chime, and Launch readiness still counts zero saved designs.
        setError(describeMissingConnection());
        onNotify?.('The widget design was not saved: Chime is not connected.');
        return;
      }
      const { config } = await api.saveWidgetConfig(draft);
      setDraft(config);
      setSaved(config);
      onNotify?.(config.isActive ? 'Widget design saved and available to the portable widget.' : 'Widget design saved as inactive.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to save the widget design.');
    } finally {
      setSaving(false);
    }
  }

  async function copyEmbedCode() {
    const adminBase = window.CHIME_ADMIN_CONFIG?.baseUrl ?? '';
    const publicApi = adminBase
      ? adminBase.replace(/\/api\/chime\/admin\/?$/, '/api/chime')
      : 'https://your-chime-api.example/api/chime';
    const snippet = `<div id="chime-widget-root"></div>\n<script src="https://your-cdn.example/chime-widget.iife.js"></script>\n<script>\n  ChimeWidget.mount('#chime-widget-root', ${JSON.stringify({
      organizationSlug: draft.organizationSlug,
      widgetSlug: draft.slug,
      api: { baseUrl: publicApi },
    }, null, 2)});\n</script>`;
    try {
      await navigator.clipboard.writeText(snippet);
      onNotify?.('Portable widget code copied.');
    } catch {
      setError('The browser blocked clipboard access. The connection key is shown beside the preview.');
    }
  }

  if (loading) {
    return <section className="widget-studio widget-studio--loading">Opening the widget designer...</section>;
  }

  return (
    <section className="widget-studio">
      <header className="widget-studio__header">
        <div>
          <p className="widget-studio__eyebrow">Booking widget</p>
          <h1>Widget designer</h1>
          <p>Make booking feel like your business. Change the real customer widget by sight — the booking order and payment protections stay locked underneath.</p>
        </div>
        <div className="widget-studio__header-actions">
          <span className={dirty ? 'is-dirty' : 'is-saved'}>{dirty ? 'Unsaved changes' : 'Saved'}</span>
          <button type="button" className="widget-studio__secondary" onClick={() => void copyEmbedCode()}>
            Copy embed code
          </button>
          <button type="button" className="widget-studio__primary" disabled={!dirty || saving} onClick={() => void saveDesign()}>
            {saving ? 'Saving...' : 'Save design'}
          </button>
        </div>
      </header>

      {error ? <div className="widget-studio__error" role="alert">{error}</div> : null}

      <div className="widget-studio__layout">
        <div className="widget-studio__controls">
          <section className="widget-control-section">
            <div className="widget-control-section__heading">
              <span>01</span>
              <div><h2>Your logo</h2><p>Choose the Chime lockup now, or connect a client logo URL.</p></div>
            </div>
            <div className="widget-logo-options">
              {LOGOS.map((logo) => (
                <button
                  type="button"
                  key={logo.id}
                  className={draft.theme.logoVariant === logo.id ? 'is-selected' : ''}
                  onClick={() => updateTheme('logoVariant', logo.id)}
                >
                  <span><img src={logo.src} alt="" /></span>
                  <small>{logo.label}</small>
                </button>
              ))}
              <button
                type="button"
                className={draft.theme.logoVariant === 'custom' ? 'is-selected' : ''}
                onClick={() => updateTheme('logoVariant', 'custom')}
              >
                <span className="widget-logo-options__custom">Yours</span>
                <small>Custom logo</small>
              </button>
            </div>
            {draft.theme.logoVariant === 'custom' ? (
              <label className="widget-field">
                <span>Logo image URL</span>
                <input
                  type="url"
                  placeholder="https://yourbusiness.com/logo.png"
                  value={draft.theme.customLogoUrl ?? ''}
                  onChange={(event) => updateTheme('customLogoUrl', event.target.value)}
                />
              </label>
            ) : null}
          </section>

          <section className="widget-control-section">
            <div className="widget-control-section__heading">
              <span>02</span>
              <div><h2>Words customers see</h2><p>Keep the opening screen direct and familiar.</p></div>
            </div>
            <div className="widget-field-grid">
              <label className="widget-field">
                <span>Business name</span>
                <input value={draft.copy.businessName} maxLength={80} onChange={(event) => updateCopy('businessName', event.target.value)} />
              </label>
              <label className="widget-field">
                <span>Header title</span>
                <input value={draft.copy.headerTitle} maxLength={100} onChange={(event) => updateCopy('headerTitle', event.target.value)} />
              </label>
              <label className="widget-field">
                <span>Small header label</span>
                <input value={draft.copy.eyebrow} maxLength={80} onChange={(event) => updateCopy('eyebrow', event.target.value)} />
              </label>
              <label className="widget-field widget-field--wide">
                <span>Opening instructions</span>
                <textarea value={draft.copy.description} maxLength={320} rows={3} onChange={(event) => updateCopy('description', event.target.value)} />
              </label>
              <label className="widget-field widget-field--wide">
                <span>Confirmation message</span>
                <textarea value={draft.copy.confirmationMessage} maxLength={320} rows={3} onChange={(event) => updateCopy('confirmationMessage', event.target.value)} />
              </label>
            </div>
          </section>

          <section className="widget-control-section">
            <div className="widget-control-section__heading">
              <span>03</span>
              <div><h2>Color and finish</h2><p>Start with a palette, then tune every color.</p></div>
            </div>
            <div className="widget-palettes">
              {PALETTES.map((palette) => (
                <button type="button" key={palette.name} onClick={() => applyPalette(palette.colors)}>
                  <span>{palette.colors.map((colorValue) => <i key={colorValue} style={{ background: colorValue }} />)}</span>
                  <small>{palette.name}</small>
                </button>
              ))}
            </div>
            <div className="widget-color-grid">
              <ColorControl label="Main color" value={draft.theme.primaryColor} onChange={(value) => updateTheme('primaryColor', value)} />
              <ColorControl label="Accent" value={draft.theme.accentColor} onChange={(value) => updateTheme('accentColor', value)} />
              <ColorControl label="Card surface" value={draft.theme.surfaceColor} onChange={(value) => updateTheme('surfaceColor', value)} />
              <ColorControl label="Text" value={draft.theme.textColor} onChange={(value) => updateTheme('textColor', value)} />
            </div>
            <div className="widget-segmented-fields">
              <fieldset>
                <legend>Cards</legend>
                {(['soft', 'outline', 'solid'] as const).map((value) => (
                  <button type="button" key={value} className={draft.theme.cardStyle === value ? 'is-selected' : ''} onClick={() => updateTheme('cardStyle', value)}>{value}</button>
                ))}
              </fieldset>
              <fieldset>
                <legend>Corners</legend>
                {(['soft', 'rounded', 'pill'] as const).map((value) => (
                  <button type="button" key={value} className={draft.theme.cornerStyle === value ? 'is-selected' : ''} onClick={() => updateTheme('cornerStyle', value)}>{value}</button>
                ))}
              </fieldset>
              <fieldset>
                <legend>Type</legend>
                {(['modern', 'friendly', 'classic'] as const).map((value) => (
                  <button type="button" key={value} className={draft.theme.fontStyle === value ? 'is-selected' : ''} onClick={() => updateTheme('fontStyle', value)}>{value}</button>
                ))}
              </fieldset>
            </div>
          </section>

          <section className="widget-control-section widget-control-section--release">
            <div className="widget-control-section__heading">
              <span>04</span>
              <div><h2>Portable connection</h2><p>This key loads the saved design anywhere Chime is embedded.</p></div>
            </div>
            <div className="widget-connection-key">
              <span>{draft.organizationSlug}</span><b>/</b>
              <input aria-label="Widget slug" value={draft.slug} onChange={(event) => setDraft((current) => ({ ...current, slug: event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') }))} />
            </div>
            <label className="widget-toggle">
              <input type="checkbox" checked={draft.isActive} onChange={(event) => setDraft((current) => ({ ...current, isActive: event.target.checked }))} />
              <span><b>Available to customers</b><small>Turn this off to keep the design saved but private.</small></span>
            </label>
            <label className="widget-toggle">
              <input type="checkbox" checked={draft.theme.showPoweredBy} onChange={(event) => updateTheme('showPoweredBy', event.target.checked)} />
              <span><b>Show “Powered by Chime”</b><small>A quiet product signature below the booking flow.</small></span>
            </label>
          </section>
        </div>

        <aside className="widget-studio__preview">
          <div className="widget-preview-toolbar">
            <div><span>Live customer preview</span><small>Fully interactive</small></div>
            <div>
              <button type="button" className={previewSize === 'desktop' ? 'is-selected' : ''} onClick={() => setPreviewSize('desktop')}>Desktop</button>
              <button type="button" className={previewSize === 'mobile' ? 'is-selected' : ''} onClick={() => setPreviewSize('mobile')}>Phone</button>
            </div>
          </div>
          <div className={`widget-preview-frame widget-preview-frame--${previewSize}`}>
            <div className="widget-preview-frame__screen">
              <App variant="embedded" config={previewConfig} />
            </div>
          </div>
          <p className="widget-preview-note">Try the service cards and calendar. Preview actions use demo data and never create a customer booking.</p>
        </aside>
      </div>
    </section>
  );
}
