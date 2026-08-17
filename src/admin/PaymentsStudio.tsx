import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  AdminApiClientError,
  type AdminApiClient,
  type AdminPaymentActionName,
  type AdminPaymentRecord,
  type AdminPaymentsPayload,
} from './adminApi';
import { describeMissingConnection } from './adminConnection';
import { StudioStateNotice, type StudioStatus } from './studioState';
import { useActionPreview, type ActionPreviewRequest } from './actionPreview';
import './paymentsStudio.css';

type PaymentsStudioProps = {
  api: AdminApiClient;
  onNotify: (message: string) => void;
};

type PaymentFilter = 'all' | 'attention' | 'authorized' | 'collected' | 'refunded' | 'cancelled';

const FILTERS: Array<{ id: PaymentFilter; label: string }> = [
  { id: 'all', label: 'All deposits' },
  { id: 'attention', label: 'Needs attention' },
  { id: 'authorized', label: 'Authorized' },
  { id: 'collected', label: 'Collected' },
  { id: 'refunded', label: 'Refunded' },
  { id: 'cancelled', label: 'Voided' },
];

const EMPTY: AdminPaymentsPayload = {
  runtime: {
    provider: 'none',
    mode: 'unconfigured',
    configured: false,
    actionsEnabled: false,
    message: 'Connect Stripe before collecting or returning customer deposits.',
  },
  summary: {
    currency: 'USD',
    total: 0,
    collectedCount: 0,
    collectedMinor: 0,
    authorizedCount: 0,
    authorizedMinor: 0,
    pendingCount: 0,
    pendingMinor: 0,
    refundedCount: 0,
    refundedMinor: 0,
    failedCount: 0,
  },
  payments: [],
};

function money(amountMinor: number, currency = 'USD'): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
  }).format(amountMinor / 100);
}

function appointmentDate(value: string): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value));
}

function shortDate(value: string): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(value));
}

function statusLabel(status: AdminPaymentRecord['status']): string {
  const labels: Record<AdminPaymentRecord['status'], string> = {
    requires_payment: 'Awaiting payment',
    processing: 'Processing',
    authorized: 'Authorized',
    succeeded: 'Collected',
    failed: 'Failed',
    partially_refunded: 'Partially refunded',
    refunded: 'Refunded',
    cancelled: 'Voided',
  };
  return labels[status];
}

function initials(name: string): string {
  return name.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase();
}

function providerLabel(payload: AdminPaymentsPayload): string {
  if (payload.runtime.mode === 'live') return 'Stripe live';
  if (payload.runtime.mode === 'test') return 'Stripe test';
  if (payload.runtime.mode === 'demo') return 'Chime demo';
  return 'Not connected';
}

/**
 * What each payment action actually does, in the terms the plan asks for.
 * Written per action rather than generated, because the honest answer to
 * "can this be undone" differs sharply between them and a generic sentence
 * would be wrong for at least one.
 */
