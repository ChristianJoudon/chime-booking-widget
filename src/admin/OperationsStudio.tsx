import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type FormEvent,
  type ReactNode,
} from 'react';
import './operationsStudio.css';
import { useActionPreview } from './actionPreview';
import { getAdminConnection, describeMissingConnection } from './adminConnection';

type OperationsStudioProps = {
  initialWorkspace?: 'schedule' | 'requests';
  onNotify: (message: string) => void;
};

type StaffMember = {
  id: string;
  name: string;
  email: string;
  color: string;
  isActive: boolean;
};

type Location = {
  id: string;
  name: string;
  timeZone: string;
  isActive: boolean;
};

type ChangeRequest = {
  id: string;
  requestedByKind: 'user' | 'customer' | 'system';
  requestedByUserId: string | null;
  proposedChanges: {
    startsAt?: string;
    endsAt?: string;
    durationMinutes?: number;
    staffMemberId?: string;
    locationId?: string | null;
  };
  reason: string;
  status: string;
  createdAt: string;
};

type Appointment = {
  id: string;
  referenceCode: string;
  startsAt: string;
  endsAt: string;
  timeZone: string;
  status:
    | 'pending_approval'
    | 'confirmed'
    | 'change_pending'
    | 'declined'
    | 'cancelled'
    | 'completed'
    | 'no_show';
  source: string;
  confirmationMode: string;
  changeApprovalMode: string;
  customerNotes: string | null;
  internalNotes: string | null;
  version: number;
  customer: {
    id: string;
    name: string;
    email: string;
    phone: string | null;
  };
  service: {
    id: string;
    name: string;
    durationMinutes: number;
    minimumDurationMinutes: number;
    maximumDurationMinutes: number;
    durationIncrementMinutes: number;
    bufferBeforeMinutes: number;
    bufferAfterMinutes: number;
  };
  staff: {
    id: string;
    name: string;
    email: string;
    color: string;
  } | null;
  location: {
    id: string;
    name: string;
    timeZone: string;
  } | null;
  pendingChange: ChangeRequest | null;
};

type Notification = {
  id: string;
  appointmentId: string | null;
  changeRequestId: string | null;
  kind: string;
  title: string;
  body: string;
  payload: Record<string, unknown>;
  isRead: boolean;
  readAt: string | null;
  createdAt: string;
};

type OperationsPayload = {
  appointments: Appointment[];
  staff: StaffMember[];
  locations: Location[];
  notifications: Notification[];
};

class OperationsApiError extends Error {}

const HOUR_HEIGHT = 76;
const DAY_START_MINUTES = 8 * 60;
const DAY_END_MINUTES = 18 * 60;

async function operationsRequest<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  // Resolved per request, not at module load: the session appears at sign-in
  // and disappears at sign-out.
  const connection = getAdminConnection();
  if (!connection) {
    throw new OperationsApiError(
      describeMissingConnection() ?? 'The administrator session is not configured.',
    );
  }
  const response = await fetch(`${connection.baseUrl}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${connection.token}`,
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...init.headers,
    },
  });
  const payload = await response.json().catch(() => null) as {
    error?: { message?: string };
  } | null;
  if (!response.ok) {
    throw new OperationsApiError(
      payload?.error?.message ?? 'Chime could not complete that operation.',
    );
  }
  return payload as T;
}

function operationHeaders(version: number) {
  return {
    'If-Match': `"${version}"`,
    'Idempotency-Key': crypto.randomUUID(),
  };
}

function startOfWeek(value: Date): Date {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  const day = date.getDay();
  date.setDate(date.getDate() - (day === 0 ? 6 : day - 1));
  return date;
}

function addDays(value: Date, amount: number): Date {
  const date = new Date(value);
  date.setDate(date.getDate() + amount);
  return date;
}

function localDateKey(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function inputDateTime(value: Date): string {
  const hours = String(value.getHours()).padStart(2, '0');
  const minutes = String(value.getMinutes()).padStart(2, '0');
  return `${localDateKey(value)}T${hours}:${minutes}`;
}

function formatTime(value: Date): string {
  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  }).format(value);
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value));
}

