import {
  useEffect,
  useCallback,
  useMemo,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';

import type { StaffId } from '../../packages/contracts/src';
import {
  AdminApiClientError,
  createAdminApiClient,
  type AdminPersistenceState,
} from './adminApi';
import ServiceStudio from './ServiceStudio';
import TeamStudio from './TeamStudio';
import OperationsStudio from './OperationsStudio';
import CommunicationStudio from './CommunicationStudio';
import { CustomerStudio } from './CustomerStudio';
import AvailabilityStudio from './AvailabilityStudio';
import {
  INITIAL_APPOINTMENTS,
  SCHEDULE_DAYS,
  SCHEDULE_STAFF,
  type PendingOrigin,
  type ScheduleAppointment,
} from './sampleSchedule';
import {
  INITIAL_ADMIN_SERVICES,
  type AdminServiceDefinition,
} from './sampleAdminServices';

type IconName =
  | 'calendar'
  | 'inbox'
  | 'services'
  | 'team'
  | 'customers'
  | 'insights'
  | 'palette'
  | 'settings'
  | 'search'
  | 'bell'
  | 'plus'
  | 'chevron-left'
  | 'chevron-right'
  | 'filter'
  | 'clock'
  | 'pin'
  | 'mail'
  | 'phone'
  | 'sparkle'
  | 'check'
  | 'x'
  | 'send'
  | 'undo'
  | 'grip';

interface IconProps {
  name: IconName;
  size?: number;
  strokeWidth?: number;
}

const ICON_PATHS: Record<IconName, ReactNode> = {
  calendar: <><rect x="3" y="5" width="18" height="16" rx="3" /><path d="M16 3v4M8 3v4M3 10h18M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01" /></>,
  inbox: <><path d="M4 4h16v13H4z" /><path d="m4 13 4 4h8l4-4M9 8h6" /></>,
  services: <><path d="M4 7h16M4 12h16M4 17h16" /><circle cx="8" cy="7" r="2" /><circle cx="16" cy="12" r="2" /><circle cx="10" cy="17" r="2" /></>,
  team: <><circle cx="9" cy="8" r="3" /><path d="M3.5 19c.5-4 2.4-6 5.5-6s5 2 5.5 6" /><circle cx="17" cy="9" r="2.3" /><path d="M15.5 14c3.3-.3 5.1 1.4 5.5 4.5" /></>,
  customers: <><circle cx="12" cy="8" r="4" /><path d="M4.5 21c.6-5.2 3.1-7.8 7.5-7.8s6.9 2.6 7.5 7.8" /></>,
  insights: <><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></>,
  palette: <><path d="M12 3a9 9 0 1 0 0 18h1.3a1.8 1.8 0 0 0 0-3.6h-.8a2 2 0 0 1 0-4H16a5 5 0 0 0 5-5C21 5.4 17 3 12 3Z" /><circle cx="7.5" cy="10" r="1" /><circle cx="10" cy="6.5" r="1" /><circle cx="15" cy="7" r="1" /></>,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3A1.7 1.7 0 0 0 10 3v-.2h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z" /></>,
  search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></>,
  bell: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" /><path d="M10 21h4" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  'chevron-left': <path d="m15 18-6-6 6-6" />,
  'chevron-right': <path d="m9 18 6-6-6-6" />,
  filter: <path d="M4 6h16M7 12h10M10 18h4" />,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  pin: <><path d="M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0Z" /><circle cx="12" cy="10" r="2.5" /></>,
  mail: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m4 7 8 6 8-6" /></>,
  phone: <path d="M7 3H4a1 1 0 0 0-1 1c0 9.4 7.6 17 17 17a1 1 0 0 0 1-1v-3l-4-2-2 2c-3.5-1.5-6.5-4.5-8-8l2-2-2-4Z" />,
  sparkle: <><path d="m12 3 1.3 4.1L17 9l-3.7 1.9L12 15l-1.3-4.1L7 9l3.7-1.9L12 3Z" /><path d="m5 15 .8 2.2L8 18l-2.2.8L5 21l-.8-2.2L2 18l2.2-.8L5 15ZM19 3l.7 1.8L22 6l-2.3 1.2L19 9l-.7-1.8L16 6l2.3-1.2L19 3Z" /></>,
  check: <path d="m5 12 4 4L19 6" />,
  x: <path d="M6 6l12 12M18 6 6 18" />,
  send: <><path d="m22 2-7 20-4-9-9-4 20-7Z" /><path d="M22 2 11 13" /></>,
  undo: <><path d="m9 7-5 5 5 5" /><path d="M4 12h9a7 7 0 0 1 7 7" /></>,
  grip: <><circle cx="9" cy="8" r="1" fill="currentColor" stroke="none" /><circle cx="15" cy="8" r="1" fill="currentColor" stroke="none" /><circle cx="9" cy="12" r="1" fill="currentColor" stroke="none" /><circle cx="15" cy="12" r="1" fill="currentColor" stroke="none" /><circle cx="9" cy="16" r="1" fill="currentColor" stroke="none" /><circle cx="15" cy="16" r="1" fill="currentColor" stroke="none" /></>,
};

function Icon({ name, size = 20, strokeWidth = 1.8 }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height={size}
      viewBox="0 0 24 24"
      width={size}
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={strokeWidth}
    >
      {ICON_PATHS[name]}
    </svg>
  );
}

