import {
  useEffect,
  useCallback,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import {
  AdminApiClientError,
  createAdminApiClient,
  type AdminNavigationCounts,
  type AdminPersistenceState,
} from './adminApi';
import { describeMissingConnection } from './adminConnection';
import ServiceStudio from './ServiceStudio';
import TeamStudio from './TeamStudio';
import OperationsStudio from './OperationsStudio';
import CommunicationStudio from './CommunicationStudio';
import { CustomerStudio } from './CustomerStudio';
import AvailabilityStudio from './AvailabilityStudio';
import WidgetStudio from './WidgetStudio';
import PaymentsStudio from './PaymentsStudio';
import InsightsStudio from './InsightsStudio';
import SettingsStudio from './SettingsStudio';
import LaunchStudio from './LaunchStudio';
import WorkspaceBadge from './WorkspaceBadge';
import LoginScreen from './LoginScreen';
import { clearSession, onSessionEnded, readSession } from './adminSession';
import chimeBellLogo from '@/assets/brand/chime-bell.png';
import chimeWordmarkLogo from '@/assets/brand/chime-wordmark.png';
import type { AdminServiceDefinition } from './serviceTypes';

type IconName =
  | 'calendar'
  | 'inbox'
  | 'services'
  | 'team'
  | 'customers'
  | 'insights'
  | 'palette'
  | 'payments'
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
  payments: <><rect x="2.5" y="5" width="19" height="14" rx="3" /><path d="M2.5 10h19M7 15h3" /></>,
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

type Workspace =
  | 'Schedule' | 'Requests' | 'Messages' | 'Services' | 'Team' | 'Availability'
  | 'Customers' | 'Payments' | 'Insights' | 'Widget designer' | 'Launch' | 'Settings';

/** Which count, if any, belongs beside an area. */
type CountKey = 'pendingRequests' | 'failedMessages';

interface NavArea {
  label: string;
  icon: IconName;
  /** Screens inside this area, shown when it is open. */
  screens: readonly Workspace[];
  /** Summed onto the area header so a collapsed area still shows its work. */
  counts?: readonly CountKey[];
}

/**
 * Eleven flat destinations asked a small-business owner to choose among things
 * that are parts of the same job. These are the same screens, grouped into the
 * five areas the tightening plan describes — nothing added, nothing removed.
 */
const NAV_AREAS: readonly NavArea[] = [
  {
    label: 'Appointments',
    icon: 'calendar',
    screens: ['Schedule', 'Requests'],
    counts: ['pendingRequests'],
  },
  {
    label: 'Business setup',
    icon: 'services',
    screens: ['Services', 'Team', 'Availability'],
  },
  {
    label: 'Customers',
    icon: 'customers',
    screens: ['Customers', 'Messages'],
    counts: ['failedMessages'],
  },
  {
    label: 'Money',
    icon: 'payments',
    screens: ['Payments', 'Insights'],
  },
  {
    label: 'Booking widget',
    icon: 'palette',
    screens: ['Widget designer', 'Launch'],
  },
];

const SCREEN_ICONS: Record<Workspace, IconName> = {
  Schedule: 'calendar',
  Requests: 'inbox',
  Services: 'services',
  Team: 'team',
  Availability: 'clock',
  Customers: 'customers',
  Messages: 'mail',
  Payments: 'payments',
  Insights: 'insights',
  'Widget designer': 'palette',
  Launch: 'send',
  Settings: 'settings',
};

function areaContaining(screen: Workspace): NavArea | undefined {
  return NAV_AREAS.find((area) => area.screens.includes(screen));
}

function AdminApp() {
  // sessionStorage is external to React, so the session is mirrored into state
  // and updated explicitly at sign-in, sign-out, and on a 401. Keying a useMemo
  // off a counter would work at runtime but reads as an unnecessary dependency,
  // because nothing in the memo body references it.
  const [session, setSession] = useState(() => readSession());
  const [toast, setToast] = useState<string | null>(null);
  const [activeWorkspace, setActiveWorkspace] = useState<Workspace>('Schedule');
  // Exactly one area is open at a time, so at most five headers plus one area's
  // screens are visible — the plan's "no more than five primary choices".
  const [openArea, setOpenArea] = useState<string | null>(
    () => areaContaining('Schedule')?.label ?? null,
  );
  const [counts, setCounts] = useState<AdminNavigationCounts | null>(null);
  const [adminServices, setAdminServices] = useState<AdminServiceDefinition[]>([]);
  // Rebuilt whenever the token changes, so requests never carry a stale one.
  const adminApi = useMemo(() => createAdminApiClient(session?.token), [session?.token]);
  const [adminPersistence, setAdminPersistence] = useState<AdminPersistenceState>(() =>
    adminApi.configured
      ? { mode: 'loading', label: 'Connecting to Chime...' }
      : { mode: 'error', label: 'Not connected' },
  );

  useEffect(() => {
    // A 401 anywhere in the studio ends the session; re-render into the login
    // screen rather than leaving stale workspaces on screen.
    onSessionEnded(() => setSession(null));
    return () => onSessionEnded(null);
  }, []);

  useEffect(() => {
    const area = areaContaining(activeWorkspace);
    if (area) setOpenArea(area.label);
  }, [activeWorkspace]);

  // Badges must reflect real work, so they come from the server rather than
  // from whichever studio happens to be mounted. Refreshed when the active
  // screen changes, which is when an administrator has likely just resolved
  // something.
  useEffect(() => {
    if (!adminApi.configured) return;
    let cancelled = false;
    void adminApi.getNavigationCounts()
      .then((next) => { if (!cancelled) setCounts(next); })
      .catch(() => { if (!cancelled) setCounts(null); });
    return () => { cancelled = true; };
  }, [adminApi, activeWorkspace]);

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
        // An empty result is a real answer, not a reason to invent a draft.
        setAdminServices(services);
        setAdminPersistence(
          services.length
            ? { mode: 'connected', label: 'Saved to Chime' }
            : { mode: 'connected', label: 'No services yet' },
        );
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : 'Could not load saved services.';
        setAdminServices([]);
        setAdminPersistence({ mode: 'error', label: 'Not connected' });
        setToast(message);
      });
    return () => {
      cancelled = true;
    };
  }, [adminApi]);

  const signOut = useCallback(() => {
    clearSession();
    setSession(null);
  }, []);

  const saveAdminService = useCallback(async (
    service: AdminServiceDefinition,
  ): Promise<AdminServiceDefinition> => {
    if (!adminApi.configured) {
      // Saying "saved for this session" reads as success. Nothing is stored.
      setAdminPersistence({ mode: 'error', label: 'Not connected' });
      setToast(
        describeMissingConnection()
          ?? `${service.name} was not saved: Chime is not connected.`,
      );
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

  // No session means no studio. Previously the shell rendered regardless and
  // each workspace failed on its own, which read as a broken product rather
  // than as "you are signed out".
  if (!session) {
    return <LoginScreen onSignedIn={() => setSession(readSession())} />;
  }
  return (
    <div className="chime-admin">
      <a className="admin-skip-link" href="#admin-schedule">Skip to schedule</a>

      <aside className="admin-sidebar">
        {/* The plan asks that Schedule be reachable from anywhere in one
            action. The brand is the one element present on every screen. */}
        <button
          className="admin-brand"
          onClick={() => setActiveWorkspace('Schedule')}
          title="Back to Schedule"
          type="button"
        >
          <span className="admin-brand__mark" aria-hidden="true">
            <img src={chimeBellLogo} alt="" />
          </span>
          <div>
            <img className="admin-brand__wordmark" src={chimeWordmarkLogo} alt="Chime" />
            <small>business studio</small>
          </div>
        </button>

        <button className="admin-workspace-switcher" type="button">
          <span className="admin-avatar admin-avatar--sun">SK</span>
          <span>
            <small>Workspace</small>
            <strong>Sea & Kin Studio</strong>
          </span>
          <Icon name="chevron-right" size={16} />
        </button>

        <WorkspaceBadge api={adminApi} />

        <nav className="admin-nav" aria-label="Admin workspace">
          {NAV_AREAS.map((area) => {
            const open = openArea === area.label;
            const areaCount = (area.counts ?? [])
              .reduce((total, key) => total + (counts?.[key] ?? 0), 0);
            const holdsActive = area.screens.includes(activeWorkspace);

            return (
              <div className="admin-nav__area" key={area.label}>
                <button
                  aria-expanded={open}
                  className={`admin-nav__area-header${holdsActive ? ' holds-active' : ''}`}
                  onClick={() => setOpenArea(open ? null : area.label)}
                  type="button"
                >
                  <Icon name={area.icon} size={19} />
                  <span>{area.label}</span>
                  {areaCount > 0 ? (
                    <b title={`${areaCount} need${areaCount === 1 ? 's' : ''} attention`}>
                      {areaCount}
                    </b>
                  ) : null}
                  <i className={open ? 'is-open' : ''} aria-hidden="true">
                    <Icon name="chevron-right" size={15} />
                  </i>
                </button>

                {open ? (
                  <div className="admin-nav__screens">
                    {area.screens.map((screen) => (
                      <button
                        aria-current={screen === activeWorkspace ? 'page' : undefined}
                        className={screen === activeWorkspace ? 'is-active' : ''}
                        key={screen}
                        onClick={() => setActiveWorkspace(screen)}
                        type="button"
                      >
                        <Icon name={SCREEN_ICONS[screen]} size={17} />
                        <span>{screen}</span>
                        {screen === 'Requests' && (counts?.pendingRequests ?? 0) > 0
                          ? <b>{counts?.pendingRequests}</b> : null}
                        {screen === 'Messages' && (counts?.failedMessages ?? 0) > 0
                          ? <b>{counts?.failedMessages}</b> : null}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            );
          })}
        </nav>

        <div className="admin-sidebar__bottom">
          <button className={activeWorkspace === 'Settings' ? 'is-active' : ''} type="button" onClick={() => setActiveWorkspace('Settings')}>
            <Icon name="settings" size={19} />
            <span>Settings</span>
          </button>
          <div className="admin-profile">
            <span className="admin-avatar">
              {session.email.slice(0, 2).toUpperCase()}
            </span>
            <span>
              <strong>{session.email}</strong>
              <small>{session.role}</small>
            </span>
            <button
              className="admin-sign-out"
              onClick={signOut}
              title="Sign out"
              type="button"
            >
              Sign out
            </button>
          </div>
        </div>
      </aside>

      <main className="admin-main">
          {activeWorkspace === 'Schedule' || activeWorkspace === 'Requests' ? (
            <OperationsStudio
              initialWorkspace={activeWorkspace === 'Requests' ? 'requests' : 'schedule'}
              onNotify={setToast}
            />
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
        ) : activeWorkspace === 'Payments' ? (
          <PaymentsStudio api={adminApi} onNotify={setToast} />
        ) : activeWorkspace === 'Insights' ? (
          <InsightsStudio api={adminApi} />
        ) : activeWorkspace === 'Settings' ? (
          <SettingsStudio api={adminApi} onNotify={setToast} />
        ) : activeWorkspace === 'Launch' ? (
          <LaunchStudio api={adminApi} onNotify={setToast} />
        ) : activeWorkspace === 'Widget designer' ? (
          <WidgetStudio api={adminApi} onNotify={setToast} />
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

export default AdminApp;
