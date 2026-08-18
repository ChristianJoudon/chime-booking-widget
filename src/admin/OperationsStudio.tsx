import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import './operationsStudio.css';
import { useActionPreview } from './actionPreview';
import { getAdminConnection, describeMissingConnection } from './adminConnection';
import type { Notify, UndoOffer } from './undo';

type OperationsStudioProps = {
  initialWorkspace?: 'schedule' | 'requests';
  onNotify: Notify;
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

type ScheduleConflict = {
  referenceCode: string;
  startsAt: string;
  endsAt: string;
  customerName: string;
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

type BookableService = {
  id: string;
  name: string;
  durationMinutes: number;
  bufferBeforeMinutes: number;
  bufferAfterMinutes: number;
  isActive: boolean;
};

type OperationsPayload = {
  appointments: Appointment[];
  staff: StaffMember[];
  locations: Location[];
  notifications: Notification[];
  services: BookableService[];
};

class OperationsApiError extends Error {}

/*
 * Dragging a card on the calendar.
 *
 * MINUTES_PER_PIXEL is the inverse of the arithmetic positionFor uses to place
 * a card, and it has to stay that way — the two are the same relationship read
 * in opposite directions, and if they ever disagree a card will not sit where
 * the pointer left it.
 *
 * The snap is fifteen minutes because that is what the availability grid uses
 * and what the times customers are offered land on. Nothing enforces the pair;
 * a comment is what there is.
 */
const DRAG_SNAP_MINUTES = 15;

/*
 * How far a pointer travels before this counts as a drag rather than a click.
 *
 * Without it every click on a card is a zero-distance drag: the existing
 * gesture code elsewhere in the studio has no threshold and gets away with it
 * only because its snap rounds tiny movements back to nothing. Here a
 * zero-distance drag would still fall through to "did anything change", and a
 * hand that shakes four pixels while clicking would put a confirmation dialog
 * in front of someone who meant to select.
 */
const DRAG_THRESHOLD_PX = 5;

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
    services: [],
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
  const [conflicts, setConflicts] = useState<ScheduleConflict[] | null>(null);
  const [decisionNote, setDecisionNote] = useState('');

  /*
   * Writing down a booking taken over the phone.
   *
   * Closed by default and opened from the header, rather than living on screen:
   * the common case for this screen is reading the week, and a form that is
   * always open pushes the schedule down to make room for something used a few
   * times a day.
   */
  const [addOpen, setAddOpen] = useState(false);
  const [addServiceId, setAddServiceId] = useState('');
  const [addStaffId, setAddStaffId] = useState('');
  const [addLocationId, setAddLocationId] = useState('');
  const [addStartsAt, setAddStartsAt] = useState('');
  const [addDuration, setAddDuration] = useState(30);
  const [addCustomerName, setAddCustomerName] = useState('');
  const [addCustomerPhone, setAddCustomerPhone] = useState('');
  const [addCustomerEmail, setAddCustomerEmail] = useState('');
  const [addNotes, setAddNotes] = useState('');
  const [addError, setAddError] = useState<string | null>(null);

  /*
   * What a drag is doing, or null when nothing is being dragged.
   *
   * `moved` is set once the pointer has passed the threshold. Until then the
   * gesture is still a click, and releasing does nothing but select — which is
   * what tapping a card has always done.
   *
   * The preview costs no extra state: positionFor already renders the selected
   * confirmed appointment from draftStartsAt and draftDuration rather than its
   * saved times, so writing those two during a drag makes the card follow the
   * pointer, and the form on the right updates in step because it reads the
   * same values.
   */
  /*
   * The current drafts and the current commit, readable from a stale closure.
   *
   * The drag's pointer handlers are installed once per drag, so they close over
   * whatever the drafts were at that moment. Dropping a card two hours down
   * therefore asked to confirm a fifteen-minute move — the value from the one
   * render where the effect last re-ran — while the card itself sat correctly
   * two hours later. The card was right and the confirmation was wrong, which
   * is the worse way round.
   *
   * Adding the drafts to the effect's dependencies would fix it by tearing down
   * and reinstalling window listeners on every pixel of movement. A ref updated
   * each render costs nothing and reads the truth at the moment of the drop.
   */
  const latest = useRef({ draftStartsAt: '', draftDuration: 60, commit: () => {} });

  const [drag, setDrag] = useState<{
    appointmentId: string;
    mode: 'move' | 'resize';
    originY: number;
    originalStartsAt: string;
    originalDuration: number;
    moved: boolean;
  } | null>(null);
  const { confirm: confirmAction, element: previewElement } = useActionPreview();

  const chosenAddService = payload.services.find((service) => service.id === addServiceId) ?? null;

  function resetAddForm() {
    setAddServiceId('');
    setAddStaffId('');
    setAddLocationId('');
    setAddStartsAt('');
    setAddDuration(30);
    setAddCustomerName('');
    setAddCustomerPhone('');
    setAddCustomerEmail('');
    setAddNotes('');
    setAddError(null);
  }

  async function submitNewAppointment(event: React.FormEvent) {
    event.preventDefault();
    setAddError(null);

    const service = payload.services.find((item) => item.id === addServiceId);
    const member = payload.staff.find((item) => item.id === addStaffId);
    if (!service || !member || !addStartsAt || !addCustomerName.trim()) {
      setAddError('Fill in the service, the team member, the time, and who it is for.');
      return;
    }

    // datetime-local has no zone, so it is read as the browser's — which is the
    // right guess: the person typing it is standing in the business.
    const startsAt = new Date(addStartsAt);
    if (Number.isNaN(startsAt.getTime())) {
      setAddError('That date and time could not be read.');
      return;
    }

    const preview = await confirmAction({
      title: 'Add this appointment',
      summary: `Books ${addCustomerName.trim()} in with ${member.name} and takes that time off your booking page.`,
      changes: [
        { label: 'Service', after: service.name },
        { label: 'Team member', after: member.name },
        {
          label: 'When',
          after: `${startsAt.toLocaleString(undefined, { dateStyle: 'full', timeStyle: 'short' })} · ${addDuration} min`,
        },
        {
          label: 'Customer',
          after: addCustomerPhone.trim() || addCustomerEmail.trim()
            ? `${addCustomerName.trim()} (${[addCustomerPhone.trim(), addCustomerEmail.trim()].filter(Boolean).join(' · ')})`
            : addCustomerName.trim(),
        },
        { label: 'Your booking page', after: 'Stops offering this time to customers' },
      ],
      // Nobody is written to. A phone booking is agreed on the phone, and a
      // confirmation the customer did not ask for, to an address the owner just
      // typed from memory, is as likely to reach a stranger as the customer.
      notifies: null,
      paymentEffect: null,
      reversible: {
        kind: 'recoverable',
        detail: 'Cancel it from the schedule and the time goes back on your booking page.',
      },
      confirmLabel: 'Add appointment',
    });
    if (!preview.confirmed) return;

    setSaving(true);
    try {
      await operationsRequest('/appointments', {
        method: 'POST',
        headers: { 'Idempotency-Key': crypto.randomUUID() },
        body: JSON.stringify({
          serviceId: service.id,
          staffMemberId: member.id,
          locationId: addLocationId || null,
          startsAt: startsAt.toISOString(),
          durationMinutes: addDuration,
          customerName: addCustomerName.trim(),
          customerPhone: addCustomerPhone.trim() || null,
          customerEmail: addCustomerEmail.trim() || null,
          notes: addNotes.trim() || null,
        }),
      });
      resetAddForm();
      setAddOpen(false);
      // The week the appointment landed in, which is not necessarily the week
      // being looked at — otherwise a booking three weeks out saves and then
      // appears nowhere, which reads as a failure.
      setWeekStart(startOfWeek(startsAt));
      await load();
    } catch (caught) {
      setAddError(
        caught instanceof OperationsApiError
          ? caught.message
          : 'Chime could not add that appointment.',
      );
    } finally {
      setSaving(false);
    }
  }

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
    async <T,>(
      operation: () => Promise<T>,
      successMessage: string,
      // Built from the result rather than from component state, so the undo
      // holds the ids and version the server just returned. State has already
      // moved on by the time anyone clicks it.
      buildUndo?: (result: T) => UndoOffer | undefined,
    ) => {
      setSaving(true);
      setError(null);
      try {
        const result = await operation();
        onNotify(successMessage, buildUndo?.(result));
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

  // Asks the server what the proposed time would collide with, while the
  // administrator is still editing. Debounced, because it fires on every
  // keystroke in the datetime field.
  useEffect(() => {
    if (!selected || !draftStaffId || !draftStartsAt) {
      setConflicts(null);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void operationsRequest<{ conflicts: ScheduleConflict[] }>(
        `/appointments/${selected.id}/change-requests/check`,
        {
          method: 'POST',
          body: JSON.stringify({
            startsAt: new Date(draftStartsAt).toISOString(),
            durationMinutes: draftDuration,
            staffMemberId: draftStaffId,
            locationId: draftLocationId || null,
            reason: 'conflict check',
          }),
        },
      )
        .then((result) => { if (!cancelled) setConflicts(result.conflicts); })
        // A failed check must not block the form: the write path enforces the
        // same rule regardless, so the worst case is losing the early warning.
        .catch(() => { if (!cancelled) setConflicts(null); });
    }, 400);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [selected, draftStartsAt, draftDuration, draftStaffId, draftLocationId]);

  /*
   * One path to a change, whether the drafts were typed or dragged.
   *
   * The form and the calendar write the same four pieces of state, so they
   * share the same commit — which is the point. A dragged change goes through
   * the identical confirmation, the identical endpoint and therefore the
   * identical notification to the customer. Two paths would eventually send two
   * different messages for the same act.
   */
  const commitChange = () => {
    if (!selected || !draftStaffId) return;
    const nextStart = new Date(draftStartsAt);
    const nextEnd = new Date(nextStart.getTime() + draftDuration * 60_000);
    const nextStaff = payload.staff.find((member) => member.id === draftStaffId);
    const nextLocation = payload.locations.find((place) => place.id === draftLocationId);
    const needsCustomerApproval = selected.changeApprovalMode !== 'automatic';

    void (async () => {
    const preview = await confirmAction({
      title: 'Send this change to the customer',
      summary: needsCustomerApproval
        ? `${selected.customer.name} is asked to approve a new time for their ${selected.service.name}.`
        : `Moves ${selected.customer.name}'s ${selected.service.name} and tells them the new time.`,
      changes: [
        {
          label: 'When',
          before: `${formatDateTime(selected.startsAt)} - ${formatTime(new Date(selected.endsAt))}`,
          after: `${formatDateTime(nextStart.toISOString())} - ${formatTime(nextEnd)}`,
        },
        {
          label: 'Length',
          before: `${Math.round((new Date(selected.endsAt).getTime() - new Date(selected.startsAt).getTime()) / 60_000)} min`,
          after: `${draftDuration} min`,
        },
        {
          label: 'Team member',
          before: selected.staff?.name ?? 'Unassigned',
          after: nextStaff?.name ?? 'Unassigned',
        },
        {
          label: 'Location',
          before: selected.location?.name ?? 'No location',
          after: nextLocation?.name ?? 'No location',
        },
      ].filter((change) => change.before !== change.after),
      notifies: `${selected.customer.name} at ${selected.customer.email}`,
      requiresCustomerApproval: needsCustomerApproval,
      paymentEffect: null,
      reversible: {
        kind: 'undo',
        detail: 'Yes — the request can be withdrawn until the customer answers.',
      },
      confirmLabel: needsCustomerApproval ? 'Ask the customer to approve' : 'Send the change',
      tone: conflicts?.length ? 'caution' : 'normal',
      reasonPrompt: 'Why is this changing? The customer sees this.',
    });
    if (!preview.confirmed) return;
    const submittedReason = preview.reason ?? changeReason;

    const appointmentId = selected.id;
    void runMutation(
      () => operationsRequest<{ appointment: Appointment }>(
        `/appointments/${appointmentId}/change-requests`,
        {
          method: 'POST',
          headers: operationHeaders(selected.version),
          body: JSON.stringify({
            startsAt: new Date(draftStartsAt).toISOString(),
            durationMinutes: draftDuration,
            staffMemberId: draftStaffId,
            locationId: draftLocationId || null,
            reason: submittedReason,
          }),
        },
      ),
      'Change request sent. The original appointment remains in place until approval.',
      // The preview promises this can be withdrawn until the customer answers.
      // "Withdraw request" on the appointment keeps that promise; this saves
      // finding it again in the seconds when it is most likely to be wanted.
      (result) => {
        const request = result.appointment.pendingChange;
        if (!request) return undefined;
        return {
          label: 'Withdraw it',
          confirmation: 'Change request withdrawn. The customer will not be asked.',
          run: async () => {
            await operationsRequest(
              `/appointments/${appointmentId}/change-requests/${request.id}/withdraw`,
              { method: 'POST', headers: operationHeaders(result.appointment.version) },
            );
            await load();
          },
        };
      },
    );
    })();
  };

  const submitChange = (event: FormEvent) => {
    event.preventDefault();
    commitChange();
  };

  latest.current = { draftStartsAt, draftDuration, commit: commitChange };

  /*
   * Turning pixels into a time, and back into the drafts the rest of the
   * screen already reads.
   *
   * positionFor places a card at ((minutes - DAY_START) / 60) * HOUR_HEIGHT.
   * This is that read backwards, so a card lands where the pointer left it.
   * If either side is ever changed alone they will disagree and a dragged
   * appointment will settle somewhere other than where it was dropped.
   */
  useEffect(() => {
    if (!drag) return undefined;

    const minutesPerPixel = 60 / HOUR_HEIGHT;

    const move = (event: PointerEvent) => {
      const rawPixels = event.clientY - drag.originY;
      if (!drag.moved && Math.abs(rawPixels) < DRAG_THRESHOLD_PX) return;
      if (event.cancelable) event.preventDefault();
      if (!drag.moved) setDrag((current) => (current ? { ...current, moved: true } : current));

      const deltaMinutes =
        Math.round((rawPixels * minutesPerPixel) / DRAG_SNAP_MINUTES) * DRAG_SNAP_MINUTES;

      if (drag.mode === 'move') {
        const origin = new Date(drag.originalStartsAt);
        const next = new Date(origin.getTime() + deltaMinutes * 60_000);
        // Kept inside the hours the grid actually draws. Dragged past the top
        // the card would be clamped to zero by positionFor and stop tracking
        // the pointer, which reads as the drag having broken.
        const minutesIntoDay = next.getHours() * 60 + next.getMinutes();
        if (minutesIntoDay < DAY_START_MINUTES || minutesIntoDay + draftDuration > DAY_END_MINUTES) return;
        setDraftStartsAt(inputDateTime(next));
      } else {
        const bounds = selected?.service;
        const floor = bounds?.minimumDurationMinutes ?? DRAG_SNAP_MINUTES;
        const ceiling = bounds?.maximumDurationMinutes ?? 8 * 60;
        const proposed = Math.min(ceiling, Math.max(floor, drag.originalDuration + deltaMinutes));
        const startMinutes = new Date(drag.originalStartsAt).getHours() * 60
          + new Date(drag.originalStartsAt).getMinutes();
        if (startMinutes + proposed > DAY_END_MINUTES) return;
        setDraftDuration(proposed);
      }
    };

    const finish = () => {
      const wasDragged = drag.moved;
      const startedAt = drag.originalStartsAt;
      const startedDuration = drag.originalDuration;
      setDrag(null);
      if (!wasDragged) return;

      /*
       * Only ask when something actually moved.
       *
       * Picking a card up and putting it back where it came from is a common
       * way to change your mind mid-gesture, and a confirmation dialog for a
       * change of nothing would train people to dismiss the one that matters.
       */
      const { draftStartsAt: finalStart, draftDuration: finalDuration, commit } = latest.current;
      if (finalStart === startedAt && finalDuration === startedDuration) return;
      commit();
    };

    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag, draftDuration, selected]);

  /*
   * Start a drag, but only on an appointment that can be changed.
   *
   * The live preview works by rendering the selected confirmed appointment from
   * the drafts, so a card that is neither selected nor confirmed has nothing to
   * preview with. Selecting on pointer-down means one gesture does both: the
   * card you grab is the card you are editing.
   */
  const beginDrag = (event: ReactPointerEvent, appointment: Appointment, mode: 'move' | 'resize') => {
    if (appointment.status !== 'confirmed') return;
    if (event.button !== 0 && event.pointerType === 'mouse') return;
    event.stopPropagation();
    setSelectedId(appointment.id);
    const startsAt = new Date(appointment.startsAt);
    const duration = Math.round(
      (new Date(appointment.endsAt).getTime() - startsAt.getTime()) / 60_000,
    );
    // Seeded here rather than waiting for the selection effect, which runs a
    // render later — by which time the pointer has already moved.
    setDraftStartsAt(inputDateTime(startsAt));
    setDraftDuration(duration);
    setDrag({
      appointmentId: appointment.id,
      mode,
      originY: event.clientY,
      originalStartsAt: inputDateTime(startsAt),
      originalDuration: duration,
      moved: false,
    });
  };

  /*
   * The same two moves from the keyboard.
   *
   * Arrow keys shift the appointment; holding Shift changes its length instead.
   * The studio's other drag has no keyboard path for resizing at all, which
   * makes that half of it unreachable without a pointer. Enter commits, which
   * is the same confirmation the pointer gets.
   */
  const nudgeSelected = (event: ReactKeyboardEvent, appointment: Appointment) => {
    if (appointment.status !== 'confirmed') return;
    if (!['ArrowUp', 'ArrowDown', 'Enter'].includes(event.key)) return;
    event.preventDefault();

    if (event.key === 'Enter') {
      commitChange();
      return;
    }
    const step = event.key === 'ArrowUp' ? -DRAG_SNAP_MINUTES : DRAG_SNAP_MINUTES;
    if (selectedId !== appointment.id) setSelectedId(appointment.id);

    if (event.shiftKey) {
      const floor = appointment.service.minimumDurationMinutes ?? DRAG_SNAP_MINUTES;
      const ceiling = appointment.service.maximumDurationMinutes ?? 8 * 60;
      setDraftDuration((current) => Math.min(ceiling, Math.max(floor, current + step)));
      return;
    }
    setDraftStartsAt((current) => {
      const next = new Date(new Date(current).getTime() + step * 60_000);
      const minutesIntoDay = next.getHours() * 60 + next.getMinutes();
      if (minutesIntoDay < DAY_START_MINUTES || minutesIntoDay + draftDuration > DAY_END_MINUTES) return current;
      return inputDateTime(next);
    });
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
          {/* No kicker above the title: this screen and its navigation area
              are both called Appointments, and repeating it reads as a
              mistake rather than as a location. */}
          <h1>Appointments</h1>
          <p>Move, resize, approve, and follow every customer request from one place.</p>
        </div>
        <div className="operations-header-actions">
          <button
            className="operations-add-button"
            type="button"
            onClick={() => {
              setAddOpen((open) => !open);
              setAddError(null);
            }}
            aria-expanded={addOpen}
            aria-controls="operations-add-form"
          >
            {addOpen ? 'Close' : 'Add appointment'}
          </button>
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

      {addOpen ? (
        <form className="operations-add-form" id="operations-add-form" onSubmit={submitNewAppointment}>
          <h2>Add an appointment</h2>
          <p className="operations-add-form__intro">
            For a booking taken over the phone or in person. It goes straight into the schedule and
            the time stops being offered on your booking page.
          </p>

          <div className="operations-add-form__grid">
            <label>
              <span>Service</span>
              <select
                value={addServiceId}
                onChange={(event) => {
                  const next = event.target.value;
                  setAddServiceId(next);
                  // The service's own length, so the common case is one fewer
                  // field to think about. Still editable — a phone booking is
                  // exactly where "she needs a bit longer" comes up.
                  const service = payload.services.find((item) => item.id === next);
                  if (service) setAddDuration(service.durationMinutes);
                }}
                required
              >
                <option value="">Choose a service</option>
                {payload.services.map((service) => (
                  <option key={service.id} value={service.id}>
                    {service.name}
                    {service.isActive ? '' : ' (hidden from customers)'}
                  </option>
                ))}
              </select>
            </label>

            <label>
              <span>Team member</span>
              <select value={addStaffId} onChange={(event) => setAddStaffId(event.target.value)} required>
                <option value="">Choose a team member</option>
                {payload.staff.filter((member) => member.isActive).map((member) => (
                  <option key={member.id} value={member.id}>{member.name}</option>
                ))}
              </select>
            </label>

            <label>
              <span>Starts</span>
              <input
                type="datetime-local"
                value={addStartsAt}
                onChange={(event) => setAddStartsAt(event.target.value)}
                required
              />
            </label>

            <label>
              <span>Minutes</span>
              <input
                type="number"
                min={5}
                max={480}
                step={5}
                value={addDuration}
                onChange={(event) => setAddDuration(Number(event.target.value))}
                required
              />
            </label>

            {payload.locations.length > 1 ? (
              <label>
                <span>Location</span>
                <select value={addLocationId} onChange={(event) => setAddLocationId(event.target.value)}>
                  <option value="">No particular location</option>
                  {payload.locations.filter((location) => location.isActive).map((location) => (
                    <option key={location.id} value={location.id}>{location.name}</option>
                  ))}
                </select>
              </label>
            ) : null}

            <label>
              <span>Customer name</span>
              <input
                type="text"
                value={addCustomerName}
                onChange={(event) => setAddCustomerName(event.target.value)}
                placeholder="Who is coming in"
                required
              />
            </label>

            <label>
              <span>Phone</span>
              <input
                type="tel"
                value={addCustomerPhone}
                onChange={(event) => setAddCustomerPhone(event.target.value)}
                placeholder="Optional"
              />
            </label>

            <label>
              <span>Email</span>
              <input
                type="email"
                value={addCustomerEmail}
                onChange={(event) => setAddCustomerEmail(event.target.value)}
                placeholder="Optional"
              />
            </label>
          </div>

          <label className="operations-add-form__notes">
            <span>Note for your team</span>
            <textarea
              value={addNotes}
              onChange={(event) => setAddNotes(event.target.value)}
              rows={2}
              placeholder="Anything worth remembering about this booking"
            />
          </label>

          <p className="operations-add-form__hint">
            A phone or email matching a customer you already have will be linked to them rather than
            making a second record. Nobody is emailed or texted — you have already spoken to them.
            {chosenAddService && !chosenAddService.isActive
              ? ' This service is hidden from customers; booking it here does not put it back on your page.'
              : ''}
          </p>

          {addError ? (
            <p className="operations-add-form__error" role="alert">{addError}</p>
          ) : null}

          <div className="operations-add-form__actions">
            <button type="submit" className="operations-add-form__submit" disabled={saving}>
              {saving ? 'Adding…' : 'Review and add'}
            </button>
            <button
              type="button"
              onClick={() => {
                resetAddForm();
                setAddOpen(false);
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      ) : null}

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
                            // Drops the service line when the card cannot hold it
                            // legibly. Time, name and service need about 64px; a
                            // 30-minute slot is 46px, so the service was being
                            // sliced mid-word. An appointment that is not simply
                            // confirmed also carries a status badge, which needs
                            // roughly another 30px and matters more than the
                            // service name — that is the one thing asking the
                            // owner to do something. The service is always on the
                            // detail panel, and the colour already says who is
                            // covering it.
                            position.height < 64
                            || (appointment.status !== 'confirmed' && position.height < 96)
                              ? 'is-compact'
                              : '',
                            selectedId === appointment.id ? 'is-selected' : '',
                            appointment.status === 'confirmed' ? 'is-draggable' : '',
                            drag?.appointmentId === appointment.id && drag.moved ? 'is-dragging' : '',
                          ].join(' ')}
                          key={appointment.id}
                          style={cardStyle}
                          type="button"
                          onClick={() => setSelectedId(appointment.id)}
                          onPointerDown={(event) => beginDrag(event, appointment, 'move')}
                          onKeyDown={(event) => nudgeSelected(event, appointment)}
                          aria-label={
                            appointment.status === 'confirmed'
                              ? `${appointment.customer.name}, ${appointment.service.name}, `
                                + `${formatTime(position.startsAt)} to ${formatTime(position.endsAt)}. `
                                + 'Drag to move, or use arrow keys. Hold shift and use arrow keys to change the length. '
                                + 'Press Enter to send the change.'
                              : undefined
                          }
                        >
                          <span>{formatTime(position.startsAt)}</span>
                          <strong>{appointment.customer.name}</strong>
                          <small>{appointment.service.name}</small>
                          {appointment.status !== 'confirmed' && (
                            <em>{statusLabel(appointment.status)}</em>
                          )}
                          {appointment.status === 'confirmed' && (
                            /*
                              * The handle that was already drawn but never wired.
                              *
                              * .operations-resize-preview has been in the
                              * stylesheet from the beginning — a 3px bar at the
                              * bottom of a selected card, purely decorative, and
                              * shaped exactly like the grip it now is. It only
                              * ever appeared on the selected card; it appears on
                              * every changeable one now, because a control you
                              * have to select something to discover is not
                              * discoverable.
                              */
                            <i
                              className="operations-resize-preview"
                              onPointerDown={(event) => beginDrag(event, appointment, 'resize')}
                              aria-hidden="true"
                            />
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
                    {conflicts?.length ? (
                      <div className="operations-conflict" role="alert">
                        <strong>
                          {conflicts.length === 1
                            ? 'That time is already taken'
                            : `That time overlaps ${conflicts.length} appointments`}
                        </strong>
                        <ul>
                          {conflicts.map((conflict) => (
                            <li key={conflict.referenceCode}>
                              {conflict.referenceCode} — {conflict.customerName},{' '}
                              {formatTime(new Date(conflict.startsAt))} to {formatTime(new Date(conflict.endsAt))}
                            </li>
                          ))}
                        </ul>
                        <small>
                          Overlaps count the buffer this service needs before and after,
                          so a time can conflict even when the appointments do not touch.
                        </small>
                      </div>
                    ) : null}

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