const START_MINUTES = 8 * 60;
const END_MINUTES = 18 * 60;
const PIXELS_PER_MINUTE = 1.15;
const GRID_HEIGHT = (END_MINUTES - START_MINUTES) * PIXELS_PER_MINUTE;
const SNAP_MINUTES = 15;
const DURATION_OPTIONS = [30, 45, 60, 90] as const;

interface PointerInteraction {
  appointmentId: string;
  mode: 'move' | 'resize';
  pointerId: number;
  originClientX: number;
  originClientY: number;
  originDayIndex: number;
  originStartMinutes: number;
  originDurationMinutes: number;
  originStaffId: StaffId;
  previousStatus: ScheduleAppointment['status'];
  previousPendingOrigin?: PendingOrigin;
}

const NAV_ITEMS: readonly { label: string; icon: IconName; badge?: number }[] = [
  { label: 'Schedule', icon: 'calendar' },
  { label: 'Requests', icon: 'inbox' },
  { label: 'Messages', icon: 'mail' },
  { label: 'Services', icon: 'services' },
  { label: 'Team', icon: 'team' },
  { label: 'Availability', icon: 'calendar' },
  { label: 'Customers', icon: 'customers' },
  { label: 'Insights', icon: 'insights' },
  { label: 'Widget designer', icon: 'palette' },
];

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function snap(value: number, increment = SNAP_MINUTES): number {
  return Math.round(value / increment) * increment;
}

function formatTime(minutes: number): string {
  const hour24 = Math.floor(minutes / 60);
  const minute = minutes % 60;
  const hour12 = hour24 % 12 || 12;
  const suffix = hour24 >= 12 ? 'PM' : 'AM';
  return `${hour12}:${minute.toString().padStart(2, '0')} ${suffix}`;
}

function getStatusLabel(status: ScheduleAppointment['status']): string {
  switch (status) {
    case 'change_pending': return 'Change pending';
    case 'pending_approval': return 'Needs approval';
    case 'held': return 'Soft hold';
    case 'draft': return 'Draft';
    default: return status.charAt(0).toUpperCase() + status.slice(1).replace('_', ' ');
  }
}

function getDay(dayIndex: number) {
  return SCHEDULE_DAYS.find((day) => day.dayIndex === dayIndex) ?? SCHEDULE_DAYS[0];
}

function getStaff(staffId: StaffId) {
  return SCHEDULE_STAFF.find((staff) => staff.id === staffId) ?? SCHEDULE_STAFF[0];
}