function paymentPreview(
  action: AdminPaymentActionName,
  payment: AdminPaymentRecord,
  amountMinor?: number,
): ActionPreviewRequest {
  const currency = payment.currency;
  const held = payment.amountMinor - payment.refundedAmountMinor;

  if (action === 'capture') {
    return {
      title: 'Collect this deposit',
      summary: `Charges the card ${payment.customerName} authorized for ${payment.serviceName}.`,
      changes: [
        { label: 'Deposit status', before: statusLabel(payment.status), after: 'Collected' },
        { label: 'Amount charged', after: money(held, currency) },
      ],
      notifies: null,
      paymentEffect: `${money(held, currency)} moves from authorized to collected.`,
      reversible: {
        kind: 'recoverable',
        detail: 'Yes — it can be refunded afterwards, which returns the money.',
      },
      confirmLabel: `Collect ${money(held, currency)}`,
    };
  }

  if (action === 'void') {
    return {
      title: 'Void this authorization',
      summary: `Releases the hold on ${payment.customerName}'s card without taking any money.`,
      changes: [
        { label: 'Deposit status', before: statusLabel(payment.status), after: 'Voided' },
        { label: 'Amount charged', before: money(held, currency), after: money(0, currency) },
      ],
      notifies: null,
      paymentEffect: 'Nothing is charged. The hold is released.',
      reversible: {
        kind: 'permanent',
        detail: 'No — the customer would have to pay again from the start.',
      },
      confirmLabel: 'Void authorization',
      tone: 'caution',
      reasonPrompt: 'Why is this authorization being voided?',
    };
  }

  if (action === 'refund') {
    const amount = amountMinor ?? 0;
    const remaining = Math.max(payment.capturedAmountMinor - payment.refundedAmountMinor - amount, 0);
    return {
      title: 'Return money to the customer',
      summary: `Refunds ${money(amount, currency)} to ${payment.customerName} for ${payment.serviceName}.`,
      changes: [
        { label: 'Refunded so far', before: money(payment.refundedAmountMinor, currency), after: money(payment.refundedAmountMinor + amount, currency) },
        { label: 'Still held', before: money(payment.capturedAmountMinor - payment.refundedAmountMinor, currency), after: money(remaining, currency) },
      ],
      notifies: null,
      paymentEffect: `${money(amount, currency)} is returned to the original payment method.`,
      reversible: {
        kind: 'permanent',
        detail: 'No — a refund cannot be reversed. The customer would need to pay again.',
      },
      confirmLabel: `Refund ${money(amount, currency)}`,
      tone: 'caution',
      reasonPrompt: 'Why is this being refunded?',
    };
  }

  return {
    title: 'Sync with the payment provider',
    summary: `Re-reads this deposit's status from ${payment.provider === 'demo' ? 'the demo provider' : 'Stripe'}.`,
    notifies: null,
    paymentEffect: 'No money moves. Only Chime\'s copy of the status is updated.',
    reversible: { kind: 'undo', detail: 'Nothing to undo — this only reads.' },
    confirmLabel: 'Sync status',
  };
}

