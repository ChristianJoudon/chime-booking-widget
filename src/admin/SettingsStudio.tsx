import { useEffect, useMemo, useState } from 'react';

import {
  AdminApiClientError,
  type AdminApiClient,
  type AdminBusinessSettings,
  type AdminBusinessSettingsPayload,
} from './adminApi';
import './settingsStudio.css';

type SettingsStudioProps = { api: AdminApiClient; onNotify: (message: string) => void };
type SettingsTab = 'business' | 'booking' | 'customers' | 'readiness';

const TIME_ZONES = [
  ['Pacific/Honolulu', 'Hawaii'],
  ['America/Los_Angeles', 'Pacific time'],
  ['America/Denver', 'Mountain time'],
  ['America/Chicago', 'Central time'],
  ['America/New_York', 'Eastern time'],
];

const EMPTY_SETTINGS: AdminBusinessSettings = {
  organizationId: '',
  businessName: '',
  publicName: '',
  businessType: 'other',
  serviceMode: 'business_location',
  contactEmail: '',
  contactPhone: '',
  websiteUrl: '',
  timeZone: 'Pacific/Honolulu',
  currency: 'USD',
  bookingPageSlug: '',
  appointmentIncrementMinutes: 15,
  minimumNoticeMinutes: 120,
  maximumAdvanceDays: 60,
  confirmationMode: 'automatic',
  changePolicy: 'customer_approval',
  customerCancellationAllowed: true,
  customerReschedulingAllowed: true,
  cancellationNoticeMinutes: 1440,
  rescheduleNoticeMinutes: 1440,
  customerWelcomeMessage: 'Choose the service and time that work best for you.',
  confirmationMessage: 'Your appointment is on the calendar. We look forward to seeing you.',
  cancellationPolicySummary: 'Please give us advance notice if your plans change.',
  version: 1,
  updatedAt: new Date(0).toISOString(),
};

const EMPTY_PAYLOAD: AdminBusinessSettingsPayload = {
  settings: EMPTY_SETTINGS,
  setup: { score: 0, completed: 0, total: 6, launchReady: false, items: [] },
};

function minutesLabel(value: number): string {
  if (value === 0) return 'Any time';
  if (value < 60) return `${value} minutes`;
  if (value % 1440 === 0) return `${value / 1440} day${value === 1440 ? '' : 's'}`;
  return `${value / 60} hours`;
}

