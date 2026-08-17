import { useCallback, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import type {
  AdminApiClient,
  AdminDuplicateGroup,
  AdminDuplicateMember,
  CustomerAppointment,
  CustomerChangeRequest,
  CustomerCommunication,
  CustomerDirectoryEntry,
  CustomerLifecycleStatus,
  CustomerNote,
  CustomerProfileResponse,
  CustomerTag,
} from './adminApi';
import { useActionPreview } from './actionPreview';
import './customerStudio.css';

type CustomerStudioProps = {
  api: AdminApiClient;
  onNotify: (message: string) => void;
};

type CustomerDraft = {
  displayName: string;
  email: string;
  phone: string;
  lifecycleStatus: CustomerLifecycleStatus;
  preferredChannel: 'email' | 'sms' | 'none';
  emailNotificationsEnabled: boolean;
  smsNotificationsEnabled: boolean;
  marketingConsent: boolean;
};

type TimelineEntry = {
  id: string;
  kind: 'appointment' | 'message' | 'note' | 'change';
  occurredAt: string;
  title: string;
  description: string;
  status?: string;
};

const emptyDraft: CustomerDraft = {
  displayName: '',
  email: '',
  phone: '',
  lifecycleStatus: 'active',
  preferredChannel: 'email',
  emailNotificationsEnabled: true,
  smsNotificationsEnabled: true,
  marketingConsent: false,
};

const initials = (name: string) => name
  .split(/\s+/)
  .filter(Boolean)
  .slice(0, 2)
  .map((part) => part[0]?.toUpperCase())
  .join('') || 'CU';

const friendlyDate = (value?: string | null, withTime = true) => {
  if (!value) return 'Not yet';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) return 'Not yet';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: parsed.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined,
    hour: withTime ? 'numeric' : undefined,
    minute: withTime ? '2-digit' : undefined,
  }).format(parsed);
};

const statusLabel = (status: string) => status
  .split('_')
  .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
  .join(' ');

const Icon = ({ children, size = 18 }: { children: ReactNode; size?: number }) => (
  <svg aria-hidden="true" fill="none" height={size} viewBox="0 0 24 24" width={size}>
    <g stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8">{children}</g>
  </svg>
);

const customerToDraft = (customer: CustomerDirectoryEntry): CustomerDraft => ({
  displayName: customer.displayName,
  email: customer.email ?? '',
  phone: customer.phone ?? '',
  lifecycleStatus: customer.lifecycleStatus,
  preferredChannel: customer.preferredChannel,
  emailNotificationsEnabled: customer.emailNotificationsEnabled,
  smsNotificationsEnabled: customer.smsNotificationsEnabled,
  marketingConsent: customer.marketingConsent,
});

const appointmentEntry = (appointment: CustomerAppointment): TimelineEntry => ({
  id: `appointment-${appointment.id}`,
  kind: 'appointment',
  occurredAt: appointment.startsAt,
  title: appointment.serviceName,
  description: `${friendlyDate(appointment.startsAt)}${appointment.staff.length ? ` with ${appointment.staff.map((staff) => staff.displayName).join(', ')}` : ''}${appointment.locationName ? ` at ${appointment.locationName}` : ''}`,
  status: appointment.status,
});

const communicationEntry = (communication: CustomerCommunication): TimelineEntry => ({
  id: `message-${communication.id}`,
  kind: 'message',
  occurredAt: communication.sentAt ?? communication.completedAt ?? communication.createdAt,
  title: `${communication.channel === 'sms' ? 'Text' : 'Email'}: ${statusLabel(communication.templateKey)}`,
  description: communication.lastError || `${statusLabel(communication.status)} to ${communication.recipient}`,
  status: communication.status,
});

const noteEntry = (note: CustomerNote): TimelineEntry => ({
  id: `note-${note.id}`,
  kind: 'note',
  occurredAt: note.createdAt,
  title: note.isPinned ? 'Pinned team note' : 'Team note',
  description: note.body,
});

const changeEntry = (change: CustomerChangeRequest): TimelineEntry => ({
  id: `change-${change.id}`,
  kind: 'change',
  occurredAt: change.createdAt,
  title: `Appointment change ${statusLabel(change.status).toLowerCase()}`,
  description: change.reason || `Request for ${change.referenceCode}`,
  status: change.status,
});

