import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

type AppointmentVersion = {
  startsAt: string;
  endsAt: string;
  durationMinutes: number;
  staffName: string | null;
  locationName: string | null;
};

type CustomerAction = {
  status:
    | 'pending'
    | 'approved'
    | 'declined'
    | 'expired'
    | 'withdrawn'
    | 'unavailable';
  canDecide: boolean;
  expiresAt: string;
  decidedAt: string | null;
  decision: 'approve' | 'decline' | null;
  referenceCode: string;
  customerName: string;
  serviceName: string;
  reason: string;
  requestedAt: string;
  current: AppointmentVersion;
  proposed: AppointmentVersion;
};

type ApiErrorShape = {
  error?: {
    code?: string;
    message?: string;
  } | string;
};

const API_URL = String(
  import.meta.env.VITE_CHIME_API_URL ?? 'http://127.0.0.1:8887/api/chime',
).replace(/\/$/, '');

function icon(path: ReactNode) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      {path}
    </svg>
  );
}

const calendarIcon = icon(
  <>
    <rect x="3" y="5" width="18" height="16" rx="3" />
    <path d="M8 3v4M16 3v4M3 10h18M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01" />
  </>,
);
const clockIcon = icon(
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </>,
);
const personIcon = icon(
  <>
    <circle cx="12" cy="8" r="3" />
    <path d="M5 21v-2a7 7 0 0 1 14 0v2" />
  </>,
);
const pinIcon = icon(
  <>
    <path d="M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0Z" />
    <circle cx="12" cy="10" r="2" />
  </>,
);
const arrowIcon = icon(<path d="M5 12h14m-5-5 5 5-5 5" />);
const checkIcon = icon(<path d="m5 12 4 4L19 6" />);
const lockIcon = icon(
  <>
    <rect x="4" y="10" width="16" height="11" rx="3" />
    <path d="M8 10V7a4 4 0 0 1 8 0v3" />
  </>,
);
const alertIcon = icon(
  <>
    <path d="M12 3 2.8 20h18.4L12 3Z" />
    <path d="M12 9v4m0 3h.01" />
  </>,
);

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || 'Hello';
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  }).format(new Date(value));
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value));
}

function formatShortDate(value: string): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(value));
}

async function parseError(response: Response): Promise<string> {
  const payload = await response.json().catch(() => null) as ApiErrorShape | null;
  if (typeof payload?.error === 'string') return payload.error;
  return payload?.error?.message ?? 'Chime could not complete that request.';
}

function DetailRow({
  iconNode,
  label,
  value,
}: {
  iconNode: ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="approval-detail-row">
      <span>{iconNode}</span>
      <div>
        <small>{label}</small>
        <strong>{value}</strong>
      </div>
    </div>
  );
}

function AppointmentCard({
  appointment,
  label,
  tone,
}: {
  appointment: AppointmentVersion;
  label: string;
  tone: 'current' | 'proposed';
}) {
  return (
    <article className={`approval-appointment-card is-${tone}`}>
      <span className="approval-card-label">{label}</span>
      <h3>{formatDate(appointment.startsAt)}</h3>
      <DetailRow
        iconNode={clockIcon}
        label="Time"
        value={`${formatTime(appointment.startsAt)} · ${appointment.durationMinutes} minutes`}
      />
      <DetailRow
        iconNode={personIcon}
        label="With"
        value={appointment.staffName ?? 'A team member'}
      />
      <DetailRow
        iconNode={pinIcon}
        label="Location"
        value={appointment.locationName ?? 'Details provided by the business'}
      />
    </article>
  );
}

