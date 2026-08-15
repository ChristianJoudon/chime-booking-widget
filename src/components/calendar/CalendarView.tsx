import { type FC, useEffect, useMemo, useState } from 'react';
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
    if (!selectedDate || !isSameDay(day, selectedDate)) {
      onDayChanged?.(day);
    }
  }

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

      <div className="calendar-board">
        <section className="calendar-month-card" aria-label={`${format(visibleMonth, 'MMMM yyyy')} calendar`}>
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
            <h3>{activeDate ? format(activeDate, 'EEEE, MMM d') : 'Choose a day'}</h3>
            <p role="status" aria-live="polite">
              {activeDate
                ? countAvailable(activeSlots) > 0
                  ? `${countAvailable(activeSlots)} openings available.`
                  : 'No remaining openings for this day.'
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