function weekLabel(start: Date): string {
  const end = addDays(start, 4);
  const first = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
  }).format(start);
  if (start.getMonth() === end.getMonth()) {
    return `${first} - ${end.getDate()}, ${end.getFullYear()}`;
  }
  const last = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(end);
  return `${first} - ${last}`;
}

function statusLabel(status: Appointment['status']): string {
  const labels: Record<Appointment['status'], string> = {
    pending_approval: 'Needs approval',
    confirmed: 'Confirmed',
    change_pending: 'Change pending',
    declined: 'Declined',
    cancelled: 'Cancelled',
    completed: 'Completed',
    no_show: 'No-show',
  };
  return labels[status];
}

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
const bellIcon = icon(
  <>
    <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" />
    <path d="M10 21h4" />
  </>,
);
const peopleIcon = icon(
  <>
    <circle cx="9" cy="8" r="3" />
    <path d="M3 20v-2a6 6 0 0 1 12 0v2M16 5a3 3 0 0 1 0 6M18 14a5 5 0 0 1 3 4v2" />
  </>,
);
const arrowLeft = icon(<path d="m15 18-6-6 6-6" />);
const arrowRight = icon(<path d="m9 18 6-6-6-6" />);
const checkIcon = icon(<path d="m5 12 4 4L19 6" />);
const closeIcon = icon(<path d="m7 7 10 10M17 7 7 17" />);

