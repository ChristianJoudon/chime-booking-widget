import { useEffect, useMemo, useState } from 'react';

import type {
  AdminApiClient,
  AdminLaunchDisplayMode,
  AdminLaunchPayload,
  AdminLaunchSettings,
} from './adminApi';
import './launchStudio.css';

interface LaunchStudioProps {
  api: AdminApiClient;
  onNotify: (message: string) => void;
}

const MODES: Array<{ id: AdminLaunchDisplayMode; label: string; detail: string }> = [
  { id: 'inline', label: 'Inline', detail: 'The booking experience lives directly inside the page.' },
  { id: 'modal', label: 'Modal', detail: 'A booking button opens Chime above the current page.' },
  { id: 'floating_button', label: 'Floating', detail: 'A persistent booking button follows the customer.' },
];

function snippetFor(payload: AdminLaunchPayload, mode: AdminLaunchDisplayMode): string {
  if (mode === 'modal') return payload.snippets.modal;
  if (mode === 'floating_button') return payload.snippets.floatingButton;
  return payload.snippets.inline;
}

function formatDate(value: string | null): string {
  if (!value) return 'Not published yet';
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(value));
}

export default function LaunchStudio({ api, onNotify }: LaunchStudioProps) {
  const [payload, setPayload] = useState<AdminLaunchPayload | null>(null);
  const [draft, setDraft] = useState<AdminLaunchSettings | null>(null);
  const [selectedMode, setSelectedMode] = useState<AdminLaunchDisplayMode>('inline');
  const [domainInput, setDomainInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    api.getLaunchSettings()
      .then((result) => {
        if (!active) return;
        setPayload(result);
        setDraft(result.settings);
        setSelectedMode(result.settings.displayMode);
        setError(null);
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : 'Chime could not load launch settings.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [api]);

  const snippet = useMemo(
    () => payload ? snippetFor(payload, selectedMode) : '',
    [payload, selectedMode],
  );

  async function persist(next: AdminLaunchSettings, message: string) {
    setSaving(true);
    setError(null);
    try {
      const result = await api.saveLaunchSettings(next);
      setPayload(result);
      setDraft(result.settings);
      setSelectedMode(result.settings.displayMode);
      onNotify(message);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Chime could not save launch settings.');
    } finally {
      setSaving(false);
    }
  }

  async function copy(value: string, label: string) {
    try {
      await navigator.clipboard.writeText(value);
      onNotify(`${label} copied.`);
    } catch {
      setError(`Your browser blocked copying ${label.toLowerCase()}.`);
    }
  }

  function addDomain() {
    if (!draft || !domainInput.trim()) return;
    const normalized = domainInput.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/$/, '');
    if (draft.allowedDomains.includes(normalized)) {
      setDomainInput('');
      return;
    }
    setDraft({ ...draft, allowedDomains: [...draft.allowedDomains, normalized] });
    setDomainInput('');
  }

  if (loading) {
    return (
      <section className="launch-studio launch-studio--loading" aria-busy="true">
        <span className="launch-loader" />
        <p>Preparing your launch workspace…</p>
      </section>
    );
  }

  if (!payload || !draft) {
    return (
      <section className="launch-studio launch-studio--error">
        <strong>Launch settings are unavailable.</strong>
        <p>{error ?? 'Connect the standalone admin API and reopen this workspace.'}</p>
      </section>
    );
  }

  const live = draft.embedEnabled || draft.hostedPageEnabled;

  return (
    <section className="launch-studio">
      <header className="launch-header">
        <div>
          <p className="launch-eyebrow">Portable booking</p>
          <h1>Launch Chime anywhere</h1>
          <p>Share one booking link or place the widget on any small-business website without rewriting Chime.</p>
        </div>
        <div className="launch-header__actions">
          <span className="launch-state" data-state={live ? 'live' : payload.readiness.ready ? 'ready' : 'setup'}>
            <i />{live ? 'Live' : payload.readiness.ready ? 'Ready to launch' : 'Setup needed'}
          </span>
          <button
            className="admin-primary-button"
            type="button"
            disabled={saving}
            onClick={() => void persist(draft, 'Launch settings saved.')}
          >
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </header>

      {error ? <div className="launch-error" role="alert">{error}</div> : null}

      <div className="launch-readiness" aria-label="Launch readiness">
        <div className="launch-readiness__score">
          <span>{payload.readiness.score}%</span>
          <div>
            <strong>Launch readiness</strong>
            <small>{payload.readiness.completed} of {payload.readiness.total} essentials complete</small>
          </div>
        </div>
        {payload.readiness.checks.map((check) => (
          <article key={check.id} data-complete={check.complete}>
            <span>{check.complete ? '✓' : String(payload.readiness.checks.indexOf(check) + 1)}</span>
            <div><strong>{check.label}</strong><small>{check.detail}</small></div>
          </article>
        ))}
      </div>

      <div className="launch-layout">
        <div className="launch-main-column">
          <article className="launch-panel launch-hosted-card">
            <div className="launch-panel__heading">
              <div>
                <span className="launch-step">01</span>
                <div><h2>Hosted booking link</h2><p>The fastest way to take bookings. No website changes needed.</p></div>
              </div>
              <label className="launch-switch">
                <input
                  type="checkbox"
                  checked={draft.hostedPageEnabled}
                  onChange={(event) => setDraft({ ...draft, hostedPageEnabled: event.target.checked })}
                />
                <span />
              </label>
            </div>
            <div className="launch-link-row">
              <div><small>Customer booking address</small><strong>{payload.hosted.url}</strong></div>
              <button type="button" onClick={() => void copy(payload.hosted.url, 'Booking link')}>Copy link</button>
            </div>
          </article>

          <article className="launch-panel launch-install-card">
            <div className="launch-panel__heading">
              <div>
                <span className="launch-step">02</span>
                <div><h2>Add Chime to a website</h2><p>Choose how booking appears, then paste one self-contained snippet.</p></div>
              </div>
            </div>

            <div className="launch-mode-grid">
              {MODES.map((mode) => (
                <button
                  key={mode.id}
                  type="button"
                  className={selectedMode === mode.id ? 'is-active' : ''}
                  onClick={() => {
                    setSelectedMode(mode.id);
                    setDraft({ ...draft, displayMode: mode.id });
                  }}
                >
                  <span className={`launch-mode-icon launch-mode-icon--${mode.id}`}><i /></span>
                  <strong>{mode.label}</strong>
                  <small>{mode.detail}</small>
                </button>
              ))}
            </div>

            {selectedMode !== 'inline' ? (
              <label className="launch-field launch-button-label">
                <span>Booking button label</span>
                <input value={draft.buttonLabel} maxLength={80} onChange={(event) => setDraft({ ...draft, buttonLabel: event.target.value })} />
              </label>
            ) : null}

            <div className="launch-code">
              <div><span>{MODES.find((mode) => mode.id === selectedMode)?.label} installation code</span><button type="button" onClick={() => void copy(snippet, 'Install code')}>Copy code</button></div>
              <pre><code>{snippet}</code></pre>
            </div>
          </article>

          <article className="launch-panel launch-domain-card">
            <div className="launch-panel__heading">
              <div>
                <span className="launch-step">03</span>
                <div><h2>Choose trusted websites</h2><p>Control which customer sites are permitted to carry this booking widget.</p></div>
              </div>
            </div>
            <label className="launch-any-domain">
              <span><strong>Allow any website</strong><small>Useful for testing. An allowlist is safer for a live business.</small></span>
              <input type="checkbox" checked={draft.allowAnyDomain} onChange={(event) => setDraft({ ...draft, allowAnyDomain: event.target.checked })} />
            </label>
            {!draft.allowAnyDomain ? (
              <>
                <div className="launch-domain-input">
                  <input
                    value={domainInput}
                    placeholder="appointments.yourbusiness.com"
                    onChange={(event) => setDomainInput(event.target.value)}
                    onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addDomain(); } }}
                  />
                  <button type="button" onClick={addDomain}>Add website</button>
                </div>
                <div className="launch-domain-list">
                  {draft.allowedDomains.map((domain) => (
                    <span key={domain}>{domain}<button type="button" aria-label={`Remove ${domain}`} onClick={() => setDraft({ ...draft, allowedDomains: draft.allowedDomains.filter((item) => item !== domain) })}>×</button></span>
                  ))}
                  {draft.allowedDomains.length === 0 ? <small>No websites added yet.</small> : null}
                </div>
              </>
            ) : null}
          </article>

          <details className="launch-panel launch-advanced">
            <summary><span>Advanced delivery settings</span><small>Change these only when moving Chime to a hosted CDN or API.</small></summary>
            <div className="launch-advanced__fields">
              <label className="launch-field"><span>Widget script URL</span><input value={draft.loaderUrl} onChange={(event) => setDraft({ ...draft, loaderUrl: event.target.value })} /></label>
              <label className="launch-field"><span>Widget stylesheet URL</span><input value={draft.stylesheetUrl} onChange={(event) => setDraft({ ...draft, stylesheetUrl: event.target.value })} /></label>
              <label className="launch-field"><span>Customer API URL</span><input value={draft.apiBaseUrl} onChange={(event) => setDraft({ ...draft, apiBaseUrl: event.target.value })} /></label>
              <label className="launch-field"><span>Hosted booking page URL</span><input value={draft.hostedBaseUrl} onChange={(event) => setDraft({ ...draft, hostedBaseUrl: event.target.value })} /></label>
            </div>
          </details>
        </div>

        <aside className="launch-side-column">
          <article className="launch-preview-panel">
            <div className="launch-preview-panel__top"><span>Customer preview</span><small>{MODES.find((mode) => mode.id === selectedMode)?.label}</small></div>
            <div className="launch-preview-canvas" data-mode={selectedMode}>
              <div className="launch-preview-site"><i /><i /><i /></div>
              {selectedMode === 'inline' ? (
                <div className="launch-preview-widget"><span className="launch-preview-bell" /><strong>Book an appointment</strong><small>Choose a service to get started.</small><button type="button">View services</button></div>
              ) : selectedMode === 'modal' ? (
                <><button className="launch-preview-trigger" type="button">{draft.buttonLabel}</button><div className="launch-preview-modal"><span className="launch-preview-bell" /><strong>Book an appointment</strong><small>Fast, clear, and focused.</small></div></>
              ) : (
                <button className="launch-preview-trigger launch-preview-trigger--floating" type="button"><span className="launch-preview-bell" />{draft.buttonLabel}</button>
              )}
            </div>
          </article>

          <article className="launch-panel launch-live-card">
            <div className="launch-live-card__heading"><span className="launch-live-dot" data-live={draft.embedEnabled} /><div><h2>Website widget</h2><p>{draft.embedEnabled ? 'Customers can load Chime on approved sites.' : 'The embed remains private while you finish setup.'}</p></div></div>
            <dl>
              <div><dt>Public ID</dt><dd>{draft.publicBusinessId}</dd></div>
              <div><dt>Published</dt><dd>{formatDate(draft.publishedAt)}</dd></div>
              <div><dt>Domain policy</dt><dd>{draft.allowAnyDomain ? 'Any website' : `${draft.allowedDomains.length} approved`}</dd></div>
            </dl>
            <button
              className={draft.embedEnabled ? 'launch-unpublish-button' : 'launch-publish-button'}
              type="button"
              disabled={saving || (!draft.embedEnabled && !payload.readiness.ready)}
              onClick={() => void persist({ ...draft, embedEnabled: !draft.embedEnabled }, draft.embedEnabled ? 'Website widget paused.' : 'Website widget is live.')}
            >
              {draft.embedEnabled ? 'Pause website widget' : payload.readiness.ready ? 'Publish website widget' : 'Finish setup to publish'}
            </button>
          </article>

          <article className="launch-panel launch-installations">
            <div className="launch-installations__heading"><div><h2>Installation health</h2><p>Sites appear here after the widget checks in.</p></div><span>{payload.installations.length}</span></div>
            {payload.installations.length ? payload.installations.map((installation) => (
              <div className="launch-installation-row" key={installation.id}>
                <span data-status={installation.status} /><div><strong>{installation.domain}</strong><small>Last seen {formatDate(installation.lastSeenAt)}</small></div><b>{installation.status}</b>
              </div>
            )) : (
              <div className="launch-installations__empty"><span /><strong>No site check-ins yet</strong><small>Paste the installation code into an approved website to connect it.</small></div>
            )}
          </article>
        </aside>
      </div>
    </section>
  );
}