export function CustomerStudio({ api, onNotify }: CustomerStudioProps) {
  const [customers, setCustomers] = useState<CustomerDirectoryEntry[]>([]);
  const [tags, setTags] = useState<CustomerTag[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [duplicates, setDuplicates] = useState<AdminDuplicateGroup[]>([]);
  const { confirm: confirmAction, element: previewElement } = useActionPreview();
  const [profile, setProfile] = useState<CustomerProfileResponse | null>(null);
  const [draft, setDraft] = useState<CustomerDraft>(emptyDraft);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [tagFilter, setTagFilter] = useState('');
  const [noteBody, setNoteBody] = useState('');
  const [newTagName, setNewTagName] = useState('');
  const [newTagColor, setNewTagColor] = useState('#5f927f');
  const [showNewCustomer, setShowNewCustomer] = useState(false);
  const [newCustomer, setNewCustomer] = useState({ displayName: '', email: '', phone: '' });
  const [loading, setLoading] = useState(true);
  const [profileLoading, setProfileLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const loadDuplicates = useCallback(async () => {
    if (!api.configured) return;
    try {
      const { groups } = await api.getCustomerDuplicates();
      setDuplicates(groups);
    } catch {
      // A failed duplicate scan must not take the directory down with it: the
      // customer book is still usable without the suggestion.
      setDuplicates([]);
    }
  }, [api]);

  /** Merges `loser` into `keeper`, after showing what will move. */
  const mergeInto = useCallback(async (
    keeper: AdminDuplicateMember,
    loser: AdminDuplicateMember,
  ) => {
    const preview = await confirmAction({
      title: `Keep ${keeper.displayName.trim() || 'this profile'}`,
      summary: `Everything belonging to ${loser.displayName.trim() || 'the other profile'} moves onto this one, and the other profile stops existing.`,
      changes: [
        {
          label: 'Appointments on the kept profile',
          before: String(keeper.appointmentCount),
          after: String(keeper.appointmentCount + loser.appointmentCount),
        },
        { label: 'Profile removed', after: loser.displayName.trim() || loser.email || loser.id },
      ],
      notifies: null,
      paymentEffect: null,
      reversible: {
        kind: 'permanent',
        detail: 'No — the duplicate record cannot be brought back. Its history is preserved on the profile you keep.',
      },
      confirmLabel: 'Merge the profiles',
      tone: 'caution',
    });
    if (!preview.confirmed) return;

    try {
      await api.mergeCustomer(keeper.id, loser.id);
      onNotify(`Merged into ${keeper.displayName.trim() || 'the kept profile'}.`);
      await loadDirectory(keeper.id);
      await loadDuplicates();
    } catch (mergeError) {
      setError(mergeError instanceof Error ? mergeError.message : 'The profiles could not be merged.');
    }
    // loadDirectory is defined below; referencing it here is safe because this
    // callback only runs from a click, long after both exist.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, confirmAction, loadDuplicates, onNotify]);

  const loadDirectory = useCallback(async (preferredId?: string) => {
    setLoading(true);
    setError('');
    try {
      const [directory, tagResult] = await Promise.all([
        api.getCustomers({ search, status: statusFilter, tagId: tagFilter }),
        api.getCustomerTags(),
      ]);
      setCustomers(directory.customers);
      setTags(tagResult.tags);
      setSelectedId((current) => {
        const candidate = preferredId ?? current;
        return candidate && directory.customers.some((customer) => customer.id === candidate)
          ? candidate
          : directory.customers[0]?.id ?? null;
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Customer directory could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [api, search, statusFilter, tagFilter]);

  const loadProfile = useCallback(async (customerId: string) => {
    setProfileLoading(true);
    setError('');
    try {
      const result = await api.getCustomer(customerId);
      setProfile(result);
      setDraft(customerToDraft(result.customer));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Customer profile could not be loaded.');
    } finally {
      setProfileLoading(false);
    }
  }, [api]);

  useEffect(() => {
    const timeout = window.setTimeout(() => { void loadDirectory(); }, 180);
    return () => window.clearTimeout(timeout);
  }, [loadDirectory]);

  useEffect(() => {
    if (selectedId) void loadProfile(selectedId);
    else setProfile(null);
  }, [loadProfile, selectedId]);

  // Scanned once when the workspace opens, and again after a merge. It is a
  // suggestion rather than something the directory depends on, so it does not
  // participate in the search-debounced reload above.
  useEffect(() => {
    void loadDuplicates();
  }, [loadDuplicates]);

  const totals = useMemo(() => ({
    all: customers.length,
    upcoming: customers.filter((customer) => customer.upcomingAppointmentCount > 0).length,
    vip: customers.filter((customer) => customer.lifecycleStatus === 'vip').length,
    followUp: customers.filter((customer) => customer.lifecycleStatus === 'watchlist').length,
  }), [customers]);

  const timeline = useMemo(() => {
    if (!profile) return [];
    return [
      ...profile.appointments.map(appointmentEntry),
      ...profile.communications.map(communicationEntry),
      ...profile.notes.map(noteEntry),
      ...profile.changeRequests.map(changeEntry),
    ].sort((left, right) => new Date(right.occurredAt).valueOf() - new Date(left.occurredAt).valueOf());
  }, [profile]);

  const refreshSelected = async () => {
    if (!selectedId) return;
    await Promise.all([loadProfile(selectedId), loadDirectory(selectedId)]);
  };

  const saveCustomer = async () => {
    if (!profile) return;
    setSaving(true);
    setError('');
    try {
      await api.updateCustomer(profile.customer.id, profile.customer.version, draft);
      await refreshSelected();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Customer changes could not be saved.');
    } finally {
      setSaving(false);
    }
  };

  const createCustomer = async () => {
    setSaving(true);
    setError('');
    try {
      const result = await api.createCustomer(newCustomer);
      setNewCustomer({ displayName: '', email: '', phone: '' });
      setShowNewCustomer(false);
      await loadDirectory(result.customer.id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Customer could not be created.');
    } finally {
      setSaving(false);
    }
  };

  const toggleTag = async (tagId: string) => {
    if (!profile) return;
    const currentIds = profile.customer.tags.map((tag) => tag.id);
    const nextIds = currentIds.includes(tagId)
      ? currentIds.filter((id) => id !== tagId)
      : [...currentIds, tagId];
    setSaving(true);
    try {
      await api.setCustomerTags(profile.customer.id, nextIds);
      await refreshSelected();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Customer tags could not be changed.');
    } finally {
      setSaving(false);
    }
  };

  const createTag = async () => {
    if (!newTagName.trim()) return;
    setSaving(true);
    try {
      const result = await api.createCustomerTag({ name: newTagName, color: newTagColor });
      setNewTagName('');
      setTags((current) => current.some((tag) => tag.id === result.tag.id) ? current : [...current, result.tag]);
      if (profile) await api.setCustomerTags(profile.customer.id, [...profile.customer.tags.map((tag) => tag.id), result.tag.id]);
      await refreshSelected();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Tag could not be created.');
    } finally {
      setSaving(false);
    }
  };

  const addNote = async () => {
    if (!profile || !noteBody.trim()) return;
    setSaving(true);
    try {
      await api.addCustomerNote(profile.customer.id, { body: noteBody, isPinned: false });
      setNoteBody('');
      await loadProfile(profile.customer.id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Note could not be added.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="customer-studio" aria-labelledby="customer-studio-title">
      <header className="customer-studio__header">
        <div>
          {/* No kicker above the title here: this screen and the navigation
              area it lives in are both called Customers, and repeating it
              reads as a mistake rather than as a location. */}
          <h1 id="customer-studio-title">Customers</h1>
          <span>Know the person, not just the appointment. Preferences, visits, and conversations stay together so every interaction feels familiar.</span>
        </div>
        <button className="customer-primary-action" type="button" onClick={() => setShowNewCustomer((visible) => !visible)}>
          <Icon><path d="M12 5v14M5 12h14" /></Icon>
          Add customer
        </button>
      </header>

      {showNewCustomer ? (
        <form className="customer-quick-create" onSubmit={(event) => { event.preventDefault(); void createCustomer(); }}>
          <div>
            <strong>New customer</strong>
            <span>Add the basics now. Preferences and notes can be shaped inside their profile.</span>
          </div>
          <label>Name<input required value={newCustomer.displayName} onChange={(event) => setNewCustomer((current) => ({ ...current, displayName: event.target.value }))} /></label>
          <label>Email<input type="email" value={newCustomer.email} onChange={(event) => setNewCustomer((current) => ({ ...current, email: event.target.value }))} /></label>
          <label>Phone<input value={newCustomer.phone} onChange={(event) => setNewCustomer((current) => ({ ...current, phone: event.target.value }))} /></label>
          <button disabled={saving || !newCustomer.displayName.trim() || (!newCustomer.email.trim() && !newCustomer.phone.trim())} type="submit">Create profile</button>
        </form>
      ) : null}

      {error ? <div className="customer-studio__error" role="alert">{error}</div> : null}

      {duplicates.length ? (
        <div className="customer-duplicates" role="status">
          <strong>
            {duplicates.length === 1
              ? 'One person may have two profiles'
              : `${duplicates.length} people may have more than one profile`}
          </strong>
          <p>
            These records share an email address or phone number. Merging moves all
            appointments, notes and tags onto the profile you keep, and takes the more
            restrictive consent of the two.
          </p>
          {duplicates.map((group) => (
            <div className="customer-duplicates__group" key={`${group.matchKind}:${group.matchValue}`}>
              <span>Same {group.matchKind}: <code>{group.matchValue}</code></span>
              <ul>
                {group.members.map((member) => (
                  <li key={member.id}>
                    <span>
                      <strong>{member.displayName.trim() || '(no name)'}</strong>
                      <small>
                        {member.appointmentCount} appointment{member.appointmentCount === 1 ? '' : 's'}
                        {member.email ? ` · ${member.email}` : ''}
                      </small>
                    </span>
                    {group.members.length === 2 ? (
                      <button
                        onClick={() => void mergeInto(member, group.members.find((other) => other.id !== member.id)!)}
                        type="button"
                      >
                        Keep this one
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      ) : null}

      <div className="customer-metrics" aria-label="Customer summary">
        <article><span>Directory</span><strong>{totals.all}</strong><small>customer profiles</small></article>
        <article><span>Coming up</span><strong>{totals.upcoming}</strong><small>with future visits</small></article>
        <article><span>VIP care</span><strong>{totals.vip}</strong><small>priority relationships</small></article>
        <article><span>Follow-up</span><strong>{totals.followUp}</strong><small>need a personal touch</small></article>
      </div>

      <div className="customer-workspace">
        <aside className="customer-directory">
          <div className="customer-directory__heading">
            <div><p>Customer book</p><h2>People</h2></div>
            <button aria-label="Refresh customers" type="button" onClick={() => void loadDirectory()}>
              <Icon size={16}><path d="M20 7v5h-5" /><path d="M4 17v-5h5" /><path d="M6.1 8a7 7 0 0 1 11.4-2L20 8M4 16l2.5 2a7 7 0 0 0 11.4-2" /></Icon>
            </button>
          </div>
          <label className="customer-search">
            <Icon size={16}><circle cx="11" cy="11" r="6" /><path d="m16 16 4 4" /></Icon>
            <input aria-label="Search customers" placeholder="Search name, email, or phone" value={search} onChange={(event) => setSearch(event.target.value)} />
          </label>
          <div className="customer-filters">
            <select aria-label="Filter customer status" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
              <option value="">Every status</option>
              <option value="active">Active</option>
              <option value="vip">VIP</option>
              <option value="watchlist">Follow-up</option>
              <option value="blocked">Blocked</option>
              <option value="archived">Archived</option>
            </select>
            <select aria-label="Filter customer tag" value={tagFilter} onChange={(event) => setTagFilter(event.target.value)}>
              <option value="">Every tag</option>
              {tags.map((tag) => <option key={tag.id} value={tag.id}>{tag.name}</option>)}
            </select>
          </div>
          <div className="customer-directory__list">
            {loading ? <p className="customer-empty">Loading the customer book...</p> : null}
            {!loading && !customers.length ? <p className="customer-empty">No customers match these filters yet.</p> : null}
            {customers.map((customer) => (
              <button
                className={customer.id === selectedId ? 'is-active' : ''}
                key={customer.id}
                type="button"
                onClick={() => setSelectedId(customer.id)}
              >
                <span className={`customer-avatar is-${customer.lifecycleStatus}`}>{initials(customer.displayName)}</span>
                <span className="customer-directory__identity">
                  <strong>{customer.displayName}</strong>
                  <small>{customer.nextAppointmentAt ? `Next ${friendlyDate(customer.nextAppointmentAt, false)}` : customer.email || customer.phone || 'No contact details'}</small>
                  <span>{customer.tags.slice(0, 2).map((tag) => <i key={tag.id} style={{ '--tag-color': tag.color } as CSSProperties}>{tag.name}</i>)}</span>
                </span>
                <em>{customer.appointmentCount}</em>
              </button>
            ))}
          </div>
        </aside>

        <section aria-label="Customer profile" className="customer-profile">
          {profileLoading ? <p className="customer-empty">Opening customer profile...</p> : null}
          {!profileLoading && !profile ? (
            <div className="customer-profile__blank">
              <Icon size={32}><path d="M20 21a8 8 0 0 0-16 0" /><circle cx="12" cy="7" r="4" /></Icon>
              <strong>Select a customer</strong>
              <p>Their preferences, appointments, notes, and messages will come together here.</p>
            </div>
          ) : null}
          {!profileLoading && profile ? (
            <>
              <div className="customer-profile__masthead">
                <span className={`customer-avatar customer-avatar--large is-${profile.customer.lifecycleStatus}`}>{initials(profile.customer.displayName)}</span>
                <div>
                  <span className={`customer-lifecycle is-${profile.customer.lifecycleStatus}`}>{statusLabel(profile.customer.lifecycleStatus)}</span>
                  <h2>{profile.customer.displayName}</h2>
                  <p>{profile.customer.email || 'No email'} <i /> {profile.customer.phone || 'No phone'}</p>
                </div>
                <button disabled={saving} type="button" onClick={() => void saveCustomer()}>{saving ? 'Saving...' : 'Save profile'}</button>
              </div>

              <div className="customer-profile__grid">
                <section className="customer-panel customer-panel--details">
                  <div className="customer-panel__heading"><p>Profile controls</p><h3>How to care for this customer</h3></div>
                  <div className="customer-form-grid">
                    <label>Display name<input value={draft.displayName} onChange={(event) => setDraft((current) => ({ ...current, displayName: event.target.value }))} /></label>
                    <label>Relationship
                      <select value={draft.lifecycleStatus} onChange={(event) => setDraft((current) => ({ ...current, lifecycleStatus: event.target.value as CustomerLifecycleStatus }))}>
                        <option value="active">Active</option><option value="vip">VIP</option><option value="watchlist">Needs follow-up</option><option value="blocked">Blocked</option><option value="archived">Archived</option>
                      </select>
                    </label>
                    <label>Email<input type="email" value={draft.email} onChange={(event) => setDraft((current) => ({ ...current, email: event.target.value }))} /></label>
                    <label>Phone<input value={draft.phone} onChange={(event) => setDraft((current) => ({ ...current, phone: event.target.value }))} /></label>
                    <label>Preferred contact
                      <select value={draft.preferredChannel} onChange={(event) => setDraft((current) => ({ ...current, preferredChannel: event.target.value as CustomerDraft['preferredChannel'] }))}>
                        <option value="email">Email</option><option value="sms">Text message</option><option value="none">No preference</option>
                      </select>
                    </label>
                  </div>
                  <div className="customer-preferences">
                    <label><input checked={draft.emailNotificationsEnabled} type="checkbox" onChange={(event) => setDraft((current) => ({ ...current, emailNotificationsEnabled: event.target.checked }))} /><span><i />Email appointment updates</span></label>
                    <label><input checked={draft.smsNotificationsEnabled} type="checkbox" onChange={(event) => setDraft((current) => ({ ...current, smsNotificationsEnabled: event.target.checked }))} /><span><i />Text appointment updates</span></label>
                    <label><input checked={draft.marketingConsent} type="checkbox" onChange={(event) => setDraft((current) => ({ ...current, marketingConsent: event.target.checked }))} /><span><i />Marketing permission</span></label>
                  </div>
                  <small className="customer-preference-note">Turning off appointment updates stops queued messages for that channel. Blocking or archiving pauses both.</small>
                </section>

                <section className="customer-panel customer-panel--visits">
                  <div className="customer-panel__heading"><p>Visit rhythm</p><h3>Appointments at a glance</h3></div>
                  <div className="customer-visit-stats">
                    <article><strong>{profile.customer.upcomingAppointmentCount}</strong><span>coming up</span></article>
                    <article><strong>{profile.customer.completedAppointmentCount}</strong><span>completed</span></article>
                    <article><strong>{profile.customer.appointmentCount}</strong><span>total visits</span></article>
                  </div>
                  {profile.appointments.length ? profile.appointments.slice(0, 3).map((appointment) => (
                    <div className="customer-next-visit" key={appointment.id}>
                      <span><Icon size={17}><rect x="3" y="5" width="18" height="16" rx="3" /><path d="M8 3v4M16 3v4M3 10h18" /></Icon></span>
                      <div><strong>{appointment.serviceName}</strong><small>{friendlyDate(appointment.startsAt)} {appointment.staff[0] ? `with ${appointment.staff[0].displayName}` : ''}</small></div>
                      <em className={`is-${appointment.status}`}>{statusLabel(appointment.status)}</em>
                    </div>
                  )) : <p className="customer-empty customer-empty--compact">No appointments are attached yet.</p>}
                </section>

                <section className="customer-panel customer-panel--tags">
                  <div className="customer-panel__heading"><p>At-a-glance context</p><h3>Tags</h3></div>
                  <div className="customer-tag-picker">
                    {tags.map((tag) => {
                      const active = profile.customer.tags.some((assigned) => assigned.id === tag.id);
                      return <button className={active ? 'is-active' : ''} key={tag.id} style={{ '--tag-color': tag.color } as CSSProperties} type="button" onClick={() => void toggleTag(tag.id)}><i />{tag.name}</button>;
                    })}
                  </div>
                  <div className="customer-new-tag">
                    <input aria-label="New tag color" type="color" value={newTagColor} onChange={(event) => setNewTagColor(event.target.value)} />
                    <input aria-label="New tag name" placeholder="Create a tag" value={newTagName} onChange={(event) => setNewTagName(event.target.value)} />
                    <button disabled={!newTagName.trim() || saving} type="button" onClick={() => void createTag()}>Add tag</button>
                  </div>
                </section>

                <section className="customer-panel customer-panel--notes">
                  <div className="customer-panel__heading"><p>Private to the team</p><h3>Staff notes</h3></div>
                  <textarea placeholder="Remember a preference, follow-up, or helpful detail..." value={noteBody} onChange={(event) => setNoteBody(event.target.value)} />
                  <button disabled={!noteBody.trim() || saving} type="button" onClick={() => void addNote()}>Add note</button>
                  <div className="customer-note-list">
                    {profile.notes.slice(0, 3).map((note) => <article key={note.id}><p>{note.body}</p><span>{statusLabel(note.createdByRole)} <i /> {friendlyDate(note.createdAt)}</span></article>)}
                  </div>
                </section>
              </div>

              <section className="customer-timeline">
                <div className="customer-panel__heading"><p>One shared history</p><h3>Visits, requests, notes, and messages</h3></div>
                <div className="customer-timeline__list">
                  {timeline.length ? timeline.map((entry) => (
                    <article key={entry.id}>
                      <span className={`is-${entry.kind}`}>
                        {entry.kind === 'appointment' ? <Icon><rect x="3" y="5" width="18" height="16" rx="3" /><path d="M8 3v4M16 3v4M3 10h18" /></Icon> : null}
                        {entry.kind === 'message' ? <Icon><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m4 7 8 6 8-6" /></Icon> : null}
                        {entry.kind === 'note' ? <Icon><path d="M5 4h14v16H5zM8 8h8M8 12h8M8 16h5" /></Icon> : null}
                        {entry.kind === 'change' ? <Icon><path d="M4 7h11M12 4l3 3-3 3M20 17H9M12 14l-3 3 3 3" /></Icon> : null}
                      </span>
                      <div><strong>{entry.title}</strong><p>{entry.description}</p><small>{friendlyDate(entry.occurredAt)}</small></div>
                      {entry.status ? <em className={`is-${entry.status}`}>{statusLabel(entry.status)}</em> : null}
                    </article>
                  )) : <p className="customer-empty">Their shared history will build naturally as appointments and conversations happen.</p>}
                </div>
              </section>
            </>
          ) : null}
        </section>
      </div>
      {previewElement}
    </section>
  );
}
