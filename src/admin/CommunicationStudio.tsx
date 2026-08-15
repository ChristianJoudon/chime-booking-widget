import { useCallback, useEffect, useState, type ReactNode } from 'react';

import {
  AdminApiClientError,
  type AdminApiClient,
  type AdminCommunicationDelivery,
  type AdminCommunicationTemplate,
  type AdminCommunicationsPayload,
} from './adminApi';
import './communicationStudio.css';

type CommunicationFilter = 'all' | 'ready' | 'failed' | 'sent' | 'suppressed';

interface CommunicationStudioProps {
  api: AdminApiClient;
  onNotify: (message: string) => void;
}

function MessageIcon({ children }: { children: ReactNode }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      {children}
    </svg>
  );
}

function friendlyTime(value: string | null): string {
  if (!value) return 'Not sent yet';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown time';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

function statusLabel(status: AdminCommunicationDelivery['status']): string {
  if (status === 'pending') return 'Ready';
  if (status === 'processing') return 'Sending';
  if (status === 'sent' || status === 'delivered') return 'Sent';
  if (status === 'failed') return 'Needs attention';
  return 'Suppressed';
}

function templatePreview(value: string | null): string {
  if (!value) return '';
  const replacements: Record<string, string> = {
    'customer.name': 'Maya',
    'service.name': 'Quick check-in',
    'appointment.when': 'Monday, August 17 at 11:05 AM',
    'appointment.referenceCode': 'CH-38A201F4',
    'staff.name': 'Lei Nakamura',
    'location.name': 'Studio A',
    'approval.url': 'chime.app/review/38A201F4',
  };
  return value.replace(/{{\s*([a-zA-Z0-9_.]+)\s*}}/g, (_match, key: string) =>
    replacements[key] ?? `[${key}]`);
}

function errorMessage(error: unknown): string {
  if (error instanceof AdminApiClientError) return error.message;
  if (error instanceof Error) return error.message;
  return 'The communications workspace could not complete that action.';
}

export default function CommunicationStudio({ api, onNotify }: CommunicationStudioProps) {
  const [payload, setPayload] = useState<AdminCommunicationsPayload | null>(null);
  const [templates, setTemplates] = useState<AdminCommunicationTemplate[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [draft, setDraft] = useState<AdminCommunicationTemplate | null>(null);
  const [filter, setFilter] = useState<CommunicationFilter>('all');
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [nextPayload, nextTemplates] = await Promise.all([
        api.listCommunications(filter),
        api.listCommunicationTemplates(),
      ]);
      setPayload(nextPayload);
      setTemplates(nextTemplates);
      const nextId = selectedTemplateId && nextTemplates.some((item) => item.id === selectedTemplateId)
        ? selectedTemplateId
        : nextTemplates[0]?.id ?? null;
      setSelectedTemplateId(nextId);
      setDraft(nextTemplates.find((item) => item.id === nextId) ?? null);
    } catch (loadError) {
      setError(errorMessage(loadError));
    } finally {
      setLoading(false);
    }
  }, [api, filter, selectedTemplateId]);

  useEffect(() => {
    void load();
  }, [load]);

  const selectTemplate = (template: AdminCommunicationTemplate) => {
    setSelectedTemplateId(template.id);
    setDraft({ ...template });
  };

  const processReady = async () => {
    setWorking('process');
    setError(null);
    try {
      const { result } = await api.processCommunications();
      onNotify(result.claimed
        ? `${result.sent} message${result.sent === 1 ? '' : 's'} processed in ${result.mode} mode.`
        : 'The message queue is already caught up.');
      await load();
    } catch (processError) {
      setError(errorMessage(processError));
    } finally {
      setWorking(null);
    }
  };

  const retry = async (delivery: AdminCommunicationDelivery) => {
    setWorking(delivery.id);
    setError(null);
    try {
      await api.retryCommunication(delivery.id);
      onNotify('Message returned to the ready queue.');
      await load();
    } catch (retryError) {
      setError(errorMessage(retryError));
    } finally {
      setWorking(null);
    }
  };

  const suppress = async (delivery: AdminCommunicationDelivery) => {
    setWorking(delivery.id);
    setError(null);
    try {
      await api.suppressCommunication(delivery.id);
      onNotify('Message suppressed. No provider will receive it.');
      await load();
    } catch (suppressError) {
      setError(errorMessage(suppressError));
    } finally {
      setWorking(null);
    }
  };

  const saveTemplate = async () => {
    if (!draft) return;
    setWorking('template');
    setError(null);
    try {
      const saved = await api.saveCommunicationTemplate(draft);
      setTemplates((current) => current.map((item) => item.id === saved.id ? saved : item));
      setDraft(saved);
      onNotify('Message template saved. New deliveries will use it immediately.');
    } catch (saveError) {
      setError(errorMessage(saveError));
    } finally {
      setWorking(null);
    }
  };

  const summary = payload?.summary ?? {
    total: 0,
    ready: 0,
    processing: 0,
    sent: 0,
    failed: 0,
    suppressed: 0,
  };

  return (
    <section className="communication-studio">
      <header className="communication-hero">
        <div>
          <p>Customer communications</p>
          <h1>Every message, visible and under control.</h1>
          <span>Review what is ready, retry what failed, and shape the language customers receive without touching code.</span>
        </div>
        <div className="communication-hero__actions">
          <span className={`communication-mode is-${payload?.runtime.mode ?? 'sandbox'}`}>
            <i />{payload?.runtime.mode === 'live' ? 'Live delivery' : 'Safe sandbox'}
          </span>
          <button type="button" onClick={() => void processReady()} disabled={working === 'process'}>
            <MessageIcon><path d="m21 3-7.5 18-3.2-7.3L3 10.5 21 3Z" /><path d="m10.3 13.7 4.2-4.2" /></MessageIcon>
            {working === 'process' ? 'Processing...' : 'Process ready'}
          </button>
        </div>
      </header>

      {payload?.runtime.mode === 'sandbox' ? (
        <div className="communication-sandbox">
          <MessageIcon><path d="M12 3 4.5 6v5.5c0 4.4 2.6 7.8 7.5 9.5 4.9-1.7 7.5-5.1 7.5-9.5V6L12 3Z" /><path d="m9 12 2 2 4-4" /></MessageIcon>
          <span><strong>Nothing leaves Chime yet.</strong> Sandbox processing records a realistic success without contacting Resend, Twilio, or a webhook.</span>
        </div>
      ) : null}

      {error ? <div className="communication-error" role="alert">{error}</div> : null}

      <div className="communication-metrics">
        <article>
          <span className="is-mint"><MessageIcon><path d="M5 12h14M13 6l6 6-6 6" /></MessageIcon></span>
          <div><small>Ready now</small><strong>{summary.ready}</strong><p>waiting to send</p></div>
        </article>
        <article>
          <span className="is-blue"><MessageIcon><path d="m5 12 4 4L19 6" /></MessageIcon></span>
          <div><small>Sent</small><strong>{summary.sent}</strong><p>completed deliveries</p></div>
        </article>
        <article>
          <span className="is-coral"><MessageIcon><path d="M12 8v5M12 17h.01" /><circle cx="12" cy="12" r="9" /></MessageIcon></span>
          <div><small>Needs attention</small><strong>{summary.failed}</strong><p>clear retry options</p></div>
        </article>
        <article>
          <span className="is-gold"><MessageIcon><path d="M4 6h16v12H4z" /><path d="m4 8 8 6 8-6" /></MessageIcon></span>
          <div><small>Total tracked</small><strong>{summary.total}</strong><p>auditable messages</p></div>
        </article>
      </div>

      <div className="communication-layout">
        <section className="communication-queue">
          <div className="communication-section-heading">
            <div><p>Delivery desk</p><h2>Message queue</h2></div>
            <button className="communication-refresh" type="button" onClick={() => void load()} disabled={loading} aria-label="Refresh messages">
              <MessageIcon><path d="M20 7v5h-5" /><path d="M18.2 16a8 8 0 1 1 .7-9L20 12" /></MessageIcon>
            </button>
          </div>
          <div className="communication-filters" aria-label="Message filters">
            {(['all', 'ready', 'failed', 'sent', 'suppressed'] as const).map((item) => (
              <button className={filter === item ? 'is-active' : ''} type="button" key={item} onClick={() => setFilter(item)}>
                {item === 'all' ? 'All' : item === 'failed' ? 'Attention' : item[0].toUpperCase() + item.slice(1)}
              </button>
            ))}
          </div>
          <div className="communication-list" aria-live="polite">
            {loading ? <div className="communication-empty">Loading the delivery desk...</div> : null}
            {!loading && payload?.deliveries.map((delivery) => (
              <article className="communication-row" data-status={delivery.status} key={delivery.id}>
                <span className="communication-row__channel">
                  {delivery.channel === 'sms'
                    ? <MessageIcon><rect x="6" y="2.5" width="12" height="19" rx="2" /><path d="M10 18h4" /></MessageIcon>
                    : <MessageIcon><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m4 7 8 6 8-6" /></MessageIcon>}
                </span>
                <div className="communication-row__body">
                  <div>
                    <strong>{delivery.customerName ?? delivery.recipient}</strong>
                    <span className={`communication-status is-${delivery.status}`}>{statusLabel(delivery.status)}</span>
                  </div>
                  <p>{delivery.serviceName ?? delivery.templateKey.split('_').join(' ')}</p>
                  <small>{delivery.recipient} · {friendlyTime(delivery.sentAt ?? delivery.createdAt)}</small>
                  {delivery.lastError ? <em>{delivery.lastError}</em> : null}
                  {delivery.attempts.length ? (
                    <span className="communication-attempt">Last attempt: {delivery.attempts[0].provider} · {friendlyTime(delivery.attempts[0].startedAt)}</span>
                  ) : null}
                </div>
                <div className="communication-row__actions">
                  {(delivery.status === 'failed' || delivery.status === 'suppressed') ? (
                    <button type="button" onClick={() => void retry(delivery)} disabled={working === delivery.id}>Retry</button>
                  ) : null}
                  {(delivery.status === 'pending' || delivery.status === 'failed') ? (
                    <button className="is-quiet" type="button" onClick={() => void suppress(delivery)} disabled={working === delivery.id}>Suppress</button>
                  ) : null}
                </div>
              </article>
            ))}
            {!loading && payload?.deliveries.length === 0 ? (
              <div className="communication-empty">
                <MessageIcon><path d="M5 12h14M12 5v14" /></MessageIcon>
                <strong>Nothing in this view.</strong>
                <span>The queue is calm, and that is a good thing.</span>
              </div>
            ) : null}
          </div>
        </section>

        <aside className="communication-templates">
          <div className="communication-section-heading">
            <div><p>No-code language</p><h2>Template lab</h2></div>
            <span>{templates.length} versions</span>
          </div>
          <div className="communication-template-tabs">
            {templates.map((template) => (
              <button className={template.id === selectedTemplateId ? 'is-active' : ''} type="button" key={template.id} onClick={() => selectTemplate(template)}>
                <span>{template.channel === 'email' ? 'Email' : 'Text'}</span>
                <strong>{template.displayName}</strong>
              </button>
            ))}
          </div>

          {draft ? (
            <div className="communication-editor">
              <label>
                <span>Internal name</span>
                <input value={draft.displayName} onChange={(event) => setDraft({ ...draft, displayName: event.target.value })} />
              </label>
              {draft.channel === 'email' ? (
                <label>
                  <span>Subject line</span>
                  <input value={draft.subjectTemplate ?? ''} onChange={(event) => setDraft({ ...draft, subjectTemplate: event.target.value })} />
                </label>
              ) : null}
              <label>
                <span>Message body</span>
                <textarea value={draft.bodyTemplate} onChange={(event) => setDraft({ ...draft, bodyTemplate: event.target.value })} />
              </label>
              <div className="communication-tokens">
                <small>Personalization tokens</small>
                <span>{'{{customer.name}}'}</span>
                <span>{'{{appointment.when}}'}</span>
                <span>{'{{service.name}}'}</span>
                <span>{'{{approval.url}}'}</span>
              </div>
              <div className="communication-preview">
                <small>Customer preview</small>
                {draft.subjectTemplate ? <strong>{templatePreview(draft.subjectTemplate)}</strong> : null}
                <p>{templatePreview(draft.bodyTemplate)}</p>
              </div>
              <div className="communication-editor__footer">
                <label className="communication-toggle">
                  <input type="checkbox" checked={draft.isActive} onChange={(event) => setDraft({ ...draft, isActive: event.target.checked })} />
                  <span><i />Active template</span>
                </label>
                <button type="button" onClick={() => void saveTemplate()} disabled={working === 'template'}>
                  {working === 'template' ? 'Saving...' : 'Save language'}
                </button>
              </div>
            </div>
          ) : <div className="communication-empty">No editable templates are available yet.</div>}
        </aside>
      </div>
    </section>
  );
}
