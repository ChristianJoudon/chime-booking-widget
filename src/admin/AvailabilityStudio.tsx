import {
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react';
import {
  AdminApiClientError,
  type AdminApiClient,
  type AdminAvailabilityBlock,
  type AdminAvailabilityException,
  type AdminAvailabilitySchedule,
  type AdminAvailabilitySummary,
} from './adminApi';
import './availabilityStudio.css';
import { useActionPreview } from './actionPreview';

interface AvailabilityStudioProps {
  api: AdminApiClient;
  onNotify: (message: string) => void;
}

interface DragState {
  dayOfWeek: number;
  blockId: string;
  mode: 'move' | 'start' | 'end';
  originY: number;
  originalStart: number;
  originalEnd: number;
}

const DISPLAY_DAYS = [1, 2, 3, 4, 5, 6, 0];
const GRID_START = 6 * 60;
const GRID_END = 22 * 60;
const GRID_MINUTES = GRID_END - GRID_START;
const GRID_HEIGHT = 512;
const STEP = 15;
const HOURS = Array.from({ length: 17 }, (_, index) => GRID_START + index * 60);

const Icon = ({ children, size = 18 }: { children: ReactNode; size?: number }) => (
  <svg aria-hidden="true" fill="none" height={size} viewBox="0 0 24 24" width={size}>
    <g stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8">{children}</g>
  </svg>
);

const minutes = (value: string) => {
  const [hours, mins] = value.split(':').map(Number);
  return hours * 60 + mins;
};

const time = (value: number) => `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;

const friendlyTime = (value: string) => {
  const [hours, mins] = value.split(':').map(Number);
  const suffix = hours >= 12 ? 'PM' : 'AM';
  const displayHour = hours % 12 || 12;
  return `${displayHour}:${String(mins).padStart(2, '0')} ${suffix}`;
};

const friendlyDate = (value: string) => new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
}).format(new Date(`${value}T12:00:00`));

const today = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
};

const cloneSchedule = (schedule: AdminAvailabilitySchedule): AdminAvailabilitySchedule => ({
  ...schedule,
  days: schedule.days.map((day) => ({ ...day, blocks: day.blocks.map((block) => ({ ...block })) })),
});

const newBlockId = () => `block-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

const durationLabel = (blocks: AdminAvailabilityBlock[]) => {
  const total = blocks.reduce((sum, block) => sum + minutes(block.end) - minutes(block.start), 0);
  const hours = Math.floor(total / 60);
  const mins = total % 60;
  return `${hours ? `${hours}h` : ''}${hours && mins ? ' ' : ''}${mins ? `${mins}m` : ''}` || 'Off';
};

function AvailabilityStudio({ api, onNotify }: AvailabilityStudioProps) {
  const [schedules, setSchedules] = useState<AdminAvailabilitySchedule[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [draft, setDraft] = useState<AdminAvailabilitySchedule | null>(null);
  const [summary, setSummary] = useState<AdminAvailabilitySummary | null>(null);
  const [exceptions, setExceptions] = useState<AdminAvailabilityException[]>([]);
  const [selectedBlock, setSelectedBlock] = useState<{ dayOfWeek: number; blockId: string } | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [dirty, setDirty] = useState(false);
  const [state, setState] = useState<'loading' | 'ready' | 'saving' | 'publishing' | 'error'>('loading');
  const { confirm: confirmAction, element: previewElement } = useActionPreview();
  const [timeOffStart, setTimeOffStart] = useState(today);
  const [timeOffEnd, setTimeOffEnd] = useState(today);
  const [timeOffReason, setTimeOffReason] = useState('');

  useEffect(() => {
    let cancelled = false;
    setState('loading');
    void Promise.all([api.getAvailabilitySchedules(), api.previewAvailability(30)])
      .then(([scheduleResult, preview]) => {
        if (cancelled) return;
        setSchedules(scheduleResult.schedules);
        setSelectedId((current) => current || scheduleResult.schedules[0]?.staffId || '');
        setSummary(preview);
        setState('ready');
      })
      .catch((error) => {
        if (cancelled) return;
        setState('error');
        onNotify(error instanceof Error ? error.message : 'Availability could not be loaded.');
      });
    return () => { cancelled = true; };
  }, [api, onNotify]);

  useEffect(() => {
    const selected = schedules.find((schedule) => schedule.staffId === selectedId);
    if (!selected) return;
    setDraft(cloneSchedule(selected));
    setDirty(false);
    setSelectedBlock(null);
    void api.listAvailabilityExceptions(selected.staffId)
      .then(setExceptions)
      .catch((error) => onNotify(error instanceof Error ? error.message : 'Time off could not be loaded.'));
  }, [api, onNotify, schedules, selectedId]);

  useEffect(() => {
    if (!drag) return undefined;
    const move = (event: PointerEvent) => {
      if (event.cancelable) event.preventDefault();
      const rawDelta = ((event.clientY - drag.originY) / GRID_HEIGHT) * GRID_MINUTES;
      const delta = Math.round(rawDelta / STEP) * STEP;
      setDraft((current) => {
        if (!current) return current;
        const day = current.days.find((entry) => entry.dayOfWeek === drag.dayOfWeek);
        const block = day?.blocks.find((entry) => entry.id === drag.blockId);
        if (!day || !block) return current;
        const ordered = [...day.blocks].sort((left, right) => minutes(left.start) - minutes(right.start));
        const index = ordered.findIndex((entry) => entry.id === block.id);
        const previousEnd = index > 0 ? minutes(ordered[index - 1].end) : GRID_START;
        const nextStart = index < ordered.length - 1 ? minutes(ordered[index + 1].start) : GRID_END;
        let start = drag.originalStart;
        let end = drag.originalEnd;
        if (drag.mode === 'move') {
          const duration = drag.originalEnd - drag.originalStart;
          start = Math.max(previousEnd, Math.min(nextStart - duration, drag.originalStart + delta));
          end = start + duration;
        } else if (drag.mode === 'start') {
          start = Math.max(previousEnd, Math.min(drag.originalEnd - 30, drag.originalStart + delta));
        } else {
          end = Math.min(nextStart, Math.max(drag.originalStart + 30, drag.originalEnd + delta));
        }
        return {
          ...current,
          days: current.days.map((entry) => entry.dayOfWeek === drag.dayOfWeek
            ? { ...entry, blocks: entry.blocks.map((item) => item.id === drag.blockId ? { ...item, start: time(start), end: time(end) } : item) }
            : entry),
        };
      });
      setDirty(true);
    };
    const end = () => setDrag(null);
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', end, { once: true });
    window.addEventListener('pointercancel', end, { once: true });
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
    };
  }, [drag]);

  const selectedSchedule = schedules.find((schedule) => schedule.staffId === selectedId) ?? null;
  const weeklyMinutes = useMemo(() => draft?.days.reduce(
    (sum, day) => sum + day.blocks.reduce((daySum, block) => daySum + minutes(block.end) - minutes(block.start), 0),
    0,
  ) ?? 0, [draft]);
  const activeDays = draft?.days.filter((day) => day.blocks.length).length ?? 0;
  const splitDays = draft?.days.filter((day) => day.blocks.length > 1).length ?? 0;

  const updateDay = (dayOfWeek: number, updater: (blocks: AdminAvailabilityBlock[]) => AdminAvailabilityBlock[]) => {
    setDraft((current) => current ? {
      ...current,
      days: current.days.map((day) => day.dayOfWeek === dayOfWeek ? { ...day, blocks: updater(day.blocks) } : day),
    } : current);
    setDirty(true);
  };

  const addBlock = (dayOfWeek: number) => {
    if (!draft) return;
    const day = draft.days.find((entry) => entry.dayOfWeek === dayOfWeek);
    if (!day || day.blocks.length >= 4) return;
    const ordered = [...day.blocks].sort((left, right) => minutes(left.start) - minutes(right.start));
    let start = 9 * 60;
    for (const block of ordered) {
      if (start + 120 <= minutes(block.start)) break;
      start = minutes(block.end) + 30;
    }
    start = Math.min(start, GRID_END - 120);
    const block = { id: newBlockId(), start: time(start), end: time(start + 120) };
    updateDay(dayOfWeek, (blocks) => [...blocks, block].sort((left, right) => minutes(left.start) - minutes(right.start)));
    setSelectedBlock({ dayOfWeek, blockId: block.id });
  };

  const clearDay = (dayOfWeek: number) => {
    updateDay(dayOfWeek, () => []);
    setSelectedBlock(null);
  };

  const splitSelectedBlock = () => {
    if (!draft || !selectedBlock) return;
    const day = draft.days.find((entry) => entry.dayOfWeek === selectedBlock.dayOfWeek);
    const block = day?.blocks.find((entry) => entry.id === selectedBlock.blockId);
    if (!block) return;
    const start = minutes(block.start);
    const end = minutes(block.end);
    if (end - start < 150) {
      onNotify('A block needs at least 2.5 hours to add a one-hour break.');
      return;
    }
    const breakStart = Math.round(((start + end) / 2 - 30) / STEP) * STEP;
    const first = { ...block, end: time(breakStart) };
    const second = { id: newBlockId(), start: time(breakStart + 60), end: block.end };
    updateDay(selectedBlock.dayOfWeek, (blocks) => blocks.flatMap((entry) => entry.id === block.id ? [first, second] : [entry]));
    setSelectedBlock({ dayOfWeek: selectedBlock.dayOfWeek, blockId: second.id });
  };

  const removeSelectedBlock = () => {
    if (!selectedBlock) return;
    updateDay(selectedBlock.dayOfWeek, (blocks) => blocks.filter((block) => block.id !== selectedBlock.blockId));
    setSelectedBlock(null);
  };

  const applyPattern = (pattern: 'weekdays' | 'four-day' | 'copy') => {
    if (!draft) return;
    const source = pattern === 'copy'
      ? draft.days.find((day) => day.dayOfWeek === (selectedBlock?.dayOfWeek ?? 1))?.blocks ?? []
      : [{ id: newBlockId(), start: '09:00', end: '17:00' }];
    setDraft({
      ...draft,
      days: draft.days.map((day) => {
        const enabled = pattern === 'four-day'
          ? [1, 2, 3, 4].includes(day.dayOfWeek)
          : pattern === 'weekdays'
            ? [1, 2, 3, 4, 5].includes(day.dayOfWeek)
            : [1, 2, 3, 4, 5].includes(day.dayOfWeek);
        return {
          ...day,
          blocks: enabled ? source.map((block) => ({ ...block, id: newBlockId() })) : pattern === 'copy' ? day.blocks : [],
        };
      }),
    });
    setDirty(true);
    setSelectedBlock(null);
  };

  const nudgeBlock = (event: ReactKeyboardEvent, dayOfWeek: number, block: AdminAvailabilityBlock) => {
    if (!['ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault();
    const delta = event.key === 'ArrowUp' ? -STEP : STEP;
    updateDay(dayOfWeek, (blocks) => {
      const ordered = [...blocks].sort((left, right) => minutes(left.start) - minutes(right.start));
      const index = ordered.findIndex((entry) => entry.id === block.id);
      const duration = minutes(block.end) - minutes(block.start);
      const minimum = index > 0 ? minutes(ordered[index - 1].end) : GRID_START;
      const maximum = (index < ordered.length - 1 ? minutes(ordered[index + 1].start) : GRID_END) - duration;
      const start = Math.max(minimum, Math.min(maximum, minutes(block.start) + delta));
      return blocks.map((entry) => entry.id === block.id ? { ...entry, start: time(start), end: time(start + duration) } : entry);
    });
  };

  const saveSchedule = async (): Promise<boolean> => {
    if (!draft || !dirty) return true;
    setState('saving');
    try {
      const result = await api.saveAvailabilitySchedule(
        draft.staffId,
        draft.version,
        draft.days.map((day) => ({ dayOfWeek: day.dayOfWeek, blocks: day.blocks })),
      );
      setSchedules((current) => current.map((schedule) => schedule.staffId === result.schedule.staffId ? result.schedule : schedule));
      setDraft(cloneSchedule(result.schedule));
      setDirty(false);
      setState('ready');
      onNotify(`${result.schedule.displayName}'s weekly availability was saved.`);
      return true;
    } catch (error) {
      setState('error');
      onNotify(error instanceof AdminApiClientError ? error.message : 'Weekly availability could not be saved.');
      return false;
    }
  };

  const refreshPreview = async () => {
    if (!await saveSchedule()) return;
    setState('loading');
    try {
      setSummary(await api.previewAvailability(30));
      setState('ready');
      onNotify('The next 30 days were recalculated without publishing.');
    } catch (error) {
      setState('error');
      onNotify(error instanceof Error ? error.message : 'Availability preview could not be refreshed.');
    }
  };

  const publish = async () => {
    // Publishing replaces what customers can currently book. Previously one
    // click, with the scale of the change only visible afterwards.
    const preview = await confirmAction({
      title: 'Publish customer booking times',
      summary: 'Replaces the times customers can book for the next 30 days with the schedule shown here.',
      changes: [
        {
          label: 'Bookable times',
          before: summary ? `${summary.slotCount} published` : 'none published',
          after: 'recalculated from this schedule',
        },
        { label: 'Team members covered', after: String(summary?.staffCount ?? 0) },
        { label: 'Services covered', after: String(summary?.serviceCount ?? 0) },
      ],
      notifies: null,
      paymentEffect: null,
      reversible: {
        kind: 'recoverable',
        detail: 'Yes — publish again after editing. Existing bookings are unaffected.',
      },
      confirmLabel: 'Publish for the next 30 days',
    });
    if (!preview.confirmed) return;

    if (!await saveSchedule()) return;
    setState('publishing');
    try {
      const published = await api.publishAvailability(30);
      setSummary(published);
      setState('ready');
      onNotify(`${published.slotCount} customer times are now live for the next 30 days.`);
    } catch (error) {
      setState('error');
      onNotify(error instanceof Error ? error.message : 'Customer availability could not be published.');
    }
  };

  const addTimeOff = async () => {
    if (!selectedSchedule) return;
    setState('saving');
    try {
      const created = await api.createAvailabilityException(selectedSchedule.staffId, {
        startDate: timeOffStart,
        endDate: timeOffEnd,
        reason: timeOffReason,
      });
      setExceptions((current) => [...current, created].sort((left, right) => left.startDate.localeCompare(right.startDate)));
      setTimeOffReason('');
      setSummary(await api.previewAvailability(30));
      setState('ready');
      onNotify('Time off was added to the preview.');
    } catch (error) {
      setState('error');
      onNotify(error instanceof Error ? error.message : 'Time off could not be added.');
    }
  };

  const removeTimeOff = async (exceptionId: string) => {
    if (!selectedSchedule) return;
    setState('saving');
    try {
      await api.deleteAvailabilityException(selectedSchedule.staffId, exceptionId);
      setExceptions((current) => current.filter((entry) => entry.id !== exceptionId));
      setSummary(await api.previewAvailability(30));
      setState('ready');
      onNotify('Time off was removed.');
    } catch (error) {
      setState('error');
      onNotify(error instanceof Error ? error.message : 'Time off could not be removed.');
    }
  };

  return (
    <section className="availability-studio" aria-labelledby="availability-title">
      <header className="availability-studio__header">
        <div>
          <p>Availability designer</p>
          <h1 id="availability-title">Shape the week by sight.</h1>
          <span>Drag shifts, pull their edges, split in a break, and preview the exact customer calendar before anything goes live.</span>
        </div>
        <div className="availability-studio__actions">
          <span data-state={state}><i />{state === 'loading' ? 'Calculating' : state === 'saving' ? 'Saving' : state === 'publishing' ? 'Publishing' : state === 'error' ? 'Needs attention' : dirty ? 'Unsaved changes' : 'Saved'}</span>
          <button className="is-secondary" disabled={state === 'saving' || state === 'publishing'} type="button" onClick={() => void refreshPreview()}>Preview 30 days</button>
          <button disabled={state === 'saving' || state === 'publishing'} type="button" onClick={() => void publish()}>{state === 'publishing' ? 'Publishing...' : 'Publish customer times'}</button>
        </div>
      </header>

      <div className="availability-summary" aria-label="Availability preview summary">
        <article><span>Working week</span><strong>{Math.floor(weeklyMinutes / 60)}h</strong><small>{activeDays} active days</small></article>
        <article><span>Built-in breaks</span><strong>{splitDays}</strong><small>split-shift days</small></article>
        <article><span>Customer times</span><strong>{summary?.slotCount ?? '—'}</strong><small>next 30 days</small></article>
        <article><span>Staff options</span><strong>{summary?.candidateCount ?? '—'}</strong><small>across {summary?.serviceCount ?? 0} services</small></article>
      </div>

      <nav className="availability-staff" aria-label="Choose team member">
        {schedules.map((schedule) => (
          <button aria-pressed={schedule.staffId === selectedId} key={schedule.staffId} type="button" onClick={() => setSelectedId(schedule.staffId)}>
            <i style={{ '--staff-color': schedule.color } as CSSProperties}>{schedule.displayName.split(/\s+/).map((part) => part[0]).slice(0, 2).join('')}</i>
            <span><strong>{schedule.displayName}</strong><small>{schedule.days.filter((day) => day.blocks.length).length} working days</small></span>
          </button>
        ))}
      </nav>

      {draft ? (
        <>
          <section className="availability-toolbar" aria-label="Weekly schedule tools">
            <div><span>Editing</span><strong>{draft.displayName}</strong><small>{draft.timeZone}</small></div>
            <div className="availability-patterns">
              <span>Quick patterns</span>
              <button type="button" onClick={() => applyPattern('weekdays')}>Mon–Fri, 9–5</button>
              <button type="button" onClick={() => applyPattern('four-day')}>Four-day week</button>
              <button type="button" onClick={() => applyPattern('copy')}>Copy selected day</button>
            </div>
            <div className="availability-block-tools">
              <button disabled={!selectedBlock} type="button" onClick={splitSelectedBlock}><Icon size={15}><path d="M12 3v7M12 14v7M5 12h14" /></Icon>Add break</button>
              <button disabled={!selectedBlock} type="button" onClick={removeSelectedBlock}><Icon size={15}><path d="M4 7h16M9 7V4h6v3M8 7l1 13h6l1-13" /></Icon>Remove block</button>
              <button className="is-save" disabled={!dirty || state === 'saving'} type="button" onClick={() => void saveSchedule()}>{state === 'saving' ? 'Saving...' : 'Save week'}</button>
            </div>
          </section>

          <div className="availability-grid-shell">
            <div className="availability-time-axis" aria-hidden="true">
              <div className="availability-time-axis__head" />
              {HOURS.slice(0, -1).map((value) => <span key={value} style={{ top: `${((value - GRID_START) / GRID_MINUTES) * 100}%` }}>{friendlyTime(time(value)).replace(':00', '')}</span>)}
            </div>
            <div className="availability-grid">
              {DISPLAY_DAYS.map((dayOfWeek) => {
                const day = draft.days.find((entry) => entry.dayOfWeek === dayOfWeek);
                if (!day) return null;
                return (
                  <section className="availability-day" data-empty={!day.blocks.length || undefined} key={day.dayOfWeek}>
                    <header>
                      <div><span>{day.label.slice(0, 3)}</span><strong>{durationLabel(day.blocks)}</strong></div>
                      <div><button aria-label={`Add ${day.label} block`} disabled={day.blocks.length >= 4} type="button" onClick={() => addBlock(day.dayOfWeek)}>+</button><button aria-label={`Clear ${day.label}`} disabled={!day.blocks.length} type="button" onClick={() => clearDay(day.dayOfWeek)}>×</button></div>
                    </header>
                    <div className="availability-day__track">
                      {HOURS.slice(0, -1).map((value) => <i aria-hidden="true" key={value} style={{ top: `${((value - GRID_START) / GRID_MINUTES) * 100}%` }} />)}
                      {!day.blocks.length ? <button className="availability-day__empty" type="button" onClick={() => addBlock(day.dayOfWeek)}><span>Day off</span><small>Add hours</small></button> : null}
                      {day.blocks.map((block) => {
                        const start = minutes(block.start);
                        const end = minutes(block.end);
                        const active = selectedBlock?.dayOfWeek === day.dayOfWeek && selectedBlock.blockId === block.id;
                        return (
                          <div
                            aria-label={`${day.label}, ${friendlyTime(block.start)} to ${friendlyTime(block.end)}. Use arrow keys to move.`}
                            aria-pressed={active}
                            className="availability-block"
                            key={block.id}
                            role="button"
                            tabIndex={0}
                            style={{
                              '--block-color': draft.color,
                              height: `${((end - start) / GRID_MINUTES) * 100}%`,
                              top: `${((start - GRID_START) / GRID_MINUTES) * 100}%`,
                            } as CSSProperties}
                            onClick={() => setSelectedBlock({ dayOfWeek: day.dayOfWeek, blockId: block.id })}
                            onKeyDown={(event) => nudgeBlock(event, day.dayOfWeek, block)}
                            onPointerDown={(event) => {
                              event.preventDefault();
                              setSelectedBlock({ dayOfWeek: day.dayOfWeek, blockId: block.id });
                              setDrag({ dayOfWeek: day.dayOfWeek, blockId: block.id, mode: 'move', originY: event.clientY, originalStart: start, originalEnd: end });
                            }}
                          >
                            <span className="availability-block__handle is-top" onPointerDown={(event) => { event.preventDefault(); event.stopPropagation(); setSelectedBlock({ dayOfWeek: day.dayOfWeek, blockId: block.id }); setDrag({ dayOfWeek: day.dayOfWeek, blockId: block.id, mode: 'start', originY: event.clientY, originalStart: start, originalEnd: end }); }} />
                            <strong>{friendlyTime(block.start)}</strong>
                            <small>{friendlyTime(block.end)}</small>
                            <em>{Math.round((end - start) / 60 * 10) / 10}h</em>
                            <span className="availability-block__handle is-bottom" onPointerDown={(event) => { event.preventDefault(); event.stopPropagation(); setSelectedBlock({ dayOfWeek: day.dayOfWeek, blockId: block.id }); setDrag({ dayOfWeek: day.dayOfWeek, blockId: block.id, mode: 'end', originY: event.clientY, originalStart: start, originalEnd: end }); }} />
                          </div>
                        );
                      })}
                    </div>
                  </section>
                );
              })}
            </div>
          </div>

          <div className="availability-lower-grid">
            <section className="availability-time-off">
              <div className="availability-section-heading"><p>Special dates</p><h2>Time off and closures</h2><span>These override the normal week without erasing it.</span></div>
              <div className="availability-time-off__form">
                <label>From<input type="date" value={timeOffStart} onChange={(event) => { setTimeOffStart(event.target.value); if (event.target.value > timeOffEnd) setTimeOffEnd(event.target.value); }} /></label>
                <label>Through<input min={timeOffStart} type="date" value={timeOffEnd} onChange={(event) => setTimeOffEnd(event.target.value)} /></label>
                <label>Reason<input placeholder="Vacation, training..." value={timeOffReason} onChange={(event) => setTimeOffReason(event.target.value)} /></label>
                <button type="button" onClick={() => void addTimeOff()}>Block dates</button>
              </div>
              <div className="availability-time-off__list">
                {exceptions.length ? exceptions.map((entry) => (
                  <article key={entry.id}><i /><div><strong>{friendlyDate(entry.startDate)}{entry.endDate !== entry.startDate ? ` – ${friendlyDate(entry.endDate)}` : ''}</strong><span>{entry.reason || 'Unavailable'}</span></div><button type="button" onClick={() => void removeTimeOff(entry.id)}>Remove</button></article>
                )) : <p>No upcoming closures. The visual week above is in control.</p>}
              </div>
            </section>

            <section className="availability-preview-card">
              <div className="availability-section-heading"><p>Customer impact</p><h2>30-day preview</h2><span>{summary ? `${summary.startsOn} through ${summary.endsOn}` : 'Calculating the customer calendar'}</span></div>
              <div className="availability-preview-card__status" data-mode={summary?.mode ?? 'preview'}><i /><strong>{summary?.mode === 'published' ? 'Live and bookable' : 'Changes are private'}</strong><span>{summary?.mode === 'published' ? 'This publication is serving customer times.' : 'Save and preview as often as needed before publishing.'}</span></div>
              <div className="availability-service-list">
                {summary?.services.map((service) => <article key={service.id}><span><strong>{service.name}</strong><small>{service.candidateCount} staff options</small></span><em>{service.slotCount} times</em></article>)}
              </div>
              {summary?.warnings.length ? <div className="availability-preview-card__warnings">{summary.warnings.slice(0, 3).map((warning) => <span key={warning}>{warning}</span>)}</div> : null}
            </section>
          </div>
        </>
      ) : <div className="availability-empty"><strong>No active team schedules yet.</strong><p>Add a team member first, then their week will appear here.</p></div>}
      {previewElement}
    </section>
  );
}

export default AvailabilityStudio;
