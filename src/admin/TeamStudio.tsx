import { useEffect, useMemo, useState } from 'react';

import {
  AdminApiClientError,
  type AdminApiClient,
  type AdminAvailabilityException,
  type AdminAvailabilitySummary,
  type AdminLocation,
  type AdminStaffMember,
} from './adminApi';
import './teamStudio.css';
import { describeMissingConnection } from './adminConnection';

const DAYS = [
  ['monday', 'Mon'],
  ['tuesday', 'Tue'],
  ['wednesday', 'Wed'],
  ['thursday', 'Thu'],
  ['friday', 'Fri'],
  ['saturday', 'Sat'],
  ['sunday', 'Sun'],
] as const;

const COLORS = ['#3d9b7c', '#5689b9', '#d47e61', '#b17dba', '#d09b36', '#507d68'];

interface WorkingDay {
  enabled: boolean;
  start: string;
  end: string;
}

interface TeamSettings {
  role: string;
  locationIds: string[];
  workingHours: Record<string, WorkingDay>;
}

interface TeamStudioProps {
  api: AdminApiClient;
  onNotify: (message: string) => void;
}

function defaultHours(): Record<string, WorkingDay> {
  return Object.fromEntries(DAYS.map(([key]) => [key, {
    enabled: key !== 'saturday' && key !== 'sunday',
    start: '09:00',
    end: '17:00',
  }]));
}

function settingsFor(staff: AdminStaffMember): TeamSettings {
  const source = staff.settings ?? {};
  const rawHours = typeof source.workingHours === 'object' && source.workingHours
    ? source.workingHours as Record<string, Partial<WorkingDay>>
    : {};
  const hours = defaultHours();
  for (const [key] of DAYS) {
    hours[key] = { ...hours[key], ...rawHours[key] };
  }
  return {
    role: typeof source.role === 'string' ? source.role : 'Team member',
    locationIds: Array.isArray(source.locationIds)
      ? source.locationIds.filter((id): id is string => typeof id === 'string')
      : [],
    workingHours: hours,
  };
}

function initials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('') || 'TM';
}

function localDate(): string {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
}

function friendlyDate(value: string): string {
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    .format(new Date(`${value}T12:00:00`));
}

