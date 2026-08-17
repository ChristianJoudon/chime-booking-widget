import { useMemo, useState, type ReactNode } from 'react';

import type { DepositMode, StaffId } from '../../packages/contracts/src';
import type { AdminPersistenceState } from './adminApi';
import { ServiceLocationPicker, useServiceStudioDirectory } from './serviceStudioDirectory';
import type {
  AdminServiceDefinition,
  ServiceGlyph,
} from './serviceTypes';
import './serviceStudio.css';

interface ServiceStudioProps {
  services: readonly AdminServiceDefinition[];
  onServicesChange: (services: AdminServiceDefinition[]) => void;
  onNotify: (message: string) => void;
  onSaveService: (service: AdminServiceDefinition) => Promise<AdminServiceDefinition>;
  persistence: AdminPersistenceState;
}

type StudioIconName =
  | ServiceGlyph
  | 'more'
  | 'search'
  | 'plus'
  | 'clock'
  | 'calendar'
  | 'people'
  | 'eye'
  | 'copy'
  | 'check'
  | 'phone'
  | 'desktop'
  | 'chevron';

const STUDIO_ICON_PATHS: Record<StudioIconName, ReactNode> = {
  chat: <><path d="M5 18.5 3.5 21l4.2-1.1A9 9 0 1 0 5 18.5Z" /><path d="M8 10h8M8 14h5" /></>,
  return: <><path d="m8 7-4 4 4 4" /><path d="M4 11h9a6 6 0 0 1 6 6" /></>,
  bolt: <path d="m13 2-8 12h7l-1 8 8-12h-7l1-8Z" />,
  sparkles: <><path d="m12 3 1.3 4.1L17 9l-3.7 1.9L12 15l-1.3-4.1L7 9l3.7-1.9L12 3Z" /><path d="m5 15 .8 2.2L8 18l-2.2.8L5 21l-.8-2.2L2 18l2.2-.8L5 15ZM19 3l.7 1.8L22 6l-2.3 1.2L19 9l-.7-1.8L16 6l2.3-1.2L19 3Z" /></>,
  search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  calendar: <><rect x="3" y="5" width="18" height="16" rx="3" /><path d="M16 3v4M8 3v4M3 10h18" /></>,
  people: <><circle cx="9" cy="8" r="3" /><path d="M3.5 19c.5-4 2.4-6 5.5-6s5 2 5.5 6" /><circle cx="17" cy="9" r="2.3" /></>,
  eye: <><path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" /><circle cx="12" cy="12" r="2.5" /></>,
  copy: <><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3" /></>,
  more: <><circle cx="5" cy="12" r="1.4" fill="currentColor" stroke="none" /><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" /><circle cx="19" cy="12" r="1.4" fill="currentColor" stroke="none" /></>,
  check: <path d="m5 12 4 4L19 6" />,
  phone: <><rect x="7" y="2" width="10" height="20" rx="2" /><path d="M11 18h2" /></>,
  desktop: <><rect x="2" y="4" width="20" height="14" rx="2" /><path d="M8 22h8M12 18v4" /></>,
  chevron: <path d="m9 18 6-6-6-6" />,
};

function StudioIcon({ name, size = 18 }: { name: StudioIconName; size?: number }) {
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
      strokeWidth="1.8"
    >
      {STUDIO_ICON_PATHS[name]}
    </svg>
  );
}

function moneyFromMinor(amountMinor: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(amountMinor / 100);
}

function durationLabel(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder ? `${hours}h ${remainder}m` : `${hours} hr`;
}