export default function OperationsStudio({
  initialWorkspace = 'schedule',
  onNotify,
}: OperationsStudioProps) {
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()));
  const [payload, setPayload] = useState<OperationsPayload>({
    appointments: [],
    staff: [],
    locations: [],
    notifications: [],
  });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [staffFilter, setStaffFilter] = useState<string>('all');
  const [workspace, setWorkspace] = useState<'schedule' | 'requests'>(initialWorkspace);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draftStartsAt, setDraftStartsAt] = useState('');
  const [draftDuration, setDraftDuration] = useState(60);
  const [draftStaffId, setDraftStaffId] = useState('');
  const [draftLocationId, setDraftLocationId] = useState('');
  const [changeReason, setChangeReason] = useState('');
  const [decisionNote, setDecisionNote] = useState('');
  const { confirm: confirmAction, element: previewElement } = useActionPreview();

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const rangeStart = weekStart.toISOString();
      const rangeEnd = addDays(weekStart, 7).toISOString();
      const next = await operationsRequest<OperationsPayload>(
        `/operations?startsAt=${encodeURIComponent(rangeStart)}&endsAt=${encodeURIComponent(rangeEnd)}`,
      );
      setPayload(next);
      setSelectedId((current) => {
        if (current && next.appointments.some((appointment) => appointment.id === current)) {
          return current;
        }
        return next.appointments.find((appointment) =>
          ['pending_approval', 'change_pending', 'confirmed'].includes(appointment.status),
        )?.id ?? null;
      });
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : 'The operations schedule could not be loaded.',
      );
    } finally {
      setLoading(false);
    }
  }, [weekStart]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setWorkspace(initialWorkspace);
  }, [initialWorkspace]);

  const selected = useMemo(
    () => payload.appointments.find((appointment) => appointment.id === selectedId) ?? null,
    [payload.appointments, selectedId],
  );

  useEffect(() => {
    if (!selected) return;
    setDraftStartsAt(inputDateTime(new Date(selected.startsAt)));
    setDraftDuration(
      Math.round(
        (new Date(selected.endsAt).getTime() - new Date(selected.startsAt).getTime())
          / 60_000,
      ),
    );
    setDraftStaffId(selected.staff?.id ?? payload.staff[0]?.id ?? '');
    setDraftLocationId(selected.location?.id ?? '');
    setChangeReason('');
    setDecisionNote('');
  }, [selected, payload.staff]);

  const weekDays = useMemo(
    () => Array.from({ length: 5 }, (_, index) => addDays(weekStart, index)),
    [weekStart],
  );
  const visibleAppointments = useMemo(
    () => payload.appointments.filter((appointment) =>
      staffFilter === 'all' || appointment.staff?.id === staffFilter,
    ),
    [payload.appointments, staffFilter],
  );
  const requests = useMemo(
    () => payload.appointments.filter((appointment) =>
      appointment.status === 'pending_approval' || appointment.status === 'change_pending',
    ),
    [payload.appointments],
  );
  const unreadCount = payload.notifications.filter((notification) => !notification.isRead).length;
  const confirmedCount = payload.appointments.filter(
    (appointment) => appointment.status === 'confirmed',
  ).length;
  const activeStaffCount = payload.staff.filter((staff) => staff.isActive).length;

  const runMutation = useCallback(
    async (operation: () => Promise<unknown>, successMessage: string) => {
      setSaving(true);
      setError(null);
      try {
        await operation();
        onNotify(successMessage);
        await load();
      } catch (mutationError) {
        const message = mutationError instanceof Error
          ? mutationError.message
          : 'That change could not be saved.';
        setError(message);
        onNotify(message);
      } finally {
        setSaving(false);
      }
    },
    [load, onNotify],
  );

  const decide = (decision: 'approve' | 'decline') => {
    if (!selected) return;
    const approving = decision === 'approve';
    void (async () => {
    const preview = await confirmAction({
      title: approving ? 'Approve this appointment' : 'Decline this appointment',
      summary: approving
        ? `Confirms ${selected.customer.name}'s ${selected.service.name} and tells them it is booked.`
        : `Declines ${selected.customer.name}'s ${selected.service.name} and reopens the time for other customers.`,
      changes: [
        {
          label: 'Appointment status',
          before: statusLabel(selected.status),
          after: approving ? 'Confirmed' : 'Declined',
        },
        { label: 'The time slot', after: approving ? 'Stays reserved' : 'Becomes available again' },
      ],
      notifies: `${selected.customer.name} at ${selected.customer.email}`,
      paymentEffect: null,
      reversible: approving
        ? { kind: 'recoverable', detail: 'Yes — the appointment can be cancelled afterwards.' }
        : { kind: 'permanent', detail: 'No — the customer would have to book again.' },
      confirmLabel: approving ? 'Approve and notify' : 'Decline and reopen',
      tone: approving ? 'normal' : 'caution',
      reasonPrompt: approving ? undefined : 'Why is this being declined? The customer sees this.',
    });
    if (!preview.confirmed) return;
    if (preview.reason) setDecisionNote(preview.reason);

    void runMutation(
      () => operationsRequest(
        `/appointments/${selected.id}/decision`,
        {
          method: 'POST',
          headers: operationHeaders(selected.version),
          body: JSON.stringify({
            decision,
            note: preview.reason ?? (decisionNote.trim() || null),
          }),
        },
      ),
      decision === 'approve'
        ? 'Appointment approved and customer notification queued.'
        : 'Appointment declined and the time was reopened.',
    );
    })();
  };

  const submitChange = (event: FormEvent) => {
    event.preventDefault();
    if (!selected || !draftStaffId) return;
    void runMutation(
      () => operationsRequest(
        `/appointments/${selected.id}/change-requests`,
        {
          method: 'POST',
          headers: operationHeaders(selected.version),
          body: JSON.stringify({
            startsAt: new Date(draftStartsAt).toISOString(),
            durationMinutes: draftDuration,
            staffMemberId: draftStaffId,
            locationId: draftLocationId || null,
            reason: changeReason,
          }),
        },
      ),
      'Change request sent. The original appointment remains in place until approval.',
    );
  };

  const withdrawChange = () => {
    if (!selected?.pendingChange) return;
    void runMutation(
      () => operationsRequest(
        `/appointments/${selected.id}/change-requests/${selected.pendingChange?.id}/withdraw`,
        {
          method: 'POST',
          headers: operationHeaders(selected.version),
        },
      ),
      'Change request withdrawn and the original appointment restored.',
    );
  };

  const markRead = async (notification: Notification) => {
    if (notification.isRead) return;
    setPayload((current) => ({
      ...current,
      notifications: current.notifications.map((item) =>
        item.id === notification.id ? { ...item, isRead: true } : item,
      ),
    }));
    try {
      await operationsRequest(`/notifications/${notification.id}/read`, {
        method: 'POST',
      });
    } catch {
      setPayload((current) => ({
        ...current,
        notifications: current.notifications.map((item) =>
          item.id === notification.id ? { ...item, isRead: false } : item,
        ),
      }));
    }
  };

  const selectRequest = (appointment: Appointment) => {
    setSelectedId(appointment.id);
    setWorkspace('schedule');
  };

  const positionFor = (appointment: Appointment): {
    dayKey: string;
    top: number;
    height: number;
    startsAt: Date;
    endsAt: Date;
  } => {
    const isDraft = appointment.id === selected?.id
      && appointment.status === 'confirmed'
      && draftStartsAt;
    const startsAt = isDraft
      ? new Date(draftStartsAt)
      : new Date(appointment.startsAt);
    const endsAt = isDraft
      ? new Date(startsAt.getTime() + draftDuration * 60_000)
      : new Date(appointment.endsAt);
    const minutes = startsAt.getHours() * 60 + startsAt.getMinutes();
    const duration = Math.max(15, (endsAt.getTime() - startsAt.getTime()) / 60_000);
    return {
      dayKey: localDateKey(startsAt),
      top: ((minutes - DAY_START_MINUTES) / 60) * HOUR_HEIGHT,
      height: Math.max(46, (duration / 60) * HOUR_HEIGHT),
      startsAt,
      endsAt,
    };
  };

  return (
    <section className="operations-studio">
      <header className="operations-header">
        <div>
          <span className="operations-eyebrow">Live operations</span>
          <h1>Appointments</h1>
          <p>Move, resize, approve, and follow every customer request from one place.</p>
        </div>
        <div className="operations-header-actions">
          <button
            className="operations-today-button"
            type="button"
            onClick={() => setWeekStart(startOfWeek(new Date()))}
          >
            Today
          </button>
          <div className="operations-week-switcher">
            <button
              type="button"
              aria-label="Previous week"
              onClick={() => setWeekStart((current) => addDays(current, -7))}
            >
              {arrowLeft}
            </button>
            <strong>{weekLabel(weekStart)}</strong>
            <button
              type="button"
              aria-label="Next week"
              onClick={() => setWeekStart((current) => addDays(current, 7))}
            >
              {arrowRight}
            </button>
          </div>
        </div>
      </header>

      <div className="operations-summary" aria-label="Schedule summary">
        <article>
          <span className="operations-summary-icon is-green">{calendarIcon}</span>
          <div>
            <strong>{confirmedCount}</strong>
            <span>confirmed this week</span>
          </div>
        </article>
        <article>
          <span className="operations-summary-icon is-coral">{bellIcon}</span>
          <div>
            <strong>{requests.length}</strong>
            <span>waiting for action</span>
          </div>
        </article>
        <article>
          <span className="operations-summary-icon is-blue">{peopleIcon}</span>
          <div>
            <strong>{activeStaffCount}</strong>
            <span>active team members</span>
          </div>
        </article>
      </div>

      <div className="operations-tabs">
        <button
          className={workspace === 'schedule' ? 'is-active' : ''}
          type="button"
          onClick={() => setWorkspace('schedule')}
        >
          Schedule
        </button>
        <button
          className={workspace === 'requests' ? 'is-active' : ''}
          type="button"
          onClick={() => setWorkspace('requests')}
        >
          Requests & alerts
          {(requests.length + unreadCount) > 0 && (
            <span>{requests.length + unreadCount}</span>
          )}
        </button>
      </div>

      {error && (
        <div className="operations-error" role="alert">
          <strong>Chime needs your attention.</strong>
          <span>{error}</span>
          <button type="button" onClick={() => void load()}>Try again</button>
        </div>
      )}

      {workspace === 'schedule' ? (
        <div className="operations-layout">
          <div className="operations-calendar-shell">
            <div className="operations-filter-row">
              <span>Show</span>
              <button
                className={staffFilter === 'all' ? 'is-active' : ''}
                type="button"
                onClick={() => setStaffFilter('all')}
              >
                Everyone
              </button>
              {payload.staff.filter((staff) => staff.isActive).map((staff) => (
                <button
                  className={staffFilter === staff.id ? 'is-active' : ''}
                  type="button"
                  key={staff.id}
                  onClick={() => setStaffFilter(staff.id)}
                >
                  <i style={{ background: staff.color }} />
                  {staff.name}
                </button>
              ))}
            </div>

            <div className="operations-calendar">
              <div className="operations-day-head operations-time-head" />
              {weekDays.map((day) => (
                <div
                  className={localDateKey(day) === localDateKey(new Date())
                    ? 'operations-day-head is-today'
                    : 'operations-day-head'}
                  key={localDateKey(day)}
                >
                  <span>{day.toLocaleDateString('en-US', { weekday: 'short' })}</span>
                  <strong>{day.getDate()}</strong>
                </div>
              ))}

              <div className="operations-time-axis">
                {Array.from(
                  { length: (DAY_END_MINUTES - DAY_START_MINUTES) / 60 + 1 },
                  (_, index) => {
                    const hour = DAY_START_MINUTES / 60 + index;
                    const date = new Date();
                    date.setHours(hour, 0, 0, 0);
                    return (
                      <span key={hour} style={{ top: index * HOUR_HEIGHT }}>
                        {formatTime(date)}
                      </span>
                    );
                  },
                )}
              </div>

              {weekDays.map((day) => {
                const dayKey = localDateKey(day);
                const dayAppointments = visibleAppointments.filter(
                  (appointment) => positionFor(appointment).dayKey === dayKey,
                );
                return (
                  <div className="operations-day-column" key={dayKey}>
                    {Array.from({ length: 11 }, (_, index) => (
                      <i
                        className="operations-hour-line"
                        key={index}
                        style={{ top: index * HOUR_HEIGHT }}
                      />
                    ))}
                    {dayAppointments.map((appointment) => {
                      const position = positionFor(appointment);
                      if (
                        position.top > (DAY_END_MINUTES - DAY_START_MINUTES) / 60 * HOUR_HEIGHT
                        || position.top + position.height < 0
                      ) {
                        return null;
                      }
                      const cardStyle = {
                        '--appointment-top': `${Math.max(0, position.top)}px`,
                        '--appointment-height': `${position.height}px`,
                        '--appointment-color': appointment.staff?.color ?? '#4d8b78',
                      } as CSSProperties;
                      return (
                        <button
                          className={[
                            'operations-appointment',
                            `is-${appointment.status}`,
                            selectedId === appointment.id ? 'is-selected' : '',
                          ].join(' ')}
                          key={appointment.id}
                          style={cardStyle}
                          type="button"
                          onClick={() => setSelectedId(appointment.id)}
                        >
                          <span>{formatTime(position.startsAt)}</span>
                          <strong>{appointment.customer.name}</strong>
                          <small>{appointment.service.name}</small>
                          {appointment.status !== 'confirmed' && (
                            <em>{statusLabel(appointment.status)}</em>
                          )}
                          {selectedId === appointment.id && appointment.status === 'confirmed' && (
                            <i className="operations-resize-preview" aria-hidden="true" />
                          )}
                        </button>
                      );
                    })}
                  </div>
                );
              })}

              {!loading && visibleAppointments.length === 0 && (
                <div className="operations-empty-calendar">
                  <span>{calendarIcon}</span>
                  <strong>Your live schedule starts here.</strong>
                  <p>
                    Confirmed customer bookings will appear automatically with their
                    assigned team member and location.
                  </p>
                </div>
              )}
              {loading && <div className="operations-loading">Loading live appointments...</div>}
            </div>
          </div>

          <aside className="operations-inspector">
            {selected ? (
              <>
                <div className="operations-inspector-heading">
                  <div>
                    <span>{selected.referenceCode}</span>
                    <h2>{selected.customer.name}</h2>
                    <p>{selected.service.name}</p>
                  </div>
                  <span className={`operations-status is-${selected.status}`}>
                    {statusLabel(selected.status)}
                  </span>
                </div>

                <dl className="operations-details">
                  <div>
                    <dt>When</dt>
                    <dd>{formatDateTime(selected.startsAt)}</dd>
                  </div>
                  <div>
                    <dt>Team</dt>
                    <dd>{selected.staff?.name ?? 'Unassigned'}</dd>
                  </div>
                  <div>
                    <dt>Location</dt>
                    <dd>{selected.location?.name ?? 'No location'}</dd>
                  </div>
                  <div>
                    <dt>Customer</dt>
                    <dd>
                      <a href={`mailto:${selected.customer.email}`}>
                        {selected.customer.email}
                      </a>
                    </dd>
                  </div>
                </dl>

                {selected.customerNotes && (
                  <div className="operations-customer-note">
                    <span>Customer note</span>
                    <p>{selected.customerNotes}</p>
                  </div>
                )}

                {selected.status === 'pending_approval' && (
                  <div className="operations-decision-panel">
                    <span className="operations-section-label">Approval decision</span>
                    <p>
                      This time is held. Approving confirms it; declining releases it
                      back to the booking widget.
                    </p>
                    <textarea
                      placeholder="Optional note for the customer"
                      value={decisionNote}
                      onChange={(event) => setDecisionNote(event.target.value)}
                    />
                    <div>
                      <button
                        className="operations-secondary-danger"
                        type="button"
                        disabled={saving}
                        onClick={() => decide('decline')}
                      >
                        {closeIcon} Decline
                      </button>
                      <button
                        className="operations-primary"
                        type="button"
                        disabled={saving}
                        onClick={() => decide('approve')}
                      >
                        {checkIcon} Approve
                      </button>
                    </div>
                  </div>
                )}

                {selected.status === 'confirmed' && (
                  <form className="operations-change-form" onSubmit={submitChange}>
                    <div className="operations-form-heading">
                      <span className="operations-section-label">Adjust appointment</span>
                      <p>
                        The card previews your time and length changes before you send
                        them to the customer.
                      </p>
                    </div>
                    <label>
                      New date and time
                      <input
                        type="datetime-local"
                        value={draftStartsAt}
                        onChange={(event) => setDraftStartsAt(event.target.value)}
                        required
                      />
                    </label>
                    <label className="operations-duration-control">
                      <span>
                        Length
                        <strong>{draftDuration} min</strong>
                      </span>
                      <input
                        type="range"
                        min={selected.service.minimumDurationMinutes}
                        max={selected.service.maximumDurationMinutes}
                        step={selected.service.durationIncrementMinutes}
                        value={draftDuration}
                        onChange={(event) => setDraftDuration(Number(event.target.value))}
                      />
                      <small>
                        Drag to resize from {selected.service.minimumDurationMinutes} to{' '}
                        {selected.service.maximumDurationMinutes} minutes.
                      </small>
                    </label>
                    <label>
                      Team member
                      <select
                        value={draftStaffId}
                        onChange={(event) => setDraftStaffId(event.target.value)}
                        required
                      >
                        {payload.staff.filter((staff) => staff.isActive).map((staff) => (
                          <option key={staff.id} value={staff.id}>{staff.name}</option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Location
                      <select
                        value={draftLocationId}
                        onChange={(event) => setDraftLocationId(event.target.value)}
                      >
                        <option value="">No location</option>
                        {payload.locations.filter((location) => location.isActive).map((location) => (
                          <option key={location.id} value={location.id}>{location.name}</option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Why is this changing?
                      <textarea
                        value={changeReason}
                        onChange={(event) => setChangeReason(event.target.value)}
                        placeholder="Give the customer a clear, short reason."
                        required
                      />
                    </label>
                    <button
                      className="operations-primary is-full"
                      type="submit"
                      disabled={saving || !draftStaffId}
                    >
                      Send change for approval
                    </button>
                  </form>
                )}

                {selected.status === 'change_pending' && selected.pendingChange && (
                  <div className="operations-pending-change">
                    <span className="operations-section-label">Waiting for customer</span>
                    <h3>Proposed appointment change</h3>
                    <dl>
                      <div>
                        <dt>New time</dt>
                        <dd>
                          {selected.pendingChange.proposedChanges.startsAt
                            ? formatDateTime(selected.pendingChange.proposedChanges.startsAt)
                            : 'Not changed'}
                        </dd>
                      </div>
                      <div>
                        <dt>New length</dt>
                        <dd>
                          {selected.pendingChange.proposedChanges.durationMinutes ?? '-'} min
                        </dd>
                      </div>
                    </dl>
                    <blockquote>{selected.pendingChange.reason}</blockquote>
                    <p>
                      The original appointment remains active until the tagged customer
                      approves this request.
                    </p>
                    <button
                      className="operations-quiet-button"
                      type="button"
                      disabled={saving}
                      onClick={withdrawChange}
                    >
                      Withdraw request
                    </button>
                  </div>
                )}
              </>
            ) : (
              <div className="operations-empty-inspector">
                <span>{calendarIcon}</span>
                <strong>Select an appointment</strong>
                <p>Details and tactile editing controls will appear here.</p>
              </div>
            )}
          </aside>
        </div>
      ) : (
        <div className="operations-request-workspace">
          <section>
            <div className="operations-list-heading">
              <div>
                <span className="operations-eyebrow">Decision queue</span>
                <h2>Requests that need a person</h2>
              </div>
              <strong>{requests.length}</strong>
            </div>
            <div className="operations-request-list">
              {requests.map((appointment) => (
                <button
                  type="button"
                  key={appointment.id}
                  onClick={() => selectRequest(appointment)}
                >
                  <span
                    className={`operations-request-marker is-${appointment.status}`}
                  >
                    {appointment.status === 'pending_approval' ? bellIcon : calendarIcon}
                  </span>
                  <span>
                    <strong>
                      {appointment.status === 'pending_approval'
                        ? `Approve ${appointment.customer.name}'s booking`
                        : `Waiting on ${appointment.customer.name}`}
                    </strong>
                    <small>
                      {appointment.service.name} · {formatDateTime(appointment.startsAt)}
                    </small>
                  </span>
                  <em>{statusLabel(appointment.status)}</em>
                  {arrowRight}
                </button>
              ))}
              {requests.length === 0 && (
                <div className="operations-list-empty">
                  {checkIcon}
                  <strong>Nothing is waiting on you.</strong>
                  <p>New approval and appointment-change requests will collect here.</p>
                </div>
              )}
            </div>
          </section>

          <section>
            <div className="operations-list-heading">
              <div>
                <span className="operations-eyebrow">Activity</span>
                <h2>Booking notifications</h2>
              </div>
              <strong>{unreadCount} new</strong>
            </div>
            <div className="operations-notification-list">
              {payload.notifications.map((notification) => (
                <button
                  className={notification.isRead ? '' : 'is-unread'}
                  type="button"
                  key={notification.id}
                  onClick={() => {
                    void markRead(notification);
                    if (notification.appointmentId) {
                      const appointment = payload.appointments.find(
                        (item) => item.id === notification.appointmentId,
                      );
                      if (appointment) selectRequest(appointment);
                    }
                  }}
                >
                  <i />
                  <span>
                    <strong>{notification.title}</strong>
                    <small>{notification.body}</small>
                    <time>
                      {new Intl.DateTimeFormat('en-US', {
                        month: 'short',
                        day: 'numeric',
                        hour: 'numeric',
                        minute: '2-digit',
                      }).format(new Date(notification.createdAt))}
                    </time>
                  </span>
                </button>
              ))}
              {payload.notifications.length === 0 && (
                <div className="operations-list-empty">
                  {bellIcon}
                  <strong>Your activity stream is ready.</strong>
                  <p>Bookings, decisions, and change responses will appear here.</p>
                </div>
              )}
            </div>
          </section>
        </div>
      )}
      {previewElement}
    </section>
  );
}
