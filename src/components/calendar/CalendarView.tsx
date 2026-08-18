import { type FC, useEffect, useMemo, useRef, useState } from 'react';
import {
  addMonths,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  isToday,
  startOfMonth,
  startOfWeek,
  subMonths,
} from 'date-fns';
import { motion } from 'framer-motion';
import type { DailyAvailability, Slot } from '@/types/calendar';
import type { Service } from '@/types/service';
import { toDateKey } from '@/lib/dates';
import { getServiceDurationLabel } from '@/lib/normalizers';


function daysBetween(start: Date, end: Date): Date[] {
  const days: Date[] = [];
  const cursor = new Date(start);
  cursor.setHours(0, 0, 0, 0);
  const final = new Date(end);
  final.setHours(0, 0, 0, 0);

  while (cursor <= final) {
    days.push(new Date(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }

  return days;
}

interface CalendarViewProps {
  availability: DailyAvailability[];
  service?: Service | null;
  selectedDate?: Date | null;
  selectedSlot?: Slot | null;
  onSlotPicked?: (slot: Slot, date: Date) => void;
  onDayChanged?: (date: Date) => void;
}

type DayTone = 'open' | 'limited' | 'full' | 'empty';

const weekDays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function countAvailable(slots: Slot[]): number {
  return slots.filter((slot) => slot.available).length;
}

function toneForSlots(slots: Slot[]): DayTone {
  const available = countAvailable(slots);
  if (slots.length === 0) return 'empty';
  if (available === 0) return 'full';
  if (available <= 2) return 'limited';
  return 'open';
}

function getTimeBucket(timeLabel: string): 'Morning' | 'Afternoon' | 'Evening' {
  const normalized = timeLabel.trim().toUpperCase();
  const match = normalized.match(/^(\d{1,2})(?::\d{2})?\s*(AM|PM)$/);
  if (!match) return 'Afternoon';

  let hour = Number(match[1]);
  const meridiem = match[2];
  if (meridiem === 'PM' && hour !== 12) hour += 12;
  if (meridiem === 'AM' && hour === 12) hour = 0;

  if (hour < 12) return 'Morning';
  if (hour < 17) return 'Afternoon';
  return 'Evening';
}

const CalendarView: FC<CalendarViewProps> = ({
  availability,
  service,
  selectedDate,
  selectedSlot,
  onSlotPicked,
  onDayChanged,
}) => {
  const [visibleMonth, setVisibleMonth] = useState<Date>(() => {
    const firstAvailableDay = availability.find((day) => countAvailable(day.slots) > 0);
    return startOfMonth(firstAvailableDay?.date ?? selectedDate ?? new Date());
  });
  const [activeDate, setActiveDate] = useState<Date | null>(selectedDate ?? null);

  /*
   * Whether the customer has asked to see the month grid.
   *
   * Deliberately not "which view are we in". Whether this flag matters at all is
   * decided in CSS by a container query, so the component never learns how wide
   * it is: no ResizeObserver, no matchMedia — which would be wrong anyway, since
   * the widget sizes from its container and not from the window — and no
   * width-derived state that can fall out of step with the layout.
   *
   * Above 620px of container the flag is inert and the layout is byte for byte
   * what it was: month grid beside the times.
   */
  const [monthOpen, setMonthOpen] = useState(false);
  const dayHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const wasMonthOpen = useRef(false);

  const slotsByDate = useMemo(() => {
    return availability.reduce<Record<string, Slot[]>>((acc, day) => {
      acc[toDateKey(day.date)] = day.slots;
      return acc;
    }, {});
  }, [availability]);

  const firstAvailableDate = useMemo(
    () => availability.find((day) => countAvailable(day.slots) > 0)?.date ?? null,
    [availability],
  );

  const availableDateKeys = useMemo(
    () => new Set(availability.filter((day) => countAvailable(day.slots) > 0).map((day) => toDateKey(day.date))),
    [availability],
  );

  /*
   * The same days the key set holds, in order, so the day arrows can step
   * between them. Derived from one source with one predicate, because two
   * definitions of "available" that drift apart would make an arrow offer a day
   * that handleDayPick then refuses.
   */
  const availableDates = useMemo(
    () => availability.filter((day) => countAvailable(day.slots) > 0).map((day) => day.date),
    [availability],
  );

  const monthDays = useMemo(() => {
    const monthStart = startOfMonth(visibleMonth);
    const monthEnd = endOfMonth(visibleMonth);
    return daysBetween(
      startOfWeek(monthStart, { weekStartsOn: 0 }),
      endOfWeek(monthEnd, { weekStartsOn: 0 }),
    );
  }, [visibleMonth]);

  const activeKey = activeDate ? toDateKey(activeDate) : null;
  const activeSlots = useMemo(
    () => (activeKey ? slotsByDate[activeKey] ?? [] : []),
    [activeKey, slotsByDate],
  );
  const groupedSlots = useMemo(() => {
    return activeSlots.reduce<Record<'Morning' | 'Afternoon' | 'Evening', Slot[]>>(
      (acc, slot) => {
        acc[getTimeBucket(slot.timeLabel)].push(slot);
        return acc;
      },
      { Morning: [], Afternoon: [], Evening: [] },
    );
  }, [activeSlots]);

  const visibleMonthStats = useMemo(() => {
    const monthItems = availability.filter((day) => isSameMonth(day.date, visibleMonth));
    const daysOpen = monthItems.filter((day) => countAvailable(day.slots) > 0).length;
    const openSlots = monthItems.reduce((sum, day) => sum + countAvailable(day.slots), 0);
    return { daysOpen, openSlots };
  }, [availability, visibleMonth]);

  useEffect(() => {
    if (selectedDate) {
      setActiveDate(selectedDate);
      setVisibleMonth(startOfMonth(selectedDate));
      return;
    }

    if (!activeDate || !availableDateKeys.has(toDateKey(activeDate))) {
      setActiveDate(firstAvailableDate);
      if (firstAvailableDate) setVisibleMonth(startOfMonth(firstAvailableDate));
    }
  }, [activeDate, availableDateKeys, firstAvailableDate, selectedDate]);

  function handleDayPick(day: Date) {
    const key = toDateKey(day);
    if (!availableDateKeys.has(key)) return;
    setActiveDate(day);
    // Picking a day is the answer to the question the month grid asked, so the
    // grid stands down and the times come back. Inert above 620px, where the
    // grid and the times are on screen together and neither ever hides.
    setMonthOpen(false);
    if (!selectedDate || !isSameDay(day, selectedDate)) {
      onDayChanged?.(day);
    }
  }

  /*
   * Step to the previous or next day that actually has openings.
   *
   * Skipping empty days rather than walking the calendar one square at a time:
   * an arrow that lands on "no openings" three times running is an arrow that
   * feels broken, and the customer has no way to know how many more presses it
   * will take.
   *
   * It goes through handleDayPick rather than calling setActiveDate itself, and
   * that is load-bearing. handleDayPick clears a committed slot when the day
   * changes, which both keeps a time from a different day out of the Continue
   * button and — because the effect above forces activeDate back to
   * selectedDate whenever one is set — is the only thing that stops these
   * arrows appearing to do nothing. The same trap is documented on
   * jumpToNextAvailable below.
   */
  function stepDay(direction: -1 | 1) {
    if (!activeDate) return;
    const index = availableDates.findIndex((day) => isSameDay(day, activeDate));
    if (index === -1) return;
    const next = availableDates[index + direction];
    if (next) handleDayPick(next);
  }

  const activeDateIndex = activeDate
    ? availableDates.findIndex((day) => isSameDay(day, activeDate))
    : -1;
  const hasPreviousDay = activeDateIndex > 0;
  const hasNextDay = activeDateIndex > -1 && activeDateIndex < availableDates.length - 1;

  /*
   * Catch focus when the month grid disappears.
   *
   * Tapping a day inside the grid hides the grid, which means the element the
   * customer just activated stops existing. Focus would fall to the shadow
   * root and a keyboard or switch user would be stranded with no way back into
   * the flow. Focus moves to the day heading, which reads the date they chose —
   * so the rescue also answers "what did I just pick?".
   *
   * Only on close. Opening the month leaves the toggle on screen, and standard
   * disclosure behaviour is for focus to stay put.
   */
  useEffect(() => {
    if (wasMonthOpen.current && !monthOpen) dayHeadingRef.current?.focus();
    wasMonthOpen.current = monthOpen;
  }, [monthOpen]);

  function jumpToNextAvailable() {
    if (!firstAvailableDate) return;
    setActiveDate(firstAvailableDate);
    setVisibleMonth(startOfMonth(firstAvailableDate));
    // If a slot on a different day was already selected, clear it. Otherwise the
    // effect that syncs activeDate back to the selected date immediately snaps
    // the view back (making this button appear to do nothing), and the "continue"
    // button could still carry a time from the previously selected day.
    if (!selectedDate || !isSameDay(firstAvailableDate, selectedDate)) {
      onDayChanged?.(firstAvailableDate);
    }
  }

  return (
    <div className="calendar-shell">
      <div className="calendar-toolbar">
        <div>
          <p className="chime-kicker">Full calendar</p>
          <h2 className="calendar-title">Pick the best day and time</h2>
          <p className="calendar-subtitle">
            {service ? `${service.name}${getServiceDurationLabel(service) ? ` · ${getServiceDurationLabel(service)}` : ''}` : 'Choose from live openings'}
          </p>
        </div>
        <div className="calendar-toolbar__actions">
          <button type="button" className="chime-button chime-button--ghost chime-button--compact" onClick={jumpToNextAvailable} disabled={!firstAvailableDate}>
            Next opening
          </button>
          <div className="calendar-month-controls" aria-label="Calendar month navigation">
            <button type="button" className="calendar-icon-button" onClick={() => setVisibleMonth((current) => subMonths(current, 1))} aria-label="Previous month">
              ‹
            </button>
            <button type="button" className="calendar-icon-button" onClick={() => setVisibleMonth((current) => addMonths(current, 1))} aria-label="Next month">
              ›
            </button>
          </div>
        </div>
      </div>

      <div className="calendar-board" data-month-open={monthOpen ? 'true' : 'false'}>
        {/*
          * A sibling of both the month card and the times, not a child of
          * either — because it is the control that hides them, and a button
          * inside the thing it hides takes itself off screen with it. Put in
          * the times panel first, opening the month took "Back to times" away
          * with the panel and left no way back but picking a day.
          *
          * Only rendered visibly below 620px. Above that the grid and the times
          * are both on screen and this would be a second way to do what the
          * grid already does.
          */}
        <div className="calendar-day-nav" aria-label="Calendar navigation">
          <span className="calendar-day-nav__steps">
            <button
              type="button"
              className="calendar-icon-button"
              onClick={() => stepDay(-1)}
              disabled={!hasPreviousDay}
              aria-label="Previous day with openings"
            >
              ‹
            </button>
            <button
              type="button"
              className="calendar-icon-button"
              onClick={() => stepDay(1)}
              disabled={!hasNextDay}
              aria-label="Next day with openings"
            >
              ›
            </button>
          </span>
          <button
            type="button"
            className="view-toggle"
            onClick={() => setMonthOpen((open) => !open)}
            aria-expanded={monthOpen}
            aria-controls="chime-month-card"
          >
            {monthOpen ? 'Back to times' : format(visibleMonth, 'MMMM')}
          </button>
        </div>

        <section id="chime-month-card" className="calendar-month-card" aria-label={`${format(visibleMonth, 'MMMM yyyy')} calendar`}>
          <div className="calendar-month-card__header">
            <div>
              <p className="chime-kicker">Month view</p>
              <h3>{format(visibleMonth, 'MMMM yyyy')}</h3>
            </div>
            <div className="calendar-stat-strip" aria-label="Availability in visible month">
              <span>{visibleMonthStats.daysOpen} days</span>
              <span>{visibleMonthStats.openSlots} slots</span>
            </div>
          </div>

          <div className="calendar-weekdays" aria-hidden="true">
            {weekDays.map((day) => (
              <span key={day}>{day}</span>
            ))}
          </div>

          <div className="calendar-grid">
            {monthDays.map((day) => {
              const key = toDateKey(day);
              const slots = slotsByDate[key] ?? [];
              const freeCount = countAvailable(slots);
              const tone = toneForSlots(slots);
              const isOutside = !isSameMonth(day, visibleMonth);
              const isActive = activeDate ? isSameDay(day, activeDate) : false;
              const isBookable = freeCount > 0;

              return (
                <motion.button
                  key={key}
                  type="button"
                  className="calendar-day"
                  data-tone={tone}
                  data-active={isActive ? 'true' : 'false'}
                  data-outside={isOutside ? 'true' : 'false'}
                  data-today={isToday(day) ? 'true' : 'false'}
                  disabled={!isBookable}
                  onClick={() => handleDayPick(day)}
                  whileHover={isBookable ? { y: -3, scale: 1.015 } : undefined}
                  whileTap={isBookable ? { scale: 0.965 } : undefined}
                  aria-current={selectedDate && isSameDay(day, selectedDate) ? 'date' : undefined}
                  aria-label={`${format(day, 'EEEE, MMMM d')}${isBookable ? `, ${freeCount} openings` : ', unavailable'}`}
                >
                  <span className="calendar-day__number">{format(day, 'd')}</span>
                  <span className="calendar-day__status">
                    {isBookable ? `${freeCount} open` : slots.length > 0 ? 'Booked' : '—'}
                  </span>
                  <span className="calendar-day__glow" aria-hidden="true" />
                </motion.button>
              );
            })}
          </div>

          <div className="calendar-legend" aria-label="Calendar legend">
            <span><i data-tone="open" />Open</span>
            <span><i data-tone="limited" />Filling fast</span>
            <span><i data-tone="full" />Booked</span>
          </div>
        </section>

        <aside className="time-panel">
          <div className="time-panel__header">
            <p className="chime-kicker">Available times</p>
            {/* tabIndex -1 so the focus rescue above can land here. Not in the
              * tab order — this is a heading, not a control. */}
            <h3 ref={dayHeadingRef} tabIndex={-1}>
              {activeDate ? format(activeDate, 'EEEE, MMM d') : 'Choose a day'}
            </h3>
            <p role="status" aria-live="polite">
              {activeDate
                ? countAvailable(activeSlots) > 0
                  /*
                   * The date leads, so stepping days announces itself.
                   *
                   * This region already existed and already re-read on every day
                   * change; it just said "6 openings available", which is the
                   * same sentence for every day and so told a screen reader
                   * nothing about which day the arrow had reached.
                   */
                  ? `${format(activeDate, 'EEEE, MMMM d')} — ${countAvailable(activeSlots)} openings available.`
                  : `${format(activeDate, 'EEEE, MMMM d')} — no remaining openings for this day.`
                : 'Select an available day to view exact appointment times.'}
            </p>
          </div>

          {activeDate && countAvailable(activeSlots) > 0 ? (
            <div className="time-groups">
              {(['Morning', 'Afternoon', 'Evening'] as const).map((bucket) => {
                const slots = groupedSlots[bucket];
                if (slots.length === 0) return null;

                return (
                  <section key={bucket} className="time-group">
                    <h4>{bucket}</h4>
                    <div className="time-slot-grid">
                      {slots.map((slot) => {
                        const isPicked = Boolean(selectedSlot?.id === slot.id && activeDate && selectedDate && isSameDay(activeDate, selectedDate));

                        return (
                          <motion.button
                            key={slot.id}
                            type="button"
                            className="time-slot-button"
                            data-picked={isPicked ? 'true' : 'false'}
                            aria-pressed={isPicked}
                            disabled={!slot.available}
                            onClick={() => slot.available && onSlotPicked?.(slot, activeDate)}
                            whileHover={slot.available ? { y: -2, scale: 1.025 } : undefined}
                            whileTap={slot.available ? { scale: 0.97 } : undefined}
                          >
                            <span>{slot.timeLabel}</span>
                            <small>{slot.available ? slot.label ?? 'Book' : slot.label ?? 'Booked'}</small>
                          </motion.button>
                        );
                      })}
                    </div>
                  </section>
                );
              })}
            </div>
          ) : (
            <div className="chime-empty-state time-panel__empty">
              <p className="chime-empty-state__title">No times selected yet.</p>
              <p className="chime-empty-state__copy">
                Choose any highlighted day. Booked or unavailable days stay visible but inactive so the full calendar still feels complete.
              </p>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
};

export default CalendarView;