function serviceSlug(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function ServiceStudio({
  services,
  onServicesChange,
  onNotify,
  onSaveService,
  persistence,
}: ServiceStudioProps) {
  const { staff: serviceStudioStaff } = useServiceStudioDirectory();
  const [selectedId, setSelectedId] = useState(services[0]?.id ?? '');
  const [query, setQuery] = useState('');
  const [previewSize, setPreviewSize] = useState<'desktop' | 'phone'>('desktop');
  const [editorTab, setEditorTab] = useState<'essentials' | 'advanced'>('essentials');
  const [actionsOpen, setActionsOpen] = useState(false);

  const selectedService = services.find((service) => service.id === selectedId) ?? services[0];
  const filteredServices = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return services;
    return services.filter((service) =>
      service.name.toLowerCase().includes(normalizedQuery)
      || service.category.toLowerCase().includes(normalizedQuery),
    );
  }, [query, services]);

  const publicCount = services.filter((service) => service.isPublic && service.isActive).length;
  const averageDuration = services.length
    ? Math.round(services.reduce((sum, service) => sum + service.duration.defaultMinutes, 0) / services.length)
    : 0;
  const assignedStaff = new Set(services.flatMap((service) => service.staffIds)).size;

  if (!selectedService) return null;

  function updateSelected(patch: Partial<AdminServiceDefinition>) {
    onServicesChange(services.map((service) =>
      service.id === selectedService.id
        ? { ...service, ...patch }
        : service,
    ));
  }

  function updateDuration(
    field: keyof AdminServiceDefinition['duration'],
    value: number,
  ) {
    updateSelected({
      duration: { ...selectedService.duration, [field]: value },
    });
  }

  function updateBuffer(
    field: keyof AdminServiceDefinition['buffers'],
    value: number,
  ) {
    updateSelected({
      buffers: { ...selectedService.buffers, [field]: value },
    });
  }

  function updateBookingWindow(
    field: keyof AdminServiceDefinition['bookingWindow'],
    value: number,
  ) {
    updateSelected({
      bookingWindow: { ...selectedService.bookingWindow, [field]: value },
    });
  }

  function updateDeposit(mode: DepositMode) {
    updateSelected({
      deposit: {
        mode,
        currency: selectedService.currency,
        refundable: selectedService.deposit.refundable,
        fixedAmountMinor: mode === 'fixed'
          ? (selectedService.deposit.fixedAmountMinor ?? 2500)
          : undefined,
        percentage: mode === 'percentage'
          ? (selectedService.deposit.percentage ?? 25)
          : undefined,
      },
    });
  }

  function toggleStaff(staffId: StaffId) {
    const nextStaffIds = selectedService.staffIds.includes(staffId)
      ? selectedService.staffIds.filter((id) => id !== staffId)
      : [...selectedService.staffIds, staffId];
    updateSelected({ staffIds: nextStaffIds });
  }

  function createService() {
    const id = `draft-${Date.now()}`;
    const nextService: AdminServiceDefinition = {
      ...selectedService,
      id,
      name: 'Untitled service',
      slug: `untitled-${Date.now()}`,
      shortDescription: 'Add a short description customers can understand at a glance.',
      category: 'New service',
      tone: 'mint',
      glyph: 'sparkles',
      priceMinor: 0,
      deposit: { mode: 'none', currency: 'USD', refundable: true },
      isPublic: false,
      version: 1,
    };
    onServicesChange([...services, nextService]);
    setSelectedId(id);
    onNotify('New service draft created. It stays private until you publish it.');
  }

  function duplicateService() {
    const id = `draft-${Date.now()}`;
    const duplicate: AdminServiceDefinition = {
      ...selectedService,
      id,
      name: `${selectedService.name} copy`,
      slug: `${selectedService.slug}-copy`,
      isPublic: false,
      version: 1,
    };
    onServicesChange([...services, duplicate]);
    setSelectedId(id);
    onNotify('Service duplicated as a private draft.');
  }

  return (
    <section className="service-studio">
      <header className="admin-topbar service-studio__topbar">
        <div className="admin-topbar__title">
          <p>Business setup</p>
          <h1>Services</h1>
        </div>
        <div className="service-studio__top-actions">
          <span className="service-studio__saved" data-mode={persistence.mode} aria-live="polite"><i /><span>{persistence.label}</span></span>
          {/* The product already has enough appointment types, so neither of
              these is the primary action here — editing the selected service
              is. Add service is demoted to secondary and Duplicate moves into
              a menu, per the tightening plan. */}
          <button className="admin-secondary-button" type="button" onClick={createService}>
            <StudioIcon name="plus" size={17} />
            Add service
          </button>
          <div className="service-actions-menu">
            <button
              aria-expanded={actionsOpen}
              aria-haspopup="menu"
              aria-label="Service actions"
              className="service-actions-menu__trigger"
              onClick={() => setActionsOpen((open) => !open)}
              type="button"
            >
              <StudioIcon name="more" size={17} />
            </button>
            {actionsOpen ? (
              <div className="service-actions-menu__items" role="menu">
                <button
                  onClick={() => { setActionsOpen(false); duplicateService(); }}
                  role="menuitem"
                  type="button"
                >
                  <StudioIcon name="copy" size={15} />
                  Duplicate this service
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </header>

      <div className="service-studio__intro">
        <div>
          <span className="service-studio__eyebrow"><StudioIcon name="sparkles" size={15} /> Built for the way your business works</span>
          <h2>Shape every appointment without rewriting code.</h2>
          <p>Set the timing, people, payment, and approval rules once. Chime carries them into the calendar and customer widget.</p>
        </div>
        <div className="service-studio__strength">
          <div><span>Setup strength</span><strong>92%</strong></div>
          <i><b /></i>
          <small>All essential booking rules are covered.</small>
        </div>
      </div>

      <div className="service-studio__stats" aria-label="Service overview">
        <article><span><StudioIcon name="calendar" /></span><div><small>Appointment types</small><strong>{services.length} services</strong></div></article>
        <article><span><StudioIcon name="eye" /></span><div><small>Visible to customers</small><strong>{publicCount} published</strong></div></article>
        <article><span><StudioIcon name="clock" /></span><div><small>Average length</small><strong>{durationLabel(averageDuration)}</strong></div></article>
        <article><span><StudioIcon name="people" /></span><div><small>Team coverage</small><strong>{assignedStaff} people</strong></div></article>
      </div>

      <div className="service-studio__workspace">
        <aside className="service-catalog">
          <div className="service-catalog__header">
            <div><strong>Your services</strong><span>{services.length} total</span></div>
            <button type="button" aria-label="Create a service" onClick={createService}><StudioIcon name="plus" size={16} /></button>
          </div>
          <label className="service-catalog__search">
            <StudioIcon name="search" size={16} />
            <span className="admin-visually-hidden">Search services</span>
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search services" />
          </label>
          <div className="service-catalog__list">
            {filteredServices.map((service) => (
              <button
                className={service.id === selectedService.id ? 'is-active' : ''}
                data-tone={service.tone}
                type="button"
                key={service.id}
                onClick={() => setSelectedId(service.id)}
              >
                <span className="service-catalog__glyph"><StudioIcon name={service.glyph} size={17} /></span>
                <span>
                  <strong>{service.name}</strong>
                  <small>{durationLabel(service.duration.defaultMinutes)} <i /> {moneyFromMinor(service.priceMinor)}</small>
                </span>
                <em data-public={service.isPublic && service.isActive}>{service.isPublic && service.isActive ? 'Live' : 'Draft'}</em>
              </button>
            ))}
          </div>
          <div className="service-catalog__tip">
            <StudioIcon name="sparkles" size={16} />
            <p><strong>Keep names simple.</strong> Customers choose faster when each service answers one clear need.</p>
          </div>
        </aside>

        <form className="service-editor" onSubmit={(event) => {
          event.preventDefault();
          void onSaveService(selectedService).then((savedService) => {
            setSelectedId(savedService.id);
          });
        }}>
          <div className="service-editor__heading">
            <div>
              <span>Service details</span>
              <h2>{selectedService.name}</h2>
            </div>
            <span className="service-editor__version">Version {selectedService.version}</span>
          </div>

          {/* The plan splits this editor so a first-time setup is not met with
              resize increments and buffer rules. Essentials is everything needed
              to offer a service; Advanced is everything that tunes it. */}
          <div className="service-editor__tabs" role="tablist" aria-label="Service settings">
            <button
              aria-selected={editorTab === 'essentials'}
              className={editorTab === 'essentials' ? 'is-active' : ''}
              onClick={() => setEditorTab('essentials')}
              role="tab"
              type="button"
            >Essentials</button>
            <button
              aria-selected={editorTab === 'advanced'}
              className={editorTab === 'advanced' ? 'is-active' : ''}
              onClick={() => setEditorTab('advanced')}
              role="tab"
              type="button"
            >Advanced rules</button>
          </div>

          {editorTab === 'essentials' ? (
          <>
          <fieldset className="service-editor__section">
            <legend>Customer-facing details</legend>
            <p>Use everyday language so customers immediately know what to choose.</p>
            <div className="service-form-grid service-form-grid--two">
              <label className="service-field">
                <span>Service name</span>
                <input
                  value={selectedService.name}
                  onChange={(event) => updateSelected({
                    name: event.target.value,
                    slug: serviceSlug(event.target.value),
                  })}
                />
              </label>
              <label className="service-field">
                <span>Category</span>
                <input value={selectedService.category} onChange={(event) => updateSelected({ category: event.target.value })} />
              </label>
              <label className="service-field service-field--wide">
                <span>Short description</span>
                <textarea
                  rows={3}
                  maxLength={140}
                  value={selectedService.shortDescription ?? ''}
                  onChange={(event) => updateSelected({ shortDescription: event.target.value })}
                />
                <small>{selectedService.shortDescription?.length ?? 0}/140</small>
              </label>
            </div>
          </fieldset>

          <fieldset className="service-editor__section">
            <legend>Appointment length</legend>
            <p>How long a booking runs unless someone resizes it.</p>
            <div className="service-form-grid service-form-grid--four">
                <label className="service-field">
                  <span>Default length</span>
                  <select value={selectedService.duration.defaultMinutes} onChange={(event) => updateDuration('defaultMinutes', Number(event.target.value))}>
                    {[15, 30, 45, 60, 75, 90, 120, 180].map((value) => <option value={value} key={value}>{durationLabel(value)}</option>)}
                  </select>
                </label>
            </div>
            <div className="service-timing-visual">
              <span style={{ width: `${Math.max(24, selectedService.duration.minimumMinutes / selectedService.duration.maximumMinutes * 100)}%` }}>
                <i>Minimum {durationLabel(selectedService.duration.minimumMinutes)}</i>
                <b>Default {durationLabel(selectedService.duration.defaultMinutes)}</b>
              </span>
              <em>Resizable up to {durationLabel(selectedService.duration.maximumMinutes)}</em>
            </div>
          </fieldset>

          <fieldset className="service-editor__section">
            <legend>Price & payment</legend>
            <p>Deposits are optional by service. Paid bookings still require verified payment before Chime writes the booking.</p>
            <div className="service-form-grid service-form-grid--three">
              <label className="service-field">
                <span>Service price</span>
                <div className="service-money-input"><b>$</b><input type="number" min="0" step="1" value={selectedService.priceMinor / 100} onChange={(event) => updateSelected({ priceMinor: Math.max(0, Number(event.target.value) * 100) })} /></div>
              </label>
              <label className="service-field">
                <span>Deposit</span>
                <select value={selectedService.deposit.mode} onChange={(event) => updateDeposit(event.target.value as DepositMode)}>
                  <option value="none">No deposit</option>
                  <option value="fixed">Fixed amount</option>
                  <option value="percentage">Percentage</option>
                  <option value="full">Full payment</option>
                </select>
              </label>
              {selectedService.deposit.mode === 'fixed' ? (
                <label className="service-field">
                  <span>Deposit amount</span>
                  <div className="service-money-input"><b>$</b><input type="number" min="0" value={(selectedService.deposit.fixedAmountMinor ?? 0) / 100} onChange={(event) => updateSelected({ deposit: { ...selectedService.deposit, fixedAmountMinor: Number(event.target.value) * 100 } })} /></div>
                </label>
              ) : selectedService.deposit.mode === 'percentage' ? (
                <label className="service-field">
                  <span>Deposit percentage</span>
                  <div className="service-number-input"><input type="number" min="1" max="100" value={selectedService.deposit.percentage ?? 25} onChange={(event) => updateSelected({ deposit: { ...selectedService.deposit, percentage: Number(event.target.value) } })} /><b>%</b></div>
                </label>
              ) : (
                <div className="service-payment-summary"><span><StudioIcon name="check" size={15} /></span><p>{selectedService.deposit.mode === 'full' ? 'Full payment is collected before confirmation.' : 'Customers can book this service without prepayment.'}</p></div>
              )}
            </div>
          </fieldset>

          <fieldset className="service-editor__section">
            <legend>Who provides it, and where</legend>
            <p>Select who can provide this service and what happens after a customer requests it.</p>
              <div className="service-team-picker">
                {serviceStudioStaff.map((staff) => {
                  const isAssigned = selectedService.staffIds.includes(staff.id);
                  return (
                    <button className={isAssigned ? 'is-active' : ''} type="button" key={staff.id} onClick={() => toggleStaff(staff.id)}>
                      <i style={{ background: staff.color }}>{staff.initials}</i>
                      <span><strong>{staff.name}</strong><small>{isAssigned ? 'Assigned' : 'Not assigned'}</small></span>
                      <b>{isAssigned ? <StudioIcon name="check" size={14} /> : null}</b>
                    </button>
                  );
                })}
              </div>
              <ServiceLocationPicker
                service={selectedService}
                onChange={(locationIds) => updateSelected({ locationIds })}
              />
              <div className="service-choice-grid">
                <button
                  className={selectedService.confirmationMode === 'automatic' ? 'is-active' : ''}
                  type="button"
                  onClick={() => updateSelected({ confirmationMode: 'automatic' })}
                >
                  <span><StudioIcon name="check" size={16} /></span>
                  <strong>Confirm automatically</strong>
                  <small>Open times become confirmed bookings right away.</small>
                </button>
                <button
                  className={selectedService.confirmationMode === 'manual' ? 'is-active' : ''}
                  type="button"
                  onClick={() => updateSelected({ confirmationMode: 'manual' })}
                >
                  <span><StudioIcon name="eye" size={16} /></span>
                  <strong>Review each request</strong>
                  <small>Keep requests pending until someone approves them.</small>
                </button>
              </div>
          </fieldset>

          <fieldset className="service-editor__section service-editor__section--last">
            <legend>Availability</legend>
            <div className="service-toggle-row">
              <div><strong>Service is active</strong><span>Allow this appointment type to use availability and schedule rules.</span></div>
              <button aria-pressed={selectedService.isActive} className="service-switch" type="button" onClick={() => updateSelected({ isActive: !selectedService.isActive })}><i /></button>
            </div>
            <div className="service-toggle-row">
              <div><strong>Show in customer widget</strong><span>Customers can see and choose this service when it is published.</span></div>
              <button aria-pressed={selectedService.isPublic} className="service-switch" type="button" onClick={() => updateSelected({ isPublic: !selectedService.isPublic })}><i /></button>
            </div>
          </fieldset>
          </>
          ) : (
          <>
          <fieldset className="service-editor__section">
            <legend>Duration limits and buffers</legend>
            <p>How far an appointment can be resized, and the gap kept around it.</p>
            <div className="service-form-grid service-form-grid--four">
                <label className="service-field">
                  <span>Shortest</span>
                  <select value={selectedService.duration.minimumMinutes} onChange={(event) => updateDuration('minimumMinutes', Number(event.target.value))}>
                    {[15, 30, 45, 60, 90].map((value) => <option value={value} key={value}>{durationLabel(value)}</option>)}
                  </select>
                </label>
                <label className="service-field">
                  <span>Longest</span>
                  <select value={selectedService.duration.maximumMinutes} onChange={(event) => updateDuration('maximumMinutes', Number(event.target.value))}>
                    {[30, 45, 60, 90, 120, 180, 240].map((value) => <option value={value} key={value}>{durationLabel(value)}</option>)}
                  </select>
                </label>
                <label className="service-field">
                  <span>Resize steps</span>
                  <select value={selectedService.duration.incrementMinutes} onChange={(event) => updateDuration('incrementMinutes', Number(event.target.value))}>
                    {[5, 10, 15, 30].map((value) => <option value={value} key={value}>{value} min</option>)}
                  </select>
                </label>
              </div>
            <div className="service-form-grid service-form-grid--two service-form-grid--compact">
              <label className="service-field">
                <span>Buffer before</span>
                <div className="service-number-input"><input type="number" min="0" step="5" value={selectedService.buffers.beforeMinutes} onChange={(event) => updateBuffer('beforeMinutes', Number(event.target.value))} /><b>minutes</b></div>
              </label>
              <label className="service-field">
                <span>Buffer after</span>
                <div className="service-number-input"><input type="number" min="0" step="5" value={selectedService.buffers.afterMinutes} onChange={(event) => updateBuffer('afterMinutes', Number(event.target.value))} /><b>minutes</b></div>
              </label>
            </div>
          </fieldset>

          <fieldset className="service-editor__section">
            <legend>Booking window and changes</legend>
            <p>How far ahead customers can book, and who approves a change.</p>
            <div className="service-form-grid service-form-grid--three service-form-grid--spaced">
              <label className="service-field">
                <span>Schedule changes</span>
                <select value={selectedService.changeApprovalMode} onChange={(event) => updateSelected({ changeApprovalMode: event.target.value as AdminServiceDefinition['changeApprovalMode'] })}>
                  <option value="automatic">Apply automatically</option>
                  <option value="business">Business approves</option>
                  <option value="affected_staff">Assigned staff approves</option>
                  <option value="business_and_affected_staff">Business and staff approve</option>
                </select>
              </label>
              <label className="service-field">
                <span>Minimum notice</span>
                <select value={selectedService.bookingWindow.minimumNoticeMinutes} onChange={(event) => updateBookingWindow('minimumNoticeMinutes', Number(event.target.value))}>
                  <option value="0">No minimum</option>
                  <option value="30">30 minutes</option>
                  <option value="60">1 hour</option>
                  <option value="120">2 hours</option>
                  <option value="1440">1 day</option>
                  <option value="2880">2 days</option>
                </select>
              </label>
              <label className="service-field">
                <span>Book ahead</span>
                <select value={selectedService.bookingWindow.maximumAdvanceDays} onChange={(event) => updateBookingWindow('maximumAdvanceDays', Number(event.target.value))}>
                  <option value="30">30 days</option>
                  <option value="45">45 days</option>
                  <option value="60">60 days</option>
                  <option value="90">90 days</option>
                  <option value="180">6 months</option>
                </select>
              </label>
            </div>
          </fieldset>

          <fieldset className="service-editor__section service-editor__section--last">
            <legend>Capacity</legend>
            <p>How many customers can share one start time.</p>
              <label className="service-field service-capacity-field">
                <span>Capacity per start time</span>
                <div className="service-stepper">
                  <button type="button" aria-label="Reduce capacity" onClick={() => updateSelected({ capacity: Math.max(1, selectedService.capacity - 1) })}>-</button>
                  <strong>{selectedService.capacity}</strong>
                  <button type="button" aria-label="Increase capacity" onClick={() => updateSelected({ capacity: selectedService.capacity + 1 })}>+</button>
                </div>
                <small>{selectedService.capacity === 1 ? 'One customer per appointment' : `Up to ${selectedService.capacity} customers at the same time`}</small>
              </label>
          </fieldset>
          </>
          )}

          <div className="service-editor__footer">
            <div><span><StudioIcon name="check" size={15} /></span><p><strong>Ready to use</strong><small>All required service rules are complete.</small></p></div>
            <button className="admin-primary-button" type="submit" disabled={persistence.mode === 'saving'}>
              {persistence.mode === 'saving' ? 'Saving...' : 'Save service'}
            </button>
          </div>
        </form>

        <aside className="service-preview">
          <div className="service-preview__header">
            <div><strong>Customer preview</strong><span>Updates as you type</span></div>
            <div className="service-preview__sizes">
              <button className={previewSize === 'desktop' ? 'is-active' : ''} type="button" aria-label="Desktop preview" onClick={() => setPreviewSize('desktop')}><StudioIcon name="desktop" size={15} /></button>
              <button className={previewSize === 'phone' ? 'is-active' : ''} type="button" aria-label="Phone preview" onClick={() => setPreviewSize('phone')}><StudioIcon name="phone" size={15} /></button>
            </div>
          </div>
          <div className="service-preview__canvas" data-size={previewSize}>
            <div className="service-preview__widget">
              <div className="service-preview__brand"><span>chime</span><small>Book your visit</small></div>
              <div className="service-preview__steps"><i className="is-active">1</i><span /><i>2</i><span /><i>3</i></div>
              <p>Choose a service</p>
              <article data-tone={selectedService.tone}>
                <span><StudioIcon name={selectedService.glyph} size={22} /></span>
                <div>
                  <strong>{selectedService.name || 'Untitled service'}</strong>
                  <p>{selectedService.shortDescription || 'Add a description to help customers choose.'}</p>
                  <small><b><StudioIcon name="clock" size={13} /> {durationLabel(selectedService.duration.defaultMinutes)}</b><b>{moneyFromMinor(selectedService.priceMinor)}</b></small>
                </div>
                <i><StudioIcon name="chevron" size={16} /></i>
              </article>
              <button type="button" onClick={() => onNotify('Preview only. The customer flow stays service, date/time, terms, details, payment when required, then confirmation.')}>Continue</button>
            </div>
          </div>
          <div className="service-preview__note">
            <StudioIcon name="eye" size={16} />
            <p>The preview never shows internal buffers, approval rules, or staff notes to customers.</p>
          </div>
        </aside>
      </div>
    </section>
  );
}

export default ServiceStudio;