function TeamStudio({ api, onNotify }: TeamStudioProps) {
  const [staff, setStaff] = useState<AdminStaffMember[]>([]);
  const [locations, setLocations] = useState<AdminLocation[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [state, setState] = useState<'loading' | 'ready' | 'saving' | 'error'>('loading');
  const [dirty, setDirty] = useState(false);
  const [availability, setAvailability] = useState<AdminAvailabilitySummary | null>(null);
  const [calendarState, setCalendarState] = useState<'previewing' | 'ready' | 'publishing' | 'error'>('previewing');
  const [exceptions, setExceptions] = useState<AdminAvailabilityException[]>([]);
  const [timeOffStart, setTimeOffStart] = useState(localDate);
  const [timeOffEnd, setTimeOffEnd] = useState(localDate);
  const [timeOffReason, setTimeOffReason] = useState('');

  useEffect(() => {
    let cancelled = false;
    if (!api.configured) {
      // 'ready' with an empty roster is indistinguishable from a business
      // that has no team yet. Report the real reason instead.
      setState('error');
      onNotify(describeMissingConnection() ?? 'Chime is not connected.');
      return;
    }
    void Promise.all([api.listStaff(true), api.listLocations(), api.previewAvailability(30)])
      .then(([nextStaff, nextLocations, nextAvailability]) => {
        if (cancelled) return;
        setStaff(nextStaff);
        setLocations(nextLocations);
        setAvailability(nextAvailability);
        setSelectedId((current) => current || nextStaff[0]?.id || '');
        setState('ready');
        setCalendarState('ready');
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setState('error');
        onNotify(error instanceof Error ? error.message : 'The team directory could not be loaded.');
      });
    return () => { cancelled = true; };
  }, [api, onNotify]);

  useEffect(() => {
    let cancelled = false;
    if (!api.configured || !selectedId || selectedId.startsWith('draft-team-')) {
      setExceptions([]);
      return;
    }
    void api.listAvailabilityExceptions(selectedId)
      .then((nextExceptions) => {
        if (!cancelled) setExceptions(nextExceptions);
      })
      .catch((error: unknown) => {
        if (!cancelled) onNotify(error instanceof Error ? error.message : 'Time off could not be loaded.');
      });
    return () => { cancelled = true; };
  }, [api, onNotify, selectedId]);

  const selected = staff.find((member) => member.id === selectedId) ?? null;
  const selectedSettings = selected ? settingsFor(selected) : null;
  const activeCount = staff.filter((member) => member.isActive).length;
  const scheduledDays = selectedSettings
    ? Object.values(selectedSettings.workingHours).filter((day) => day.enabled).length
    : 0;
  const coverage = useMemo(() => new Set(staff.flatMap((member) => settingsFor(member).locationIds)).size, [staff]);

  function updateSelected(patch: Partial<AdminStaffMember>) {
    setDirty(true);
    setStaff((current) => current.map((member) => member.id === selectedId
      ? { ...member, ...patch }
      : member));
  }

  function updateSettings(patch: Partial<TeamSettings>) {
    if (!selected || !selectedSettings) return;
    updateSelected({ settings: { ...selectedSettings, ...patch } });
  }

  function addMember() {
    const draft: AdminStaffMember = {
      id: `draft-team-${Date.now()}`,
      displayName: 'New team member',
      email: '',
      color: COLORS[staff.length % COLORS.length],
      isActive: true,
      settings: {
        role: 'Team member',
        locationIds: locations[0] ? [locations[0].id] : [],
        workingHours: defaultHours(),
      },
      version: 1,
    };
    setStaff((current) => [draft, ...current]);
    setSelectedId(draft.id);
    setDirty(true);
    onNotify('New team member ready to personalize.');
  }

  async function refreshAvailability() {
    if (!api.configured) return;
    setCalendarState('previewing');
    try {
      setAvailability(await api.previewAvailability(30));
      setCalendarState('ready');
    } catch (error) {
      setCalendarState('error');
      onNotify(error instanceof Error ? error.message : 'The customer calendar preview could not be refreshed.');
    }
  }

  async function saveMember(): Promise<boolean> {
    if (!selected || !selected.displayName.trim()) {
      onNotify('Add a name before saving this team member.');
      return false;
    }
    if (!api.configured) {
      setState('ready');
      onNotify(`${selected.displayName} is saved for this browser session.`);
      setDirty(false);
      return true;
    }
    setState('saving');
    try {
      const saved = await api.saveStaff(selected);
      setStaff((current) => current.map((member) => member.id === selected.id ? saved : member));
      setSelectedId(saved.id);
      setState('ready');
      setDirty(false);
      onNotify(`${saved.displayName} was saved to Chime.`);
      await refreshAvailability();
      return true;
    } catch (error) {
      setState('error');
      onNotify(error instanceof AdminApiClientError ? error.message : 'This team member could not be saved.');
      return false;
    }
  }

  async function publishCustomerCalendar() {
    if (!api.configured) {
      onNotify('Connect the standalone admin API before publishing customer times.');
      return;
    }
    if (dirty && !await saveMember()) return;
    setCalendarState('publishing');
    try {
      const summary = await api.publishAvailability(30);
      setAvailability(summary);
      setCalendarState('ready');
      onNotify(`${summary.slotCount} customer times are now live for the next 30 days.`);
    } catch (error) {
      setCalendarState('error');
      onNotify(error instanceof Error ? error.message : 'The customer calendar could not be published.');
    }
  }

  async function addTimeOff() {
    if (!selected || selected.id.startsWith('draft-team-')) {
      onNotify('Save this team member before adding time off.');
      return;
    }
    if (timeOffStart > timeOffEnd) {
      onNotify('The end of time off must be on or after the start.');
      return;
    }
    try {
      const created = await api.createAvailabilityException(selected.id, {
        startDate: timeOffStart,
        endDate: timeOffEnd,
        reason: timeOffReason,
      });
      setExceptions((current) => [...current, created].sort((left, right) => left.startDate.localeCompare(right.startDate)));
      setTimeOffReason('');
      await refreshAvailability();
      onNotify(`Time off was added for ${selected.displayName}.`);
    } catch (error) {
      onNotify(error instanceof Error ? error.message : 'Time off could not be added.');
    }
  }

  async function removeTimeOff(exceptionId: string) {
    if (!selected) return;
    try {
      await api.deleteAvailabilityException(selected.id, exceptionId);
      setExceptions((current) => current.filter((entry) => entry.id !== exceptionId));
      await refreshAvailability();
      onNotify(`Time off was removed for ${selected.displayName}.`);
    } catch (error) {
      onNotify(error instanceof Error ? error.message : 'Time off could not be removed.');
    }
  }

  return (
    <section className="team-studio" aria-label="Team studio">
      <header className="team-studio__topbar">
        <div>
          <p>Business setup</p>
          <h1>Team</h1>
          <span>Set who can be booked, where they work, and when they are available.</span>
        </div>
        <div className="team-studio__actions">
          <span className="team-studio__status" data-state={state}>
            <i />
            {state === 'loading' ? 'Loading team' : state === 'saving' ? 'Saving changes' : state === 'error' ? 'Needs attention' : 'Saved to Chime'}
          </span>
          <button type="button" onClick={addMember}>+ Add team member</button>
        </div>
      </header>

      <div className="team-studio__stats" aria-label="Team overview">
        <article><small>Active team</small><strong>{activeCount}</strong><span>bookable people</span></article>
        <article><small>Locations covered</small><strong>{coverage}</strong><span>of {locations.length} spaces</span></article>
        <article><small>Selected schedule</small><strong>{scheduledDays}</strong><span>working days</span></article>
      </div>

      <section className="team-calendar" data-state={calendarState} aria-label="Customer calendar publication">
        <div className="team-calendar__heading">
          <div><small>Customer calendar</small><strong>{availability?.mode === 'published' ? 'Live and bookable' : 'Ready to preview'}</strong><span>{availability ? `${friendlyDate(availability.startsOn)} – ${friendlyDate(availability.endsOn)} · ${availability.timeZone}` : 'Calculating services, staff, and working hours'}</span></div>
          <button disabled={calendarState === 'publishing' || calendarState === 'previewing'} type="button" onClick={() => void publishCustomerCalendar()}>{calendarState === 'publishing' ? 'Publishing…' : dirty ? 'Save & publish 30 days' : 'Publish next 30 days'}</button>
        </div>
        <div className="team-calendar__metrics">
          <span><strong>{availability?.serviceCount ?? '—'}</strong> services</span>
          <span><strong>{availability?.slotCount ?? '—'}</strong> customer times</span>
          <span><strong>{availability?.candidateCount ?? '—'}</strong> staff options</span>
          <span><strong>{availability?.staffCount ?? '—'}</strong> active people</span>
        </div>
        {availability?.warnings.length ? <div className="team-calendar__warnings">{availability.warnings.slice(0, 3).map((warning) => <span key={warning}>{warning}</span>)}</div> : <p>Every live time is backed by a real service, working team member, and compatible location.</p>}
      </section>

      <div className="team-studio__workspace">
        <aside className="team-roster">
          <div className="team-roster__heading">
            <div><strong>Your team</strong><span>{staff.length} people</span></div>
            <button type="button" aria-label="Add team member" onClick={addMember}>+</button>
          </div>
          <label className="team-roster__search">
            <span>Search team</span>
            <input type="search" placeholder="Search by name" />
          </label>
          <div className="team-roster__list">
            {staff.map((member) => {
              const memberSettings = settingsFor(member);
              return (
                <button
                  className={member.id === selectedId ? 'is-active' : ''}
                  data-inactive={!member.isActive || undefined}
                  key={member.id}
                  type="button"
                  onClick={() => setSelectedId(member.id)}
                >
                  <i style={{ background: member.color ?? COLORS[0] }}>{initials(member.displayName)}</i>
                  <span><strong>{member.displayName}</strong><small>{memberSettings.role}</small></span>
                  <em>{member.isActive ? 'Active' : 'Off'}</em>
                </button>
              );
            })}
          </div>
        </aside>

        {selected && selectedSettings ? (
          <div className="team-editor">
            <div className="team-editor__heading">
              <div className="team-editor__identity">
                <i style={{ background: selected.color ?? COLORS[0] }}>{initials(selected.displayName)}</i>
                <div><span>Team member</span><h2>{selected.displayName}</h2></div>
              </div>
              <div><small>Version {selected.version}</small><button type="button" onClick={() => updateSelected({ isActive: !selected.isActive })}>{selected.isActive ? 'Deactivate' : 'Reactivate'}</button></div>
            </div>

            <fieldset className="team-editor__section">
              <legend>Profile</legend>
              <p>These details appear in internal schedules and service assignment controls.</p>
              <div className="team-editor__grid">
                <label><span>Full name</span><input value={selected.displayName} onChange={(event) => updateSelected({ displayName: event.target.value })} /></label>
                <label><span>Role or specialty</span><input value={selectedSettings.role} onChange={(event) => updateSettings({ role: event.target.value })} /></label>
                <label className="team-editor__wide"><span>Email</span><input type="email" value={selected.email ?? ''} onChange={(event) => updateSelected({ email: event.target.value })} /></label>
              </div>
              <div className="team-color-picker" aria-label="Team member color">
                <span>Calendar color</span>
                {COLORS.map((color) => <button aria-label={`Use color ${color}`} aria-pressed={selected.color === color} key={color} style={{ background: color }} type="button" onClick={() => updateSelected({ color })} />)}
              </div>
            </fieldset>

            <fieldset className="team-editor__section">
              <legend>Locations</legend>
              <p>Choose every place where this person can take appointments.</p>
              <div className="team-location-grid">
                {locations.map((location) => {
                  const assigned = selectedSettings.locationIds.includes(location.id);
                  return (
                    <button
                      aria-pressed={assigned}
                      key={location.id}
                      type="button"
                      onClick={() => updateSettings({ locationIds: assigned
                        ? selectedSettings.locationIds.filter((id) => id !== location.id)
                        : [...selectedSettings.locationIds, location.id] })}
                    >
                      <i>{location.name.slice(0, 2).toUpperCase()}</i>
                      <span><strong>{location.name}</strong><small>{location.timeZone}</small></span>
                      <em>{assigned ? 'Assigned' : 'Add'}</em>
                    </button>
                  );
                })}
              </div>
            </fieldset>

            <fieldset className="team-editor__section">
              <legend>Weekly working hours</legend>
              <p>These hours become the default boundaries for this person's bookable calendar.</p>
              <div className="team-hours">
                {DAYS.map(([key, label]) => {
                  const day = selectedSettings.workingHours[key];
                  return (
                    <div data-enabled={day.enabled || undefined} key={key}>
                      <button aria-pressed={day.enabled} type="button" onClick={() => updateSettings({ workingHours: { ...selectedSettings.workingHours, [key]: { ...day, enabled: !day.enabled } } })}><i />{label}</button>
                      {day.enabled ? <><input aria-label={`${label} start time`} type="time" value={day.start} onChange={(event) => updateSettings({ workingHours: { ...selectedSettings.workingHours, [key]: { ...day, start: event.target.value } } })} /><span>to</span><input aria-label={`${label} end time`} type="time" value={day.end} onChange={(event) => updateSettings({ workingHours: { ...selectedSettings.workingHours, [key]: { ...day, end: event.target.value } } })} /></> : <em>Not working</em>}
                    </div>
                  );
                })}
              </div>
            </fieldset>

            <fieldset className="team-editor__section">
              <legend>Time off & exceptions</legend>
              <p>Block a day or date range without changing this person's normal weekly hours.</p>
              <div className="team-time-off__form">
                <label><span>From</span><input type="date" value={timeOffStart} onChange={(event) => { setTimeOffStart(event.target.value); if (event.target.value > timeOffEnd) setTimeOffEnd(event.target.value); }} /></label>
                <label><span>Through</span><input min={timeOffStart} type="date" value={timeOffEnd} onChange={(event) => setTimeOffEnd(event.target.value)} /></label>
                <label><span>Note</span><input placeholder="Vacation, training…" value={timeOffReason} onChange={(event) => setTimeOffReason(event.target.value)} /></label>
                <button type="button" onClick={() => void addTimeOff()}>Add time off</button>
              </div>
              <div className="team-time-off__list">
                {exceptions.length ? exceptions.map((entry) => <article key={entry.id}><i /><span><strong>{friendlyDate(entry.startDate)}{entry.endDate !== entry.startDate ? ` – ${friendlyDate(entry.endDate)}` : ''}</strong><small>{entry.reason || 'Unavailable'}</small></span><button type="button" onClick={() => void removeTimeOff(entry.id)}>Remove</button></article>) : <span>No upcoming time off. Weekly hours will be used as shown above.</span>}
              </div>
            </fieldset>

            <div className="team-editor__footer">
              <span data-active={selected.isActive || undefined}><i />{selected.isActive ? 'Available for service assignments' : 'Hidden from new assignments'}</span>
              <button type="button" onClick={() => void saveMember()}>{dirty ? 'Save team member' : 'Saved'}</button>
            </div>
          </div>
        ) : (
          <div className="team-editor team-editor--empty"><strong>Add your first team member</strong><p>Create a profile, choose locations, and set working hours.</p><button type="button" onClick={addMember}>Add team member</button></div>
        )}
      </div>
    </section>
  );
}

export default TeamStudio;