function AdminApp() {
  const [appointments, setAppointments] = useState<ScheduleAppointment[]>(() =>
    INITIAL_APPOINTMENTS.map((appointment) => ({ ...appointment })),
  );
  const [selectedId, setSelectedId] = useState('apt-108');
  const [staffFilter, setStaffFilter] = useState<StaffId | 'all'>('all');
  const [view, setView] = useState<'week' | 'day'>('week');
  const [activeDayIndex, setActiveDayIndex] = useState(4);
  const [interaction, setInteraction] = useState<PointerInteraction | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [activeWorkspace, setActiveWorkspace] = useState<'Schedule' | 'Requests' | 'Messages' | 'Services' | 'Team' | 'Availability' | 'Customers'>('Schedule');
  const [adminServices, setAdminServices] = useState<AdminServiceDefinition[]>(() =>
    INITIAL_ADMIN_SERVICES.map((service) => ({ ...service })),
  );
  const adminApi = useMemo(() => createAdminApiClient(), []);
  const [adminPersistence, setAdminPersistence] = useState<AdminPersistenceState>(() =>
    adminApi.configured
      ? { mode: 'loading', label: 'Connecting to Chime...' }
      : { mode: 'demo', label: 'Saved for this session' },
  );

  const visibleDays = useMemo(
    () => view === 'week'
      ? SCHEDULE_DAYS
      : SCHEDULE_DAYS.filter((day) => day.dayIndex === activeDayIndex),
    [activeDayIndex, view],
  );

  const visibleAppointments = useMemo(
    () => appointments.filter((appointment) =>
      appointment.status !== 'cancelled'
      && (staffFilter === 'all' || appointment.staffId === staffFilter)
      && visibleDays.some((day) => day.dayIndex === appointment.dayIndex),
    ),
    [appointments, staffFilter, visibleDays],
  );

  const selectedAppointment = appointments.find((appointment) => appointment.id === selectedId) ?? null;
  const pendingCount = appointments.filter((appointment) =>
    appointment.status === 'change_pending' || appointment.status === 'pending_approval',
  ).length;
  const todayCount = appointments.filter((appointment) =>
    appointment.dayIndex === 4 && appointment.status !== 'cancelled',
  ).length;

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(null), 3200);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  useEffect(() => {
    if (!adminApi.configured) return;
    let cancelled = false;
    setAdminPersistence({ mode: 'loading', label: 'Loading saved services...' });
    void adminApi.listServices()
      .then((services) => {
        if (cancelled) return;
        if (services.length) {
          setAdminServices(services);
        } else {
          setAdminServices([{
            ...INITIAL_ADMIN_SERVICES[0],
            id: `draft-${Date.now()}`,
            name: 'First service',
            slug: 'first-service',
            isPublic: false,
            version: 1,
          }]);
        }
        setAdminPersistence({ mode: 'connected', label: 'Saved to Chime' });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : 'Could not load saved services.';
        setAdminPersistence({ mode: 'error', label: 'Not connected' });
        setToast(`${message} Session-only services are still available.`);
      });
    return () => {
      cancelled = true;
    };
  }, [adminApi]);

  const saveAdminService = useCallback(async (
    service: AdminServiceDefinition,
  ): Promise<AdminServiceDefinition> => {
    if (!adminApi.configured) {
      setAdminPersistence({ mode: 'demo', label: 'Saved for this session' });
      setToast(`${service.name} is saved for this browser session.`);
      return service;
    }

    setAdminPersistence({ mode: 'saving', label: 'Saving to Chime...' });
    try {
      const saved = await adminApi.saveService(service);
      setAdminServices((current) => current.map((item) =>
        item.id === service.id ? saved : item,
      ));
      setAdminPersistence({ mode: 'connected', label: 'Saved to Chime' });
      setToast(`${saved.name} was saved with version ${saved.version}.`);
      return saved;
    } catch (error) {
      const message = error instanceof AdminApiClientError
        ? error.message
        : 'The service could not be saved.';
      setAdminPersistence({ mode: 'error', label: 'Save needs attention' });
      setToast(message);
      return service;
    }
  }, [adminApi]);

  useEffect(() => {
    if (!interaction) return;

    document.body.classList.add('chime-admin-is-dragging');

    function getTargetDayIndex(event: PointerEvent): number {
      if (interaction?.mode !== 'move') return interaction?.originDayIndex ?? 0;
      const target = document
        .elementFromPoint(event.clientX, event.clientY)
        ?.closest<HTMLElement>('[data-day-index]');
      const parsed = Number(target?.dataset.dayIndex);
      return Number.isInteger(parsed) ? parsed : interaction.originDayIndex;
    }

    function handlePointerMove(event: PointerEvent) {
      if (!interaction || event.pointerId !== interaction.pointerId) return;
      event.preventDefault();

      const minuteDelta = snap(
        (event.clientY - interaction.originClientY) / PIXELS_PER_MINUTE,
      );

      setAppointments((current) => current.map((appointment) => {
        if (appointment.id !== interaction.appointmentId) return appointment;

        if (interaction.mode === 'resize') {
          const maximumDuration = END_MINUTES - interaction.originStartMinutes;
          return {
            ...appointment,
            durationMinutes: clamp(
              interaction.originDurationMinutes + minuteDelta,
              SNAP_MINUTES,
              maximumDuration,
            ),
          };
        }

        const nextStart = clamp(
          interaction.originStartMinutes + minuteDelta,
          START_MINUTES,
          END_MINUTES - interaction.originDurationMinutes,
        );

        return {
          ...appointment,
          dayIndex: getTargetDayIndex(event),
          startMinutes: nextStart,
        };
      }));
    }

    function handlePointerUp(event: PointerEvent) {
      if (!interaction || event.pointerId !== interaction.pointerId) return;

      const minuteDelta = snap(
        (event.clientY - interaction.originClientY) / PIXELS_PER_MINUTE,
      );
      const targetDayIndex = getTargetDayIndex(event);
      const moved = Math.abs(event.clientX - interaction.originClientX) > 4
        || Math.abs(event.clientY - interaction.originClientY) > 4
        || targetDayIndex !== interaction.originDayIndex
        || minuteDelta !== 0;

      if (moved) {
        setAppointments((current) => current.map((appointment) => {
          if (appointment.id !== interaction.appointmentId) return appointment;
          if (appointment.status === 'draft' || appointment.status === 'held') return appointment;

          return {
            ...appointment,
            status: 'change_pending',
            changeRequestedBy: 'admin',
            pendingOrigin: interaction.previousPendingOrigin ?? {
              dayIndex: interaction.originDayIndex,
              startMinutes: interaction.originStartMinutes,
              durationMinutes: interaction.originDurationMinutes,
              staffId: interaction.originStaffId,
            },
          };
        }));
        setToast('Change prepared. The customer can now review the new time.');
      }

      setInteraction(null);
    }

    window.addEventListener('pointermove', handlePointerMove, { passive: false });
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerUp);

    return () => {
      document.body.classList.remove('chime-admin-is-dragging');
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);
    };
  }, [interaction]);

  function beginInteraction(
    event: ReactPointerEvent<HTMLElement>,
    appointment: ScheduleAppointment,
    mode: PointerInteraction['mode'],
  ) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    setSelectedId(appointment.id);
    setInteraction({
      appointmentId: appointment.id,
      mode,
      pointerId: event.pointerId,
      originClientX: event.clientX,
      originClientY: event.clientY,
      originDayIndex: appointment.dayIndex,
      originStartMinutes: appointment.startMinutes,
      originDurationMinutes: appointment.durationMinutes,
      originStaffId: appointment.staffId,
      previousStatus: appointment.status,
      previousPendingOrigin: appointment.pendingOrigin,
    });
  }

  function prepareAppointmentChange(
    appointmentId: string,
    update: Partial<Pick<ScheduleAppointment, 'durationMinutes' | 'staffId' | 'startMinutes' | 'dayIndex'>>,
  ) {
    setAppointments((current) => current.map((appointment) => {
      if (appointment.id !== appointmentId) return appointment;
      const pendingOrigin = appointment.pendingOrigin ?? {
        dayIndex: appointment.dayIndex,
        startMinutes: appointment.startMinutes,
        durationMinutes: appointment.durationMinutes,
        staffId: appointment.staffId,
      };

      return {
        ...appointment,
        ...update,
        status: appointment.status === 'draft' || appointment.status === 'held'
          ? appointment.status
          : 'change_pending',
        changeRequestedBy: appointment.status === 'draft' || appointment.status === 'held'
          ? appointment.changeRequestedBy
          : 'admin',
        pendingOrigin,
      };
    }));
    setToast('Appointment updated. Approval status is shown on the schedule.');
  }

  function handleAppointmentKeyDown(
    event: KeyboardEvent<HTMLElement>,
    appointment: ScheduleAppointment,
  ) {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    event.preventDefault();
    const direction = event.key === 'ArrowUp' ? -SNAP_MINUTES : SNAP_MINUTES;
    prepareAppointmentChange(appointment.id, {
      startMinutes: clamp(
        appointment.startMinutes + direction,
        START_MINUTES,
        END_MINUTES - appointment.durationMinutes,
      ),
    });
  }

  function resolveChange(appointmentId: string, decision: 'approve' | 'decline' | 'withdraw') {
    setAppointments((current) => current.map((appointment) => {
      if (appointment.id !== appointmentId) return appointment;

      if (decision === 'approve') {
        return {
          ...appointment,
          status: 'confirmed',
          changeRequestedBy: undefined,
          pendingOrigin: undefined,
        };
      }

      const origin = appointment.pendingOrigin;
      return {
        ...appointment,
        dayIndex: origin?.dayIndex ?? appointment.dayIndex,
        startMinutes: origin?.startMinutes ?? appointment.startMinutes,
        durationMinutes: origin?.durationMinutes ?? appointment.durationMinutes,
        staffId: origin?.staffId ?? appointment.staffId,
        status: 'confirmed',
        changeRequestedBy: undefined,
        pendingOrigin: undefined,
      };
    }));

    setToast(
      decision === 'approve'
        ? 'Change approved and the appointment is confirmed.'
        : decision === 'decline'
          ? 'Change declined. The original appointment has been restored.'
          : 'Change request withdrawn. The original time has been restored.',
    );
  }

  function resolveInitialRequest(appointmentId: string, approved: boolean) {
    setAppointments((current) => current.map((appointment) =>
      appointment.id === appointmentId
        ? { ...appointment, status: approved ? 'confirmed' : 'declined' }
        : appointment,
    ));
    setToast(approved ? 'Appointment approved and customer notified.' : 'Request declined and customer notified.');
  }

  function createAppointment() {
    const nextId = `draft-${Date.now()}`;
    const chosenStaff = staffFilter === 'all' ? SCHEDULE_STAFF[0].id : staffFilter;
    const draft: ScheduleAppointment = {
      id: nextId,
      customer: 'New customer',
      customerEmail: '',
      service: 'First-time consultation',
      dayIndex: activeDayIndex,
      startMinutes: 16 * 60,
      durationMinutes: 60,
      staffId: chosenStaff,
      location: 'Studio A',
      tone: 'mint',
      status: 'draft',
      source: 'admin',
    };
    setAppointments((current) => [...current, draft]);
    setSelectedId(nextId);
    setToast('Draft added at 4:00 PM. Finish it in the details panel.');
  }

  function saveDraft(appointmentId: string) {
    setAppointments((current) => current.map((appointment) =>
      appointment.id === appointmentId
        ? { ...appointment, status: 'confirmed' }
        : appointment,
    ));
    setToast('Appointment confirmed. The customer notification is ready.');
  }

  function updateAppointmentText(
    appointmentId: string,
    field: 'customer' | 'customerEmail' | 'service' | 'location',
    value: string,
  ) {
    setAppointments((current) => current.map((appointment) =>
      appointment.id === appointmentId ? { ...appointment, [field]: value } : appointment,
    ));
  }

  const gridStyle = {
    '--visible-days': visibleDays.length,
    '--grid-height': `${GRID_HEIGHT}px`,
    '--hour-height': `${60 * PIXELS_PER_MINUTE}px`,
  } as CSSProperties;

  return (
    <div className="chime-admin">
      <a className="admin-skip-link" href="#admin-schedule">Skip to schedule</a>

      <aside className="admin-sidebar">
        <div className="admin-brand">
          <span className="admin-brand__mark" aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
          <div>
            <strong>chime</strong>
            <small>business studio</small>
          </div>
        </div>

        <button className="admin-workspace-switcher" type="button">
          <span className="admin-avatar admin-avatar--sun">SK</span>
          <span>
            <small>Workspace</small>
            <strong>Sea & Kin Studio</strong>
          </span>
          <Icon name="chevron-right" size={16} />
        </button>

        <nav className="admin-nav" aria-label="Admin workspace">
          <p>Workspace</p>
          {NAV_ITEMS.map((item) => (
            <button
              className={item.label === activeWorkspace ? 'is-active' : ''}
              type="button"
              key={item.label}
              aria-current={item.label === activeWorkspace ? 'page' : undefined}
              onClick={() => {
                if (item.label === 'Schedule' || item.label === 'Requests' || item.label === 'Messages' || item.label === 'Services' || item.label === 'Team' || item.label === 'Availability' || item.label === 'Customers') {
                  setActiveWorkspace(item.label);
                } else {
                  setToast(`${item.label} is mapped for the next Chime build.`);
                }
              }}
            >
              <Icon name={item.icon} size={19} />
              <span>{item.label}</span>
              {item.badge ? <b>{pendingCount}</b> : null}
            </button>
          ))}
        </nav>

        <div className="admin-sidebar__bottom">
          <button type="button" onClick={() => setToast('Settings will use the same no-code controls as the widget designer.')}>
            <Icon name="settings" size={19} />
            <span>Settings</span>
          </button>
          <div className="admin-profile">
            <span className="admin-avatar">CJ</span>
            <span>
              <strong>Christian</strong>
              <small>Owner</small>
            </span>
            <span className="admin-online-dot" title="Online" />
          </div>
        </div>
      </aside>

      <main className="admin-main">
          {activeWorkspace === 'Schedule' || activeWorkspace === 'Requests' ? (
            adminApi.configured ? (
              <OperationsStudio
                initialWorkspace={activeWorkspace === 'Requests' ? 'requests' : 'schedule'}
                onNotify={setToast}
              />
            ) : (
          <>
        <header className="admin-topbar">
          <div className="admin-topbar__title">
            <p>Friday, August 14</p>
            <h1>Your schedule</h1>
          </div>

          <div className="admin-topbar__actions">
            <label className="admin-search">
              <span className="admin-visually-hidden">Search appointments</span>
              <Icon name="search" size={18} />
              <input type="search" placeholder="Search" />
              <kbd>⌘ K</kbd>
            </label>
            <button className="admin-icon-button" type="button" aria-label="Notifications" onClick={() => setToast(`${pendingCount} requests need attention.`)}>
              <Icon name="bell" size={19} />
              <span />
            </button>
            <button className="admin-primary-button" type="button" onClick={createAppointment}>
              <Icon name="plus" size={18} strokeWidth={2.2} />
              New appointment
            </button>
          </div>
        </header>

        <section className="admin-overview" aria-label="Schedule overview">
          <article>
            <span className="admin-overview__icon admin-overview__icon--mint"><Icon name="calendar" size={18} /></span>
            <div>
              <small>Today</small>
              <strong>{todayCount} appointments</strong>
            </div>
            <em>On pace</em>
          </article>
          <article>
            <span className="admin-overview__icon admin-overview__icon--peach"><Icon name="inbox" size={18} /></span>
            <div>
              <small>Needs attention</small>
              <strong>{pendingCount} requests</strong>
            </div>
            <button type="button" onClick={() => {
              const firstPending = appointments.find((appointment) => appointment.status === 'change_pending' || appointment.status === 'pending_approval');
              if (firstPending) setSelectedId(firstPending.id);
            }}>Review</button>
          </article>
          <article>
            <span className="admin-overview__icon admin-overview__icon--sky"><Icon name="insights" size={18} /></span>
            <div>
              <small>This week</small>
              <strong>76% booked</strong>
            </div>
            <em>+8%</em>
          </article>
          <article>
            <span className="admin-overview__icon admin-overview__icon--lemon"><Icon name="clock" size={18} /></span>
            <div>
              <small>Next opening</small>
              <strong>Today, 3:30 PM</strong>
            </div>
            <em>45 min</em>
          </article>
        </section>

        <section className="admin-workspace" id="admin-schedule">
          <div className="admin-schedule-card">
            <div className="admin-schedule-toolbar">
              <div className="admin-week-picker">
                <button type="button" aria-label="Previous week" onClick={() => setToast('Previous week selected.')}><Icon name="chevron-left" size={18} /></button>
                <div>
                  <strong>August 10 - 14</strong>
                  <span>2026</span>
                </div>
                <button type="button" aria-label="Next week" onClick={() => setToast('Next week selected.')}><Icon name="chevron-right" size={18} /></button>
                <button className="admin-today-button" type="button" onClick={() => {
                  setActiveDayIndex(4);
                  if (view === 'day') setToast('Showing today.');
                }}>Today</button>
              </div>

              <div className="admin-toolbar-group">
                <div className="admin-view-toggle" aria-label="Calendar view">
                  <button className={view === 'week' ? 'is-active' : ''} type="button" onClick={() => setView('week')}>Week</button>
                  <button className={view === 'day' ? 'is-active' : ''} type="button" onClick={() => setView('day')}>Day</button>
                </div>
                <button className="admin-secondary-button" type="button" onClick={() => setToast('All active services are visible in this prototype.')}>
                  <Icon name="filter" size={17} />
                  Filters
                </button>
              </div>
            </div>

            <div className="admin-staff-filter" aria-label="Filter by team member">
              <span>Team</span>
              <button
                className={staffFilter === 'all' ? 'is-active' : ''}
                type="button"
                onClick={() => setStaffFilter('all')}
              >
                <i className="admin-staff-stack" aria-hidden="true">
                  {SCHEDULE_STAFF.map((staff) => <b key={staff.id} style={{ background: staff.color }}>{staff.initials.slice(0, 1)}</b>)}
                </i>
                Everyone
              </button>
              {SCHEDULE_STAFF.map((staff) => (
                <button
                  className={staffFilter === staff.id ? 'is-active' : ''}
                  type="button"
                  key={staff.id}
                  onClick={() => setStaffFilter(staff.id)}
                >
                  <i style={{ background: staff.color }}>{staff.initials}</i>
                  {staff.shortName}
                </button>
              ))}
              <small><Icon name="grip" size={15} /> Drag appointments to move them. Pull the bottom edge to resize.</small>
            </div>

            <div className="admin-calendar-scroll">
              <div className="admin-calendar" style={gridStyle}>
                <div className="admin-calendar-head">
                  <div className="admin-time-zone">HST</div>
                  {visibleDays.map((day) => (
                    <button
                      className={day.dayIndex === activeDayIndex ? 'is-active' : ''}
                      data-today={day.isToday || undefined}
                      type="button"
                      key={day.dayIndex}
                      onClick={() => {
                        setActiveDayIndex(day.dayIndex);
                        if (view === 'day') setToast(`${day.fullName}, August ${day.date} selected.`);
                      }}
                    >
                      <span>{day.shortName}</span>
                      <strong>{day.date}</strong>
                      {day.isToday ? <i>Today</i> : null}
                    </button>
                  ))}
                </div>

                <div className="admin-calendar-body">
                  <div className="admin-time-axis" aria-hidden="true">
                    {Array.from({ length: 11 }, (_, index) => START_MINUTES + index * 60).map((minutes) => (
                      <span key={minutes} style={{ top: (minutes - START_MINUTES) * PIXELS_PER_MINUTE }}>
                        {formatTime(minutes).replace(':00', '')}
                      </span>
                    ))}
                  </div>

                  {visibleDays.map((day) => (
                    <div
                      className="admin-day-lane"
                      data-day-index={day.dayIndex}
                      data-today={day.isToday || undefined}
                      key={day.dayIndex}
                    >
                      {day.isToday ? (
                        <div
                          className="admin-now-line"
                          style={{ top: (12 * 60 + 35 - START_MINUTES) * PIXELS_PER_MINUTE }}
                        >
                          <span>12:35</span>
                        </div>
                      ) : null}

                      {visibleAppointments
                        .filter((appointment) => appointment.dayIndex === day.dayIndex)
                        .map((appointment) => {
                          const staff = getStaff(appointment.staffId);
                          const top = (appointment.startMinutes - START_MINUTES) * PIXELS_PER_MINUTE + 4;
                          const height = Math.max(42, appointment.durationMinutes * PIXELS_PER_MINUTE - 8);
                          const appointmentStyle = {
                            top,
                            height,
                            '--staff-color': staff.color,
                          } as CSSProperties;

                          return (
                            <article
                              aria-label={`${appointment.service} with ${appointment.customer}, ${formatTime(appointment.startMinutes)} to ${formatTime(appointment.startMinutes + appointment.durationMinutes)}`}
                              className={`admin-appointment admin-appointment--${appointment.tone}${selectedId === appointment.id ? ' is-selected' : ''}${interaction?.appointmentId === appointment.id ? ' is-dragging' : ''}`}
                              data-compact={appointment.durationMinutes <= 30 || undefined}
                              data-status={appointment.status}
                              key={appointment.id}
                              onClick={() => setSelectedId(appointment.id)}
                              onKeyDown={(event) => handleAppointmentKeyDown(event, appointment)}
                              onPointerDown={(event) => beginInteraction(event, appointment, 'move')}
                              role="button"
                              style={appointmentStyle}
                              tabIndex={0}
                            >
                              <div className="admin-appointment__topline">
                                <span>{formatTime(appointment.startMinutes)}</span>
                                {(appointment.status === 'change_pending' || appointment.status === 'pending_approval') ? (
                                  <b>{appointment.status === 'change_pending' ? 'Pending' : 'Approve'}</b>
                                ) : null}
                              </div>
                              <strong>{appointment.customer}</strong>
                              <small>{appointment.service}</small>
                              <span className="admin-appointment__staff" title={staff.name}>{staff.initials}</span>
                              <button
                                aria-label={`Resize ${appointment.customer}'s appointment`}
                                className="admin-resize-handle"
                                type="button"
                                onClick={(event) => event.stopPropagation()}
                                onPointerDown={(event) => beginInteraction(event, appointment, 'resize')}
                              >
                                <i /><i /><i />
                              </button>
                            </article>
                          );
                        })}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <AppointmentInspector
            appointment={selectedAppointment}
            onApprove={(appointmentId) => resolveChange(appointmentId, 'approve')}
            onDecline={(appointmentId) => resolveChange(appointmentId, 'decline')}
            onInitialDecision={resolveInitialRequest}
            onPrepareChange={prepareAppointmentChange}
            onRemind={() => setToast('A friendly approval reminder is ready to send.')}
            onSaveDraft={saveDraft}
            onTextChange={updateAppointmentText}
            onWithdraw={(appointmentId) => resolveChange(appointmentId, 'withdraw')}
          />
        </section>
          </>
            )
          ) : activeWorkspace === 'Messages' ? (
          <CommunicationStudio api={adminApi} onNotify={setToast} />
          ) : activeWorkspace === 'Services' ? (
          <ServiceStudio
            services={adminServices}
            onServicesChange={setAdminServices}
            onNotify={setToast}
            onSaveService={saveAdminService}
            persistence={adminPersistence}
          />
        ) : activeWorkspace === 'Availability' ? (
          <AvailabilityStudio api={adminApi} onNotify={setToast} />
        ) : activeWorkspace === 'Customers' ? (
          <CustomerStudio api={adminApi} />
        ) : (
          <TeamStudio api={adminApi} onNotify={setToast} />
        )}
      </main>

      {toast ? (
        <div className="admin-toast" role="status">
          <span><Icon name="sparkle" size={17} /></span>
          {toast}
          <button type="button" aria-label="Dismiss notification" onClick={() => setToast(null)}><Icon name="x" size={15} /></button>
        </div>
      ) : null}
    </div>
  );
}

interface AppointmentInspectorProps {
  appointment: ScheduleAppointment | null;
  onApprove: (appointmentId: string) => void;
  onDecline: (appointmentId: string) => void;
  onInitialDecision: (appointmentId: string, approved: boolean) => void;
  onPrepareChange: (
    appointmentId: string,
    update: Partial<Pick<ScheduleAppointment, 'durationMinutes' | 'staffId' | 'startMinutes' | 'dayIndex'>>,
  ) => void;
  onRemind: () => void;
  onSaveDraft: (appointmentId: string) => void;
  onTextChange: (
    appointmentId: string,
    field: 'customer' | 'customerEmail' | 'service' | 'location',
    value: string,
  ) => void;
  onWithdraw: (appointmentId: string) => void;
}

function AppointmentInspector({
  appointment,
  onApprove,
  onDecline,
  onInitialDecision,
  onPrepareChange,
  onRemind,
  onSaveDraft,
  onTextChange,
  onWithdraw,
}: AppointmentInspectorProps) {
  if (!appointment) {
    return (
      <aside className="admin-inspector admin-inspector--empty">
        <span><Icon name="calendar" size={23} /></span>
        <h2>Select an appointment</h2>
        <p>Choose any card to see its customer, timing, staff, and approval controls.</p>
      </aside>
    );
  }

  const day = getDay(appointment.dayIndex);
  const staff = getStaff(appointment.staffId);
  const isPendingChange = appointment.status === 'change_pending';
  const isCustomerChange = isPendingChange && appointment.changeRequestedBy === 'customer';
  const isAdminChange = isPendingChange && appointment.changeRequestedBy === 'admin';
  const isDraft = appointment.status === 'draft';

  return (
    <aside className="admin-inspector" aria-label="Appointment details">
      <div className="admin-inspector__header">
        <div>
          <p>Appointment</p>
          <h2>{isDraft ? 'New appointment' : appointment.customer}</h2>
        </div>
        <span className="admin-status-pill" data-status={appointment.status}>
          <i />
          {getStatusLabel(appointment.status)}
        </span>
      </div>

      {isPendingChange ? (
        <div className="admin-request-banner" data-requester={appointment.changeRequestedBy}>
          <span><Icon name={isCustomerChange ? 'inbox' : 'send'} size={18} /></span>
          <div>
            <strong>{isCustomerChange ? 'Customer requested a change' : 'Waiting for customer approval'}</strong>
            <p>
              {isCustomerChange
                ? `${appointment.customer} proposed this new time.`
                : `The new time is being held while ${appointment.customer} decides.`}
            </p>
          </div>
        </div>
      ) : null}

      <div className="admin-inspector__form">
        <label>
          <span>Customer</span>
          <input
            value={appointment.customer}
            readOnly={!isDraft}
            onChange={(event) => onTextChange(appointment.id, 'customer', event.target.value)}
          />
        </label>
        <label>
          <span>Email</span>
          <input
            type="email"
            value={appointment.customerEmail}
            readOnly={!isDraft}
            placeholder="customer@example.com"
            onChange={(event) => onTextChange(appointment.id, 'customerEmail', event.target.value)}
          />
        </label>
        <label>
          <span>Service</span>
          <select
            value={appointment.service}
            onChange={(event) => onTextChange(appointment.id, 'service', event.target.value)}
          >
            <option>First-time consultation</option>
            <option>Follow-up session</option>
            <option>Quick check-in</option>
            <option>Extended service</option>
          </select>
        </label>
      </div>

      <div className="admin-inspector__section">
        <div className="admin-inspector__section-title">
          <span>When & where</span>
          <small>Drag or resize the card</small>
        </div>
        <div className="admin-detail-row">
          <span><Icon name="calendar" size={17} /></span>
          <div>
            <strong>{day.fullName}, {day.month} {day.date}</strong>
            <small>{formatTime(appointment.startMinutes)} - {formatTime(appointment.startMinutes + appointment.durationMinutes)}</small>
          </div>
        </div>
        <div className="admin-detail-row">
          <span><Icon name="pin" size={17} /></span>
          <div>
            <strong>{appointment.location}</strong>
            <small>Sea & Kin Studio</small>
          </div>
        </div>
      </div>

      <div className="admin-inspector__section">
        <div className="admin-inspector__section-title">
          <span>Appointment length</span>
          <small>Resizable</small>
        </div>
        <div className="admin-duration-options">
          {DURATION_OPTIONS.map((duration) => (
            <button
              className={appointment.durationMinutes === duration ? 'is-active' : ''}
              type="button"
              key={duration}
              onClick={() => onPrepareChange(appointment.id, { durationMinutes: duration })}
            >
              {duration < 60 ? `${duration}m` : duration === 60 ? '1h' : '1h 30'}
            </button>
          ))}
        </div>
      </div>

      <div className="admin-inspector__section">
        <div className="admin-inspector__section-title">
          <span>Assigned team member</span>
        </div>
        <label className="admin-staff-select">
          <i style={{ background: staff.color }}>{staff.initials}</i>
          <select
            aria-label="Assigned team member"
            value={appointment.staffId}
            onChange={(event) => onPrepareChange(appointment.id, { staffId: event.target.value })}
          >
            {SCHEDULE_STAFF.map((member) => (
              <option value={member.id} key={member.id}>{member.name}</option>
            ))}
          </select>
        </label>
      </div>

      {!isDraft ? (
        <div className="admin-inspector__section admin-customer-contact">
          <div className="admin-inspector__section-title"><span>Contact</span></div>
          <a href={`mailto:${appointment.customerEmail}`}><Icon name="mail" size={16} />{appointment.customerEmail}</a>
          {appointment.customerPhone ? <a href={`tel:${appointment.customerPhone}`}><Icon name="phone" size={16} />{appointment.customerPhone}</a> : null}
        </div>
      ) : null}

      {appointment.notes ? (
        <div className="admin-note">
          <span><Icon name="sparkle" size={16} /></span>
          <p>{appointment.notes}</p>
        </div>
      ) : null}

      <div className="admin-inspector__actions">
        {isCustomerChange ? (
          <>
            <button className="admin-primary-button" type="button" onClick={() => onApprove(appointment.id)}><Icon name="check" size={18} />Approve change</button>
            <button className="admin-danger-button" type="button" onClick={() => onDecline(appointment.id)}><Icon name="x" size={17} />Decline</button>
          </>
        ) : null}
        {isAdminChange ? (
          <>
            <button className="admin-primary-button" type="button" onClick={onRemind}><Icon name="send" size={17} />Send reminder</button>
            <button className="admin-secondary-button" type="button" onClick={() => onWithdraw(appointment.id)}><Icon name="undo" size={17} />Withdraw change</button>
          </>
        ) : null}
        {appointment.status === 'pending_approval' ? (
          <>
            <button className="admin-primary-button" type="button" onClick={() => onInitialDecision(appointment.id, true)}><Icon name="check" size={18} />Confirm appointment</button>
            <button className="admin-danger-button" type="button" onClick={() => onInitialDecision(appointment.id, false)}><Icon name="x" size={17} />Decline request</button>
          </>
        ) : null}
        {isDraft ? (
          <button className="admin-primary-button admin-primary-button--wide" type="button" onClick={() => onSaveDraft(appointment.id)}><Icon name="check" size={18} />Save appointment</button>
        ) : null}
      </div>

      <p className="admin-inspector__footnote">
        Last updated just now <span /> Chime records every schedule change.
      </p>
    </aside>
  );
}

export default AdminApp;
