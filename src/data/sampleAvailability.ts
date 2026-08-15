import type { DailyAvailability } from '../types/calendar';
import { toDateKey } from '@/lib/dates';

function fmt(h: number, m: number): string {
  const hh = h % 12 === 0 ? 12 : h % 12;
  const mm = m.toString().padStart(2, '0');
  const suf = h < 12 ? 'AM' : 'PM';
  return `${hh}:${mm} ${suf}`;
}

function buildSlots(date: Date, dayIndex: number, now: Date): DailyAvailability['slots'] {
  const daySlots: DailyAvailability['slots'] = [];
  let slotIndex = 0;

  for (let h = 9; h < 17; h += 1) {
    for (let m = 0; m < 60; m += 30) {
      const start = new Date(date);
      start.setHours(h, m, 0, 0);

      // Don't offer openings that have already started. This only affects
      // "today"; every future day is entirely in the future. slotIndex is still
      // advanced so the booked/"Popular" pattern stays stable across the day.
      if (start.getTime() <= now.getTime()) {
        slotIndex += 1;
        continue;
      }

      const weekend = date.getDay() === 6;
      const bookedPattern = (dayIndex + slotIndex * 2) % (weekend ? 3 : 5) === 0;
      const available = !bookedPattern;
      const id = `${toDateKey(date)}-${h}${m === 0 ? '00' : '30'}`;
      const end = new Date(date);
      end.setHours(h, m + 30, 0, 0);

      daySlots.push({
        id,
        timeLabel: fmt(h, m),
        available,
        label: available ? (slotIndex === 4 || slotIndex === 9 ? 'Popular' : undefined) : 'Booked',
        startsAt: start.toISOString(),
        endsAt: end.toISOString(),
      });
      slotIndex += 1;
    }
  }

  return daySlots;
}

export function buildSampleAvailability(days = 90): DailyAvailability[] {
  const calendar: DailyAvailability[] = [];
  const now = new Date();
  const base = new Date(now);
  base.setHours(0, 0, 0, 0);

  for (let i = 0; i < days; i += 1) {
    const date = new Date(base);
    date.setDate(base.getDate() + i);

    // Keep the demo friendlier by skipping Sundays and every third Monday for admin time.
    if (date.getDay() === 0) continue;
    if (date.getDay() === 1 && i % 3 === 0) continue;

    calendar.push({ date, slots: buildSlots(date, i, now) });
  }

  return calendar;
}

export const sampleAvailability: DailyAvailability[] = buildSampleAvailability();