export default function SettingsStudio({ api, onNotify }: SettingsStudioProps) {
  const [payload, setPayload] = useState<AdminBusinessSettingsPayload>(EMPTY_PAYLOAD);
  const [draft, setDraft] = useState<AdminBusinessSettings>(EMPTY_SETTINGS);
  const [tab, setTab] = useState<SettingsTab>('business');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!api.configured) { setLoading(false); return; }
      try {
        const result = await api.getBusinessSettings();
        if (!cancelled) { setPayload(result); setDraft(result.settings); }
      } catch (loadError) {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : 'Business settings could not be loaded.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [api]);

  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(payload.settings), [draft, payload.settings]);

  function update<K extends keyof AdminBusinessSettings>(key: K, value: AdminBusinessSettings[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  async function save() {
    if (!api.configured || saving || !dirty) return;
    setSaving(true);
    setError(null);
    try {
      const result = await api.saveBusinessSettings(draft);
      setPayload(result);
      setDraft(result.settings);
      onNotify('Business settings saved for your customer experience.');
    } catch (saveError) {
      setError(saveError instanceof AdminApiClientError ? saveError.message : saveError instanceof Error ? saveError.message : 'Business settings could not be saved.');
    } finally {
      setSaving(false);
    }
  }

  const tabs: Array<{ id: SettingsTab; label: string; detail: string }> = [
    { id: 'business', label: 'Business', detail: 'Identity and contact details' },
    { id: 'booking', label: 'Booking rules', detail: 'Timing and approvals' },
    { id: 'customers', label: 'Customer experience', detail: 'Policies and language' },
    { id: 'readiness', label: 'Setup readiness', detail: `${payload.setup.completed} of ${payload.setup.total} essentials` },
  ];

  return (
    <section className="settings-studio" aria-labelledby="settings-title">
      <header className="settings-header">
        <div><p>Business controls</p><h1 id="settings-title">Settings</h1><span>Shape how Chime works for your business and your customers.</span></div>
        <div className="settings-header__actions">
          {dirty ? <span>Unsaved changes</span> : <span className="is-saved">Everything saved</span>}
          <button type="button" onClick={() => void save()} disabled={!dirty || saving || loading}>{saving ? 'Saving...' : 'Save settings'}</button>
        </div>
      </header>

      {error ? <div className="settings-error" role="alert">{error}</div> : null}

      <div className="settings-layout">
        <nav className="settings-nav" aria-label="Business settings sections">
          {tabs.map((item) => (
            <button className={tab === item.id ? 'is-active' : ''} key={item.id} type="button" onClick={() => setTab(item.id)}>
              <i aria-hidden="true" /><span><strong>{item.label}</strong><small>{item.detail}</small></span>
            </button>
          ))}
          <div className="settings-score-mini">
            <span>Setup strength</span><strong>{payload.setup.score}%</strong>
            <div><i style={{ width: `${payload.setup.score}%` }} /></div>
            <small>{payload.setup.launchReady ? 'Essential setup is ready.' : 'Finish the essentials before launch.'}</small>
          </div>
        </nav>

        <main className={`settings-editor${loading ? ' is-loading' : ''}`}>
          {tab === 'business' ? (
            <>
              <div className="settings-section-heading"><p>Business identity</p><h2>What customers should know about you</h2><span>These details belong to this business workspace and can appear in the booking experience.</span></div>
              <div className="settings-form-grid">
                <label><span>Internal business name</span><input value={draft.businessName} onChange={(event) => update('businessName', event.target.value)} /><small>Used by your team inside Chime.</small></label>
                <label><span>Public business name</span><input value={draft.publicName} onChange={(event) => update('publicName', event.target.value)} /><small>Shown to customers.</small></label>
                <label><span>Business type</span><select value={draft.businessType} onChange={(event) => update('businessType', event.target.value as AdminBusinessSettings['businessType'])}><option value="consulting">Consulting and professional services</option><option value="beauty">Beauty and personal care</option><option value="wellness">Wellness and health services</option><option value="coaching">Coaching and training</option><option value="education">Education and tutoring</option><option value="home_services">Home and on-site services</option><option value="repair">Repair and technical services</option><option value="other">Another small business</option></select></label>
                <label><span>How you serve customers</span><select value={draft.serviceMode} onChange={(event) => update('serviceMode', event.target.value as AdminBusinessSettings['serviceMode'])}><option value="business_location">At the business location</option><option value="mobile">At the customer's location</option><option value="virtual">Virtually</option><option value="mixed">A mix of locations</option></select></label>
                <label><span>Customer contact email</span><input type="email" value={draft.contactEmail} onChange={(event) => update('contactEmail', event.target.value)} placeholder="hello@yourbusiness.com" /></label>
                <label><span>Customer contact phone</span><input type="tel" value={draft.contactPhone} onChange={(event) => update('contactPhone', event.target.value)} placeholder="(808) 555-0123" /></label>
                <label className="is-wide"><span>Website</span><input type="url" value={draft.websiteUrl} onChange={(event) => update('websiteUrl', event.target.value)} placeholder="https://yourbusiness.com" /></label>
                <label><span>Business time zone</span><select value={draft.timeZone} onChange={(event) => update('timeZone', event.target.value)}>{TIME_ZONES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
                <label><span>Currency</span><select value={draft.currency} onChange={(event) => update('currency', event.target.value)}><option value="USD">USD - US dollar</option><option value="CAD">CAD - Canadian dollar</option><option value="AUD">AUD - Australian dollar</option><option value="EUR">EUR - Euro</option><option value="GBP">GBP - British pound</option></select></label>
              </div>
            </>
          ) : null}

          {tab === 'booking' ? (
            <>
              <div className="settings-section-heading"><p>Booking defaults</p><h2>Set the guardrails once</h2><span>Individual services can still override these defaults when they need different rules.</span></div>
              <div className="settings-choice-block"><span>Appointment time grid</span><div className="settings-segmented">{[5, 10, 15, 20, 30, 60].map((minutes) => <button className={draft.appointmentIncrementMinutes === minutes ? 'is-active' : ''} key={minutes} type="button" onClick={() => update('appointmentIncrementMinutes', minutes)}>{minutes} min</button>)}</div></div>
              <div className="settings-form-grid">
                <label><span>Minimum notice</span><select value={draft.minimumNoticeMinutes} onChange={(event) => update('minimumNoticeMinutes', Number(event.target.value))}><option value={0}>No minimum</option><option value={60}>1 hour</option><option value={120}>2 hours</option><option value={240}>4 hours</option><option value={720}>12 hours</option><option value={1440}>1 day</option><option value={2880}>2 days</option></select><small>Customers cannot book sooner than this.</small></label>
                <label><span>How far ahead</span><select value={draft.maximumAdvanceDays} onChange={(event) => update('maximumAdvanceDays', Number(event.target.value))}><option value={14}>2 weeks</option><option value={30}>30 days</option><option value={60}>60 days</option><option value={90}>90 days</option><option value={180}>6 months</option><option value={365}>1 year</option></select></label>
              </div>
              <div className="settings-rule-cards">
                <button className={draft.confirmationMode === 'automatic' ? 'is-selected' : ''} type="button" onClick={() => update('confirmationMode', 'automatic')}><i /><span><strong>Confirm automatically</strong><small>The appointment enters the calendar immediately when all requirements are met.</small></span></button>
                <button className={draft.confirmationMode === 'manual' ? 'is-selected' : ''} type="button" onClick={() => update('confirmationMode', 'manual')}><i /><span><strong>Review new requests</strong><small>Your team approves each customer request before it is confirmed.</small></span></button>
              </div>
              <div className="settings-choice-block"><span>When your team changes an appointment</span><div className="settings-policy-list"><label><input type="radio" checked={draft.changePolicy === 'instant'} onChange={() => update('changePolicy', 'instant')} /><span><strong>Apply immediately</strong><small>Notify the customer after the time changes.</small></span></label><label><input type="radio" checked={draft.changePolicy === 'customer_approval'} onChange={() => update('changePolicy', 'customer_approval')} /><span><strong>Ask the customer</strong><small>Keep the original time until the customer approves.</small></span></label><label><input type="radio" checked={draft.changePolicy === 'business_review'} onChange={() => update('changePolicy', 'business_review')} /><span><strong>Require business review</strong><small>A manager approves schedule changes before they are sent.</small></span></label></div></div>
            </>
          ) : null}

          {tab === 'customers' ? (
            <>
              <div className="settings-section-heading"><p>Customer experience</p><h2>Make policies easy to understand</h2><span>Customers should know exactly what happens before and after they book.</span></div>
              <div className="settings-toggle-list">
                <label><span><strong>Let customers cancel online</strong><small>Customers can cancel from their secure appointment link.</small></span><input type="checkbox" checked={draft.customerCancellationAllowed} onChange={(event) => update('customerCancellationAllowed', event.target.checked)} /></label>
                <label><span><strong>Let customers reschedule online</strong><small>Available times still follow your services and working hours.</small></span><input type="checkbox" checked={draft.customerReschedulingAllowed} onChange={(event) => update('customerReschedulingAllowed', event.target.checked)} /></label>
              </div>
              <div className="settings-form-grid">
                <label><span>Cancellation cutoff</span><select value={draft.cancellationNoticeMinutes} disabled={!draft.customerCancellationAllowed} onChange={(event) => update('cancellationNoticeMinutes', Number(event.target.value))}>{[0, 120, 720, 1440, 2880, 4320, 10080].map((value) => <option key={value} value={value}>{minutesLabel(value)}</option>)}</select></label>
                <label><span>Rescheduling cutoff</span><select value={draft.rescheduleNoticeMinutes} disabled={!draft.customerReschedulingAllowed} onChange={(event) => update('rescheduleNoticeMinutes', Number(event.target.value))}>{[0, 120, 720, 1440, 2880, 4320, 10080].map((value) => <option key={value} value={value}>{minutesLabel(value)}</option>)}</select></label>
                <label className="is-wide"><span>Welcome message</span><textarea rows={3} value={draft.customerWelcomeMessage} onChange={(event) => update('customerWelcomeMessage', event.target.value)} /></label>
                <label className="is-wide"><span>Confirmation message</span><textarea rows={3} value={draft.confirmationMessage} onChange={(event) => update('confirmationMessage', event.target.value)} /></label>
                <label className="is-wide"><span>Cancellation policy summary</span><textarea rows={4} value={draft.cancellationPolicySummary} onChange={(event) => update('cancellationPolicySummary', event.target.value)} /></label>
              </div>
            </>
          ) : null}

          {tab === 'readiness' ? (
            <>
              <div className="settings-section-heading"><p>Launch readiness</p><h2>{payload.setup.launchReady ? 'Your essentials are ready' : 'Finish the customer booking loop'}</h2><span>This checks real Chime setup records, not a decorative checklist.</span></div>
              <div className="settings-readiness-summary"><div className="settings-readiness-ring" style={{ '--score': `${payload.setup.score}%` } as React.CSSProperties}><span><strong>{payload.setup.score}%</strong><small>ready</small></span></div><div><strong>{payload.setup.completed} of {payload.setup.total} essentials complete</strong><p>{payload.setup.launchReady ? 'Customers have the information and rules they need to book confidently.' : 'Work through the incomplete items below. Customer deposits remain optional.'}</p></div></div>
              <div className="settings-checklist">{payload.setup.items.map((item) => <article className={item.complete ? 'is-complete' : ''} key={item.id}><i>{item.complete ? '✓' : ''}</i><span><strong>{item.label}{!item.required ? ' (optional)' : ''}</strong><small>{item.detail}</small></span><b>{item.complete ? 'Ready' : item.required ? 'Needed' : 'Optional'}</b></article>)}</div>
            </>
          ) : null}
        </main>

        <aside className="settings-preview">
          <div className="settings-preview__head"><span>Customer preview</span><b>Live draft</b></div>
          <div className="settings-preview__card">
            <small>Book with</small><h3>{draft.publicName || 'Your business'}</h3><p>{draft.customerWelcomeMessage}</p>
            <div><span>Appointments every</span><strong>{draft.appointmentIncrementMinutes} minutes</strong></div>
            <div><span>Book ahead</span><strong>Up to {draft.maximumAdvanceDays} days</strong></div>
            <div><span>Confirmation</span><strong>{draft.confirmationMode === 'automatic' ? 'Immediate' : 'Business review'}</strong></div>
            <button type="button">Choose a service</button>
          </div>
          <label className="settings-slug"><span>Hosted booking page</span><div><b>chime.app/book/</b><input value={draft.bookingPageSlug} onChange={(event) => update('bookingPageSlug', event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))} /></div><small>The portable website widget uses the same business settings.</small></label>
        </aside>
      </div>
    </section>
  );
}