export default function ApprovalApp() {
  const token = useMemo(
    () => new URLSearchParams(window.location.search).get('token') ?? '',
    [],
  );
  const [action, setAction] = useState<CustomerAction | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState<'approve' | 'decline' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState('');

  const load = useCallback(async () => {
    if (!token) {
      setError('This approval link is incomplete.');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(
        `${API_URL}/customer-actions/${encodeURIComponent(token)}`,
        { headers: { Accept: 'application/json' } },
      );
      if (!response.ok) throw new Error(await parseError(response));
      const payload = await response.json() as { action: CustomerAction };
      setAction(payload.action);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : 'This approval link could not be loaded.',
      );
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  const decide = async (decision: 'approve' | 'decline') => {
    setSubmitting(decision);
    setError(null);
    try {
      const response = await fetch(
        `${API_URL}/customer-actions/${encodeURIComponent(token)}/decision`,
        {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ decision, note: note.trim() || null }),
        },
      );
      if (!response.ok) throw new Error(await parseError(response));
      const payload = await response.json() as { action: CustomerAction };
      setAction(payload.action);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (decisionError) {
      setError(
        decisionError instanceof Error
          ? decisionError.message
          : 'Your decision could not be saved.',
      );
    } finally {
      setSubmitting(null);
    }
  };

  return (
    <main className="approval-page">
      <div className="approval-orb is-one" />
      <div className="approval-orb is-two" />
      <header className="approval-brand">
        <span className="approval-brand-mark">
          <i />
          <i />
          <i />
        </span>
        <div>
          <strong>chime</strong>
          <small>appointment review</small>
        </div>
      </header>

      <section className="approval-shell" aria-live="polite">
        {loading && (
          <div className="approval-loading">
            <span className="approval-spinner" />
            <strong>Opening your appointment...</strong>
            <p>Checking that this private link is still active.</p>
          </div>
        )}

        {!loading && error && !action && (
          <div className="approval-state is-error">
            <span>{alertIcon}</span>
            <small>Link unavailable</small>
            <h1>We could not open this request.</h1>
            <p>{error}</p>
            <p className="approval-state-help">
              Contact the business directly if you still need to adjust your appointment.
            </p>
          </div>
        )}

        {!loading && action?.status === 'pending' && (
          <>
            <div className="approval-intro">
              <span className="approval-kicker">Appointment change requested</span>
              <h1>
                {firstName(action.customerName)}, does this new time work for you?
              </h1>
              <p>
                Review the original appointment beside the proposed update. Nothing
                changes until you approve it.
              </p>
              <div className="approval-reference">
                <span>{calendarIcon}</span>
                <div>
                  <small>{action.referenceCode}</small>
                  <strong>{action.serviceName}</strong>
                </div>
              </div>
            </div>

            <blockquote className="approval-reason">
              <span>Why it is changing</span>
              <p>{action.reason}</p>
            </blockquote>

            <div className="approval-comparison">
              <AppointmentCard
                appointment={action.current}
                label="Your current appointment"
                tone="current"
              />
              <span className="approval-comparison-arrow">{arrowIcon}</span>
              <AppointmentCard
                appointment={action.proposed}
                label="Proposed new appointment"
                tone="proposed"
              />
            </div>

            {error && (
              <div className="approval-inline-error" role="alert">
                {alertIcon}
                <span>{error}</span>
              </div>
            )}

            <label className="approval-note">
              <span>
                Add a note <small>optional</small>
              </span>
              <textarea
                value={note}
                onChange={(event) => setNote(event.target.value)}
                maxLength={600}
                placeholder="Anything the business should know?"
              />
            </label>

            <div className="approval-actions">
              <button
                className="approval-decline"
                type="button"
                disabled={submitting !== null}
                onClick={() => void decide('decline')}
              >
                {submitting === 'decline' ? 'Saving...' : 'Keep my original time'}
              </button>
              <button
                className="approval-approve"
                type="button"
                disabled={submitting !== null}
                onClick={() => void decide('approve')}
              >
                {checkIcon}
                {submitting === 'approve' ? 'Confirming...' : 'Approve the new time'}
              </button>
            </div>

            <div className="approval-security">
              {lockIcon}
              <p>
                This private link works once and expires on{' '}
                <strong>{formatShortDate(action.expiresAt)}</strong>. Your original
                appointment stays in place if you decline.
              </p>
            </div>
          </>
        )}

        {!loading && action?.status === 'approved' && (
          <div className="approval-state is-success">
            <span>{checkIcon}</span>
            <small>Change approved</small>
            <h1>Your new appointment is confirmed.</h1>
            <p>
              The business and your assigned team member have been notified.
            </p>
            <div className="approval-final-card">
              <strong>{action.serviceName}</strong>
              <span>{formatDate(action.proposed.startsAt)}</span>
              <span>
                {formatTime(action.proposed.startsAt)} · {action.proposed.durationMinutes} minutes
              </span>
              <small>
                {action.proposed.staffName}
                {action.proposed.locationName ? ` · ${action.proposed.locationName}` : ''}
              </small>
            </div>
          </div>
        )}

        {!loading && action?.status === 'declined' && (
          <div className="approval-state is-neutral">
            <span>{calendarIcon}</span>
            <small>Original time kept</small>
            <h1>Your appointment has not changed.</h1>
            <p>The business has been notified that the proposed time did not work.</p>
            <div className="approval-final-card">
              <strong>{action.serviceName}</strong>
              <span>{formatDate(action.current.startsAt)}</span>
              <span>
                {formatTime(action.current.startsAt)} · {action.current.durationMinutes} minutes
              </span>
            </div>
          </div>
        )}

        {!loading && action && ['expired', 'withdrawn', 'unavailable'].includes(action.status) && (
          <div className="approval-state is-expired">
            <span>{clockIcon}</span>
            <small>Request closed</small>
            <h1>This change request is no longer active.</h1>
            <p>
              Your original appointment remains in place. Contact the business if you
              would like another option.
            </p>
            <div className="approval-final-card">
              <strong>{action.serviceName}</strong>
              <span>{formatDate(action.current.startsAt)}</span>
              <span>{formatTime(action.current.startsAt)}</span>
            </div>
          </div>
        )}
      </section>

      <footer className="approval-footer">
        <span>Powered by Chime</span>
        <small>Private appointment coordination for small businesses.</small>
      </footer>
    </main>
  );
}
