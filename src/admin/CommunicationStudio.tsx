import { useCallback, useEffect, useRef, useState, type ChangeEvent, type ReactNode } from 'react';

import {
  AdminApiClientError,
  type AdminApiClient,
  type AdminCommunicationDelivery,
  type AdminCommunicationTemplate,
  type AdminTemplateTestResult,
  type AdminCommunicationsPayload,
} from './adminApi';
import { useActionPreview } from './actionPreview';
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

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function plainTextToHtml(value: string): string {
  return value
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${escapeHtml(paragraph).replaceAll('\n', '<br>')}</p>`)
    .join('');
}

function htmlToPlainText(value: string): string {
  const document = new DOMParser().parseFromString(value, 'text/html');
  return (document.body.textContent ?? '')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function sanitizeImportedHtml(value: string): string {
  const document = new DOMParser().parseFromString(value, 'text/html');
  document.querySelectorAll('script, iframe, object, embed, form, input, button, meta, base, link')
    .forEach((element) => element.remove());
  document.querySelectorAll('*').forEach((element) => {
    [...element.attributes].forEach((attribute) => {
      const name = attribute.name.toLowerCase();
      const attributeValue = attribute.value.trim().toLowerCase();
      if (name.startsWith('on') || ((name === 'href' || name === 'src') && attributeValue.startsWith('javascript:'))) {
        element.removeAttribute(attribute.name);
      }
    });
  });
  const styles = [...document.querySelectorAll('head style')].map((style) => style.outerHTML).join('');
  return `${styles}${document.body.innerHTML}`.trim();
}

function previewDocument(content: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><style>
    html,body{margin:0;padding:0;background:#f4f6f5;color:#273f37;font-family:Helvetica Neue,Arial,sans-serif}
    .email-shell{max-width:680px;margin:0 auto;padding:28px 16px}.email-paper{background:#fff;border:1px solid #dde6e1;border-radius:14px;box-shadow:0 12px 35px rgba(35,69,58,.08);overflow:hidden}
    .email-content{padding:32px;line-height:1.65;font-size:15px}.email-content img{display:block;height:auto;max-width:100%}.email-content a{color:#26765b}.email-content p:first-child{margin-top:0}.email-content p:last-child{margin-bottom:0}
    @media(max-width:540px){.email-shell{padding:10px}.email-content{padding:22px 18px}}
  </style></head><body><div class="email-shell"><div class="email-paper"><div class="email-content">${content}</div></div></div></body></html>`;
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
  const [view, setView] = useState<'outbox' | 'templates'>('outbox');
  const [testResult, setTestResult] = useState<AdminTemplateTestResult | null>(null);
  const { confirm: confirmAction, element: previewElement } = useActionPreview();
  const [error, setError] = useState<string | null>(null);
  const [editorView, setEditorView] = useState<'compose' | 'html'>('compose');
  const editorRef = useRef<HTMLDivElement | null>(null);
  const htmlFileRef = useRef<HTMLInputElement | null>(null);
  const imageFileRef = useRef<HTMLInputElement | null>(null);

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

  useEffect(() => {
    if (!editorRef.current || !draft || draft.channel !== 'email' || editorView !== 'compose') return;
    const nextHtml = draft.bodyHtml?.trim() || plainTextToHtml(draft.bodyTemplate);
    if (editorRef.current.innerHTML !== nextHtml) editorRef.current.innerHTML = nextHtml;
  }, [selectedTemplateId, editorView]);

  const selectTemplate = (template: AdminCommunicationTemplate) => {
    setSelectedTemplateId(template.id);
    setDraft({ ...template });
    setEditorView(template.contentFormat === 'html' ? 'html' : 'compose');
  };

  const updateFromComposer = () => {
    if (!editorRef.current) return;
    const bodyHtml = editorRef.current.innerHTML;
    setDraft((current) => current ? {
      ...current,
      bodyHtml,
      bodyTemplate: htmlToPlainText(bodyHtml) || current.bodyTemplate,
      contentFormat: 'rich',
      sourceAssetName: null,
    } : current);
  };

  const formatComposer = (command: string, value?: string) => {
    editorRef.current?.focus();
    document.execCommand(command, false, value);
    updateFromComposer();
  };

  const insertLink = () => {
    const url = window.prompt('Paste the full link, beginning with https://');
    if (!url) return;
    if (!/^https?:\/\//i.test(url)) {
      setError('Links must begin with http:// or https://.');
      return;
    }
    formatComposer('createLink', url);
  };

  const insertToken = (token: string) => {
    if (editorView === 'compose') {
      formatComposer('insertText', token);
      return;
    }
    setDraft((current) => current ? {
      ...current,
      bodyHtml: `${current.bodyHtml ?? ''}${token}`,
      bodyTemplate: `${current.bodyTemplate}${token}`,
    } : current);
  };

  const importHtml = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !draft) return;
    if (file.size > 1_000_000) {
      setError('HTML newsletter files must be smaller than 1 MB.');
      return;
    }
    const bodyHtml = sanitizeImportedHtml(await file.text());
    if (!bodyHtml) {
      setError('That HTML file does not contain usable email content.');
      return;
    }
    setDraft({
      ...draft,
      bodyHtml,
      bodyTemplate: htmlToPlainText(bodyHtml) || 'Imported HTML newsletter',
      contentFormat: 'html',
      sourceAssetName: file.name,
    });
    setEditorView('html');
    setError(null);
    onNotify('HTML newsletter imported for preview.');
  };

  const importPng = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !draft) return;
    if (file.type !== 'image/png') {
      setError('Choose a PNG newsletter image.');
      return;
    }
    if (file.size > 1_800_000) {
      setError('PNG newsletters must be smaller than 1.8 MB.');
      return;
    }
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Image could not be read.'));
      reader.onerror = () => reject(new Error('Image could not be read.'));
      reader.readAsDataURL(file);
    });
    const bodyHtml = `<div style="text-align:center"><img src="${dataUrl}" alt="${escapeHtml(file.name.replace(/\.png$/i, ''))}" style="display:block;width:100%;max-width:680px;height:auto;margin:0 auto"></div>`;
    setDraft({
      ...draft,
      bodyHtml,
      bodyTemplate: `Newsletter image: ${file.name}`,
      contentFormat: 'image',
      sourceAssetName: file.name,
    });
    setEditorView('html');
    setError(null);
    onNotify('PNG newsletter imported for preview.');
  };

  const processReady = async () => {
    const ready = payload?.summary.ready ?? 0;
    const live = payload?.runtime.mode === 'live';
    const recipients = [...new Set(
      (payload?.deliveries ?? [])
        .filter((delivery) => delivery.status === 'pending' || delivery.status === 'failed')
        .map((delivery) => delivery.recipient),
    )];

    // Whether this reaches real people is the whole question, and it was
    // decided by an environment variable the administrator could not see from
    // this button.
    const preview = await confirmAction({
      title: live ? 'Send queued messages to customers' : 'Process the message queue',
      summary: live
        ? `Delivers ${ready} queued message${ready === 1 ? '' : 's'} to real customers now.`
        : `Processes ${ready} queued message${ready === 1 ? '' : 's'} in the sandbox. Nothing leaves this machine.`,
      changes: [
        { label: 'Queued messages', before: String(ready), after: '0' },
        { label: 'Delivery mode', after: live ? 'Live — real recipients' : 'Sandbox — recorded, not sent' },
      ],
      notifies: recipients.length
        ? live
          ? `${recipients.length} recipient${recipients.length === 1 ? '' : 's'}, including ${recipients[0]}`
          : `${recipients.length} recipient${recipients.length === 1 ? '' : 's'} would be contacted in live mode`
        : null,
      paymentEffect: null,
      reversible: live
        ? { kind: 'permanent', detail: 'No — a sent message cannot be recalled.' }
        : { kind: 'undo', detail: 'Yes — sandbox deliveries are recorded only and can be retried.' },
      confirmLabel: live ? `Send ${ready} message${ready === 1 ? '' : 's'}` : `Process ${ready} in sandbox`,
      tone: live ? 'caution' : 'normal',
    });
    if (!preview.confirmed) return;

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
    // Suppressing stops a customer receiving something they were meant to
    // receive, so the reason is required and recorded with the account and time.
    const preview = await confirmAction({
      title: 'Stop this message being sent',
      summary: `${delivery.recipient} will not receive the ${delivery.templateKey.replaceAll('_', ' ')} message.`,
      changes: [
        { label: 'Delivery status', before: delivery.status, after: 'Suppressed' },
        { label: 'Recipient', after: delivery.recipient },
      ],
      notifies: null,
      paymentEffect: null,
      reversible: {
        kind: 'undo',
        detail: 'Yes — a suppressed message can be returned to the queue with Retry.',
      },
      confirmLabel: 'Suppress this message',
      tone: 'caution',
      reasonPrompt: 'Why is this being suppressed? Recorded with your name and the time.',
    });
    if (!preview.confirmed) return;

    setWorking(delivery.id);
    setError(null);
    try {
      await api.suppressCommunication(delivery.id, preview.reason ?? '');
      onNotify('Message suppressed. No provider will receive it.');
      await load();
    } catch (suppressError) {
      setError(errorMessage(suppressError));
    } finally {
      setWorking(null);
    }
  };

  const sendTest = async () => {
    if (!draft) return;
    setWorking('test');
    setError(null);
    setTestResult(null);
    try {
      const result = await api.sendTemplateTest(draft.templateKey, draft.channel);
      setTestResult(result);
      onNotify(
        result.mode === 'live'
          ? `Test sent to ${result.recipient}.`
          : `Test queued for ${result.recipient}. Sandbox mode records it without sending.`,
      );
      await load();
    } catch (testError) {
      setError(errorMessage(testError));
    } finally {
      setWorking(null);
    }
  };

  const saveTemplate = async () => {
    if (!draft) return;
    setWorking('template');
    setError(null);
    try {
      const prepared = draft.channel === 'email' && draft.bodyHtml
        ? {
            ...draft,
            bodyHtml: sanitizeImportedHtml(draft.bodyHtml),
            bodyTemplate: htmlToPlainText(draft.bodyHtml) || draft.bodyTemplate,
          }
        : draft;
      const saved = await api.saveCommunicationTemplate(prepared);
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
          <button
            type="button"
            onClick={() => void processReady()}
            disabled={working === 'process' || (payload?.summary.ready ?? 0) === 0}
          >
            <MessageIcon><path d="m21 3-7.5 18-3.2-7.3L3 10.5 21 3Z" /><path d="m10.3 13.7 4.2-4.2" /></MessageIcon>
            {working === 'process'
              ? 'Sending...'
              : (payload?.summary.ready ?? 0) === 0
                ? 'Queue is empty'
                : payload?.runtime.mode === 'live'
                  ? `Send ${payload.summary.ready} queued message${payload.summary.ready === 1 ? '' : 's'}`
                  : `Process ${payload?.summary.ready} in sandbox`}
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

      <div className="communication-tabs" role="tablist" aria-label="Messages">
        <button
          aria-selected={view === 'outbox'}
          className={view === 'outbox' ? 'is-active' : ''}
          onClick={() => setView('outbox')}
          role="tab"
          type="button"
        >
          Outbox
          {(payload?.summary.failed ?? 0) > 0 ? <b>{payload?.summary.failed}</b> : null}
        </button>
        <button
          aria-selected={view === 'templates'}
          className={view === 'templates' ? 'is-active' : ''}
          onClick={() => setView('templates')}
          role="tab"
          type="button"
        >
          Templates
        </button>
      </div>

      <div className="communication-layout" data-view={view}>
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
              {draft.channel === 'email' ? (
                <div className="communication-rich-editor">
                  <div className="communication-editor-mode">
                    <div>
                      <button className={editorView === 'compose' ? 'is-active' : ''} type="button" onClick={() => setEditorView('compose')}>Compose</button>
                      <button className={editorView === 'html' ? 'is-active' : ''} type="button" onClick={() => setEditorView('html')}>HTML</button>
                    </div>
                    <div className="communication-imports">
                      <input ref={htmlFileRef} type="file" accept=".html,.htm,text/html" onChange={(event) => void importHtml(event)} />
                      <input ref={imageFileRef} type="file" accept=".png,image/png" onChange={(event) => void importPng(event)} />
                      <button type="button" onClick={() => htmlFileRef.current?.click()}>Import HTML</button>
                      <button type="button" onClick={() => imageFileRef.current?.click()}>Add newsletter PNG</button>
                    </div>
                  </div>
                  {draft.sourceAssetName ? <div className="communication-imported-file"><span>Imported</span><strong>{draft.sourceAssetName}</strong><button type="button" onClick={() => setDraft({ ...draft, sourceAssetName: null })}>Clear label</button></div> : null}
                  {editorView === 'compose' ? (
                    <>
                      <div className="communication-format-toolbar" aria-label="Email formatting">
                        <select aria-label="Font" defaultValue="Helvetica Neue" onChange={(event) => formatComposer('fontName', event.target.value)}>
                          <option value="Helvetica Neue">Sans serif</option>
                          <option value="Georgia">Serif</option>
                          <option value="Courier New">Monospace</option>
                          <option value="Trebuchet MS">Friendly</option>
                        </select>
                        <select aria-label="Text size" defaultValue="3" onChange={(event) => formatComposer('fontSize', event.target.value)}>
                          <option value="2">Small</option>
                          <option value="3">Normal</option>
                          <option value="5">Large</option>
                          <option value="6">Heading</option>
                        </select>
                        <span />
                        <button type="button" title="Bold" aria-label="Bold" onClick={() => formatComposer('bold')}><b>B</b></button>
                        <button type="button" title="Italic" aria-label="Italic" onClick={() => formatComposer('italic')}><i>I</i></button>
                        <button type="button" title="Underline" aria-label="Underline" onClick={() => formatComposer('underline')}><u>U</u></button>
                        <label className="communication-color" title="Text color"><input aria-label="Text color" type="color" defaultValue="#23443a" onChange={(event) => formatComposer('foreColor', event.target.value)} /><i /></label>
                        <span />
                        <button type="button" title="Bulleted list" aria-label="Bulleted list" onClick={() => formatComposer('insertUnorderedList')}>•</button>
                        <button type="button" title="Numbered list" aria-label="Numbered list" onClick={() => formatComposer('insertOrderedList')}>1.</button>
                        <button type="button" title="Align left" aria-label="Align left" onClick={() => formatComposer('justifyLeft')}>≡</button>
                        <button type="button" title="Center" aria-label="Center" onClick={() => formatComposer('justifyCenter')}>≣</button>
                        <button type="button" title="Add link" aria-label="Add link" onClick={insertLink}>↗</button>
                        <button type="button" title="Remove formatting" aria-label="Remove formatting" onClick={() => formatComposer('removeFormat')}>Tx</button>
                      </div>
                      <div
                        ref={editorRef}
                        className="communication-contenteditable"
                        contentEditable
                        role="textbox"
                        aria-label="Rich email body"
                        aria-multiline="true"
                        onInput={updateFromComposer}
                        suppressContentEditableWarning
                      />
                    </>
                  ) : (
                    <label className="communication-html-source">
                      <span>Email HTML</span>
                      <textarea
                        spellCheck={false}
                        value={draft.bodyHtml ?? plainTextToHtml(draft.bodyTemplate)}
                        onChange={(event) => {
                          const bodyHtml = event.target.value;
                          setDraft({ ...draft, bodyHtml, bodyTemplate: htmlToPlainText(bodyHtml) || draft.bodyTemplate, contentFormat: 'html' });
                        }}
                      />
                    </label>
                  )}
                </div>
              ) : (
                <label>
                  <span>Message body</span>
                  <textarea value={draft.bodyTemplate} onChange={(event) => setDraft({ ...draft, bodyTemplate: event.target.value })} />
                </label>
              )}
              <div className="communication-tokens">
                <small>Personalization tokens</small>
                <button type="button" onClick={() => insertToken('{{customer.name}}')}>{'{{customer.name}}'}</button>
                <button type="button" onClick={() => insertToken('{{appointment.when}}')}>{'{{appointment.when}}'}</button>
                <button type="button" onClick={() => insertToken('{{service.name}}')}>{'{{service.name}}'}</button>
                <button type="button" onClick={() => insertToken('{{approval.url}}')}>{'{{approval.url}}'}</button>
              </div>
              {draft.channel === 'email' ? (
                <div className="communication-email-preview">
                  <div className="communication-email-preview__heading">
                    <div><small>Before it sends</small><strong>Customer email preview</strong></div>
                    <span>Sandboxed</span>
                  </div>
                  <div className="communication-email-envelope">
                    <div><span>From</span><strong>Your business via Chime</strong></div>
                    <div><span>To</span><strong>Maya &lt;maya@example.com&gt;</strong></div>
                    <div><span>Subject</span><strong>{templatePreview(draft.subjectTemplate) || 'No subject yet'}</strong></div>
                  </div>
                  <iframe
                    title="Email preview"
                    sandbox=""
                    srcDoc={previewDocument(templatePreview(draft.bodyHtml) || plainTextToHtml(templatePreview(draft.bodyTemplate)))}
                  />
                  <p>Previewing and importing do not send anything. Only queued deliveries can be processed.</p>
                </div>
              ) : (
                <div className="communication-preview">
                  <small>Customer preview</small>
                  <p>{templatePreview(draft.bodyTemplate)}</p>
                </div>
              )}
              <div className="communication-editor__footer">
                <label className="communication-toggle">
                  <input type="checkbox" checked={draft.isActive} onChange={(event) => setDraft({ ...draft, isActive: event.target.checked })} />
                  <span><i />Active template</span>
                </label>
                {/* The plan asks that an administrator be able to check a
                    template safely before activating it. The recipient is the
                    signed-in account, taken from the session on the server. */}
                <button
                  className="communication-test-button"
                  disabled={working === 'test'}
                  onClick={() => void sendTest()}
                  type="button"
                >
                  {working === 'test' ? 'Sending test...' : 'Send test to myself'}
                </button>
                <button type="button" onClick={() => void saveTemplate()} disabled={working === 'template'}>
                  {working === 'template' ? 'Saving...' : 'Save language'}
                </button>
              </div>
            </div>
          ) : <div className="communication-empty">No editable templates are available yet.</div>}

          {testResult ? (
            <div className="communication-test-result" role="status">
              <strong>Test {testResult.mode === 'live' ? 'sent' : 'queued'}</strong>
              <dl>
                <div><dt>To</dt><dd>{testResult.recipient}</dd></div>
                <div><dt>Delivery</dt><dd>{testResult.mode === 'live' ? 'Live — really sent' : 'Sandbox — recorded, not sent'}</dd></div>
                {testResult.rendered.subject
                  ? <div><dt>Subject</dt><dd>{testResult.rendered.subject}</dd></div>
                  : null}
              </dl>
              <pre>{testResult.rendered.body}</pre>
              <button onClick={() => setTestResult(null)} type="button">Dismiss</button>
            </div>
          ) : null}
        </aside>
      </div>
      {previewElement}
    </section>
  );
}
