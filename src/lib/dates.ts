import type { DailyAvailabilityInput } from '@/types/calendar';

const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Convert a Date to the local calendar key used by the API and UI.
 * Avoid toISOString() here: it converts to UTC and can shift the date
 * for users west/east of UTC.
 */
export function toDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Parse API/config dates in a timezone-safe way.
 * A plain YYYY-MM-DD should represent that local calendar day, not UTC midnight.
 */
export function parseDateInput(value: Date | string): Date {
  if (value instanceof Date) {
    return new Date(value.getFullYear(), value.getMonth(), value.getDate());
  }

  if (DATE_KEY_PATTERN.test(value)) {
    const [year, month, day] = value.split('-').map(Number);
    return new Date(year, month - 1, day);
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid date received by widget: ${value}`);
  }

  return parsed;
}

export function sortAvailability(days: DailyAvailabilityInput[]): DailyAvailabilityInput[] {
  return [...days].sort(
    (a, b) => parseDateInput(a.date).getTime() - parseDateInput(b.date).getTime(),
  );
}
