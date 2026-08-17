/* eslint-disable react-refresh/only-export-components */
import { useCallback, useRef, useState, type ReactNode } from 'react';

import './actionPreview.css';

/**
 * One outcome preview for every consequential administrator action.
 *
 * Appointment adjustment already previewed its changes before sending them; the
 * tightening plan asks for that pattern everywhere. Before this, exactly one
 * action in the studio confirmed anything at all — a browser confirm() on
 * payments reading "Are you sure you want to refund $145.00 to Maya Kealoha?" —
 * and publishing availability, processing the message queue, activating a
 * template and opening the widget to customers all fired on a single click.
 *
 * The six facts below are the ones the plan lists. They are separate fields
 * rather than prose so an action cannot quietly omit one: a caller that does
 * not say whether a customer is notified renders "No one is notified", which is
 * a claim someone will notice is wrong.
 */

export interface PreviewChange {
  label: string;
  /** Omit for something being created rather than changed. */
  before?: ReactNode;
  after: ReactNode;
}

export type Reversibility =
  /** Can be put back through the interface. */
  | { kind: 'undo'; detail: string }
  /** Not one click, but recoverable — say how. */
  | { kind: 'recoverable'; detail: string }
  /** Cannot be taken back. */
  | { kind: 'permanent'; detail: string };

export interface ActionPreviewRequest {
  title: string;
  /** One sentence naming the outcome, not the mechanism. */
  summary: string;
  changes?: PreviewChange[];
  /** Who receives a message because of this. Null means nobody. */
  notifies?: string | null;
  /** Whether the customer must approve before it takes effect. */
  requiresCustomerApproval?: boolean;
  /** How money is affected. Null means not at all. */
  paymentEffect?: string | null;
  reversible: Reversibility;
  confirmLabel: string;
  /** Draws the confirm button as destructive. */
  tone?: 'normal' | 'caution';
  /** Collects a reason, required before confirming. */
  reasonPrompt?: string;
}

export interface ActionPreviewResult {
  confirmed: boolean;
  reason?: string;
}

interface Pending {
  request: ActionPreviewRequest;
  resolve: (result: ActionPreviewResult) => void;
}

/**
 * Returns a `confirm` to await before performing an action, and the element to
 * render. Kept as a hook rather than a global so each studio owns its own
 * dialog and nothing leaks between screens.
 */
export function useActionPreview() {
  const [pending, setPending] = useState<Pending | null>(null);
  const [reason, setReason] = useState('');
  const pendingRef = useRef<Pending | null>(null);

  const confirm = useCallback((request: ActionPreviewRequest) => {
    return new Promise<ActionPreviewResult>((resolve) => {
      const next = { request, resolve };
      pendingRef.current = next;
      setReason('');
      setPending(next);
    });
  }, []);

  const settle = useCallback((confirmed: boolean) => {
    const current = pendingRef.current;
    pendingRef.current = null;
    setPending(null);
    current?.resolve({ confirmed, reason: reason.trim() || undefined });
  }, [reason]);

  const element = pending ? (
    <ActionPreviewDialog
      onCancel={() => settle(false)}
      onConfirm={() => settle(true)}
      onReasonChange={setReason}
      reason={reason}
      request={pending.request}
    />
  ) : null;

  return { confirm, element };
}

interface DialogProps {
  request: ActionPreviewRequest;
  reason: string;
  onReasonChange: (value: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
}

function ActionPreviewDialog({
  request, reason, onReasonChange, onConfirm, onCancel,
}: DialogProps) {
  const needsReason = Boolean(request.reasonPrompt);
  const blocked = needsReason && reason.trim().length < 3;

  return (
    <div
      className="action-preview__backdrop"
      onClick={(event) => { if (event.target === event.currentTarget) onCancel(); }}
      role="presentation"
    >
      <div
        aria-labelledby="action-preview-title"
        aria-modal="true"
        className={`action-preview action-preview--${request.tone ?? 'normal'}`}
        role="dialog"
      >
        <h2 id="action-preview-title">{request.title}</h2>
        <p className="action-preview__summary">{request.summary}</p>

        {request.changes?.length ? (
          <dl className="action-preview__changes">
            {request.changes.map((change) => (
              <div key={change.label}>
                <dt>{change.label}</dt>
                <dd>
                  {change.before !== undefined ? (
                    <>
                      <s>{change.before}</s>
                      <span aria-hidden="true">→</span>
                    </>
                  ) : null}
                  <strong>{change.after}</strong>
                </dd>
              </div>
            ))}
          </dl>
        ) : null}

        <ul className="action-preview__facts">
          <li>
            <span>Who is notified</span>
            <strong>{request.notifies ?? 'No one is notified'}</strong>
          </li>
          <li>
            <span>Customer approval</span>
            <strong>
              {request.requiresCustomerApproval
                ? 'Required before this takes effect'
                : 'Not required'}
            </strong>
          </li>
          <li>
            <span>Payment</span>
            <strong>{request.paymentEffect ?? 'Not affected'}</strong>
          </li>
          <li data-reversible={request.reversible.kind}>
            <span>Can this be undone</span>
            <strong>{request.reversible.detail}</strong>
          </li>
        </ul>

        {request.reasonPrompt ? (
          <label className="action-preview__reason">
            <span>{request.reasonPrompt}</span>
            <textarea
              autoFocus
              onChange={(event) => onReasonChange(event.target.value)}
              rows={2}
              value={reason}
            />
          </label>
        ) : null}

        <div className="action-preview__actions">
          <button onClick={onCancel} type="button">Cancel</button>
          <button
            className="action-preview__confirm"
            disabled={blocked}
            onClick={onConfirm}
            type="button"
          >
            {request.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