export default function PaymentsStudio({ api, onNotify }: PaymentsStudioProps) {
  const [payload, setPayload] = useState<AdminPaymentsPayload>(EMPTY);
  const [filter, setFilter] = useState<PaymentFilter>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<StudioStatus>('loading');
  const { confirm: confirmAction, element: previewElement } = useActionPreview();
  const [busyAction, setBusyAction] = useState<AdminPaymentActionName | null>(null);
  const [refundAmount, setRefundAmount] = useState('');
  const [reason, setReason] = useState('');

  const load = useCallback(async () => {
    if (!api.configured) {
      // An empty ledger and an unreachable one look identical to an
      // administrator. Say which this is.
      setPayload(EMPTY);
      setStatus('unconfigured');
      setError(describeMissingConnection());
      setLoading(false);
      return;
    }
    setLoading(true);
    setStatus('loading');
    setError(null);
    try {
      const next = await api.listPayments(filter);
      setPayload(next);
      setStatus(next.payments.length ? 'ready' : 'empty');
      setSelectedId((current) => current && next.payments.some((payment) => payment.id === current)
        ? current
        : next.payments[0]?.id ?? null);
    } catch (loadError) {
      setStatus('failed');
      setError(loadError instanceof Error ? loadError.message : 'Payments could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [api, filter]);

  useEffect(() => { void load(); }, [load]);

  const selected = useMemo(
    () => payload.payments.find((payment) => payment.id === selectedId) ?? null,
    [payload.payments, selectedId],
  );

  useEffect(() => {
    if (!selected) return;
    const refundable = Math.max(selected.capturedAmountMinor - selected.refundedAmountMinor, 0);
    setRefundAmount((refundable / 100).toFixed(2));
    setReason('');
  }, [selected?.id, selected?.refundedAmountMinor]);

  async function act(action: AdminPaymentActionName) {
    if (!selected || busyAction) return;
    const amountMinor = action === 'refund' ? Math.round(Number(refundAmount) * 100) : undefined;
    if (action === 'refund' && (!amountMinor || amountMinor <= 0)) {
      setError('Enter a refund amount greater than zero.');
      return;
    }
    // Replaces a browser confirm() that named the action but not its
    // consequences: not the amount left afterwards, not whether the customer
    // hears about it, not whether it can be taken back.
    const preview = await confirmAction(paymentPreview(action, selected, amountMinor));
    if (!preview.confirmed) return;
    const actionReason = preview.reason ?? reason;

    setBusyAction(action);
    setError(null);
    try {
      const result = await api.performPaymentAction(selected, action, { amountMinor, reason: actionReason });
      setPayload((current) => ({
        ...current,
        payments: current.payments.map((payment) => payment.id === result.payment.id ? result.payment : payment),
      }));
      onNotify(action === 'refund'
        ? `Refund recorded for ${selected.customerName}.`
        : `Payment ${action} completed for ${selected.customerName}.`);
      await load();
    } catch (actionError) {
      const message = actionError instanceof AdminApiClientError
        ? actionError.message
        : actionError instanceof Error
          ? actionError.message
          : 'The payment action could not be completed.';
      setError(message);
    } finally {
      setBusyAction(null);
    }
  }

  const summaryCards = [
    { label: 'Net collected', value: money(payload.summary.collectedMinor, payload.summary.currency), note: `${payload.summary.collectedCount} customer deposits`, tone: 'mint' },
    { label: 'Authorized', value: money(payload.summary.authorizedMinor, payload.summary.currency), note: `${payload.summary.authorizedCount} ready to collect`, tone: 'sky' },
    { label: 'Processing', value: money(payload.summary.pendingMinor, payload.summary.currency), note: `${payload.summary.pendingCount} still in motion`, tone: 'lemon' },
    { label: 'Returned', value: money(payload.summary.refundedMinor, payload.summary.currency), note: `${payload.summary.refundedCount} refunds`, tone: 'peach' },
  ];

  return (
    <section className="payments-studio" aria-labelledby="payments-title">
      <header className="payments-header">
        <div>
          <p>Money</p>
          <h1 id="payments-title">Payments</h1>
          <span>Know what was authorized, collected, returned, or needs attention.</span>
        </div>
        <div className={`payments-provider is-${payload.runtime.mode}`}>
          <i aria-hidden="true" />
          <span><small>Payment provider</small><strong>{providerLabel(payload)}</strong></span>
          <button type="button" onClick={() => onNotify(payload.runtime.message)}>Details</button>
        </div>
      </header>

      <div className="payments-summary" aria-label="Payment summary">
        {summaryCards.map((card) => (
          <article className={`payments-summary-card is-${card.tone}`} key={card.label}>
            <span>{card.label}</span>
            <strong>{card.value}</strong>
            <small>{card.note}</small>
          </article>
        ))}
      </div>

      <div className="payments-toolbar">
        <div className="payments-filters" aria-label="Filter payments">
          {FILTERS.map((option) => (
            <button
              className={filter === option.id ? 'is-active' : ''}
              key={option.id}
              type="button"
              onClick={() => setFilter(option.id)}
            >
              {option.label}
              {option.id === 'attention' && payload.summary.failedCount > 0 ? <b>{payload.summary.failedCount}</b> : null}
            </button>
          ))}
        </div>
        <button className="payments-refresh" type="button" onClick={() => void load()} disabled={loading}>
          {loading ? 'Refreshing...' : 'Refresh ledger'}
        </button>
      </div>

      <StudioStateNotice
        status={status}
        error={error}
        onRetry={() => void load()}
        loadingLabel="Loading the payment ledger..."
        emptyTitle="No payments yet"
        emptyBody="Deposits appear here once a customer books a service that requires one."
      />

      <div className="payments-workspace">
        <div className="payments-ledger">
          <div className="payments-ledger__head">
            <span>Customer</span><span>Appointment</span><span>Deposit</span><span>Status</span>
          </div>
          {loading && payload.payments.length === 0 ? (
            <div className="payments-empty">Loading customer deposits...</div>
          ) : payload.payments.length === 0 ? (
            <div className="payments-empty">
              <strong>No deposits in this view</strong>
              <span>Customer deposits will appear here after Chime verifies the payment.</span>
            </div>
          ) : payload.payments.map((payment) => (
            <button
              className={`payments-row${selectedId === payment.id ? ' is-selected' : ''}`}
              key={payment.id}
              type="button"
              onClick={() => setSelectedId(payment.id)}
            >
              <span className="payments-customer">
                <i>{initials(payment.customerName)}</i>
                <span><strong>{payment.customerName}</strong><small>{payment.customerEmail ?? payment.referenceCode}</small></span>
              </span>
              <span><strong>{payment.serviceName}</strong><small>{appointmentDate(payment.startsAt)}</small></span>
              <span><strong>{money(payment.amountMinor, payment.currency)}</strong><small>{payment.provider === 'demo' ? 'Demo payment' : 'Stripe'}</small></span>
              <span className={`payments-status is-${payment.status}`}><i />{statusLabel(payment.status)}</span>
            </button>
          ))}
        </div>

        <aside className="payments-detail" aria-label="Selected payment details">
          {selected ? (
            <>
              <div className="payments-detail__top">
                <span className={`payments-status is-${selected.status}`}><i />{statusLabel(selected.status)}</span>
                <small>{selected.referenceCode}</small>
                <h2>{selected.customerName}</h2>
                <p>{selected.serviceName} · {appointmentDate(selected.startsAt)}</p>
              </div>

              <dl className="payments-breakdown">
                <div><dt>Deposit</dt><dd>{money(selected.amountMinor, selected.currency)}</dd></div>
                <div><dt>Collected</dt><dd>{money(selected.capturedAmountMinor, selected.currency)}</dd></div>
                <div><dt>Returned</dt><dd>{money(selected.refundedAmountMinor, selected.currency)}</dd></div>
                <div className="is-total"><dt>Net</dt><dd>{money(selected.capturedAmountMinor - selected.refundedAmountMinor, selected.currency)}</dd></div>
              </dl>

              <div className="payments-provider-reference">
                <span>Provider reference</span>
                <code>{selected.providerPaymentId}</code>
                <small>{selected.verifiedAt ? `Verified ${shortDate(selected.verifiedAt)}` : 'Not yet verified'}</small>
              </div>

              {selected.failureMessage ? <div className="payments-detail__warning">{selected.failureMessage}</div> : null}

              <div className="payments-actions">
                <div><h3>Actions</h3><p>Every action is recorded in Chime’s activity history.</p></div>
                {selected.status === 'authorized' ? (
                  <div className="payments-action-row">
                    <button type="button" onClick={() => void act('capture')} disabled={!payload.runtime.actionsEnabled || busyAction !== null}>
                      {busyAction === 'capture' ? 'Collecting...' : 'Collect deposit'}
                    </button>
                    <button className="is-secondary" type="button" onClick={() => void act('void')} disabled={!payload.runtime.actionsEnabled || busyAction !== null}>Release the hold</button>
                  </div>
                ) : null}
                {['succeeded', 'partially_refunded'].includes(selected.status) && selected.capturedAmountMinor > selected.refundedAmountMinor ? (
                  <div className="payments-refund-form">
                    <label><span>Refund amount</span><div><b>{selected.currency}</b><input inputMode="decimal" value={refundAmount} onChange={(event) => setRefundAmount(event.target.value)} /></div></label>
                    <label><span>Reason for your records</span><input value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Customer request, appointment cancelled..." /></label>
                    <button type="button" onClick={() => void act('refund')} disabled={!payload.runtime.actionsEnabled || busyAction !== null}>{busyAction === 'refund' ? 'Returning...' : 'Return to customer'}</button>
                  </div>
                ) : null}
                <button className="payments-sync" type="button" onClick={() => void act('sync')} disabled={!payload.runtime.actionsEnabled || busyAction !== null}>{busyAction === 'sync' ? 'Syncing...' : 'Sync provider status'}</button>
                {!payload.runtime.actionsEnabled ? <small className="payments-actions__locked">{payload.runtime.message}</small> : null}
              </div>

              <div className="payments-history">
                <h3>Activity</h3>
                {selected.actions.length ? selected.actions.map((action) => (
                  <div className="payments-history__item" key={action.id}>
                    <i className={`is-${action.status}`} />
                    <span><strong>{action.action === 'capture' ? 'Deposit collected' : action.action === 'void' ? 'Authorization voided' : action.action === 'refund' ? 'Customer refund' : 'Provider synced'}</strong><small>{shortDate(action.createdAt)}{action.reason ? ` · ${action.reason}` : ''}</small></span>
                    {action.amountMinor > 0 ? <b>{money(action.amountMinor, selected.currency)}</b> : null}
                  </div>
                )) : <p className="payments-history__empty">No administrator actions yet.</p>}
              </div>
            </>
          ) : (
            <div className="payments-detail__empty"><strong>Select a deposit</strong><span>Customer, appointment, and provider details will appear here.</span></div>
          )}
        </aside>
      </div>
      {previewElement}
    </section>
  );
}
