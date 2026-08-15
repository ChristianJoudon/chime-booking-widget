export interface CalendarEventInput {
  title: string;
  description: string;
  location?: string;
  start: Date;
  end: Date;
}

const TIME_LABEL_PATTERN = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i;

function parseIsoDate(value?: string): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function parseTimeLabelOntoDate(timeLabel: string, date: Date): Date | null {
  const match = TIME_LABEL_PATTERN.exec(timeLabel.trim());
  if (!match) return null;

  let hours = Number.parseInt(match[1], 10);
  const minutes = Number.parseInt(match[2], 10);
  const meridiem = match[3].toUpperCase();

  if (meridiem === 'AM' && hours === 12) hours = 0;
  if (meridiem === 'PM' && hours !== 12) hours += 12;

  const result = new Date(date);
  result.setHours(hours, minutes, 0, 0);
  return result;
}

export function buildAppointmentEvent(args: {
  serviceName: string;
  durationMinutes?: number;
  businessName: string;
  location?: string;
  bookingId?: string;
  slot: { timeLabel: string; startsAt?: string; endsAt?: string };
  date: Date;
}): CalendarEventInput {
  const { serviceName, durationMinutes, businessName, location, bookingId, slot, date } = args;

  let start = parseIsoDate(slot.startsAt) ?? parseTimeLabelOntoDate(slot.timeLabel, date);
  if (!start) {
    start = new Date(date);
    start.setHours(9, 0, 0, 0);
  }

  const end =
    parseIsoDate(slot.endsAt) ?? new Date(start.getTime() + (durationMinutes ?? 60) * 60_000);

  const description =
    `Appointment: ${serviceName}\nBooked online.` + (bookingId ? `\nReference: ${bookingId}` : '');

  return {
    title: `${serviceName} — ${businessName}`,
    description,
    location,
    start,
    end,
  };
}

/** Format a Date as UTC basic format: YYYYMMDDTHHMMSSZ. */
function toUtcBasicFormat(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return (
    `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}` +
    `T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`
  );
}

export function googleCalendarUrl(e: CalendarEventInput): string {
  const params = [
    'action=TEMPLATE',
    `text=${encodeURIComponent(e.title)}`,
    `dates=${encodeURIComponent(`${toUtcBasicFormat(e.start)}/${toUtcBasicFormat(e.end)}`)}`,
    `details=${encodeURIComponent(e.description)}`,
  ];
  if (e.location) params.push(`location=${encodeURIComponent(e.location)}`);
  return `https://calendar.google.com/calendar/render?${params.join('&')}`;
}

function outlookComposeUrl(base: string, e: CalendarEventInput): string {
  const params = [
    'rru=addevent',
    `subject=${encodeURIComponent(e.title)}`,
    `startdt=${encodeURIComponent(e.start.toISOString())}`,
    `enddt=${encodeURIComponent(e.end.toISOString())}`,
    `body=${encodeURIComponent(e.description)}`,
  ];
  if (e.location) params.push(`location=${encodeURIComponent(e.location)}`);
  return `${base}?${params.join('&')}`;
}

export function outlookLiveUrl(e: CalendarEventInput): string {
  return outlookComposeUrl('https://outlook.live.com/calendar/0/action/compose', e);
}

export function office365Url(e: CalendarEventInput): string {
  return outlookComposeUrl('https://outlook.office.com/calendar/0/action/compose', e);
}

export function yahooCalendarUrl(e: CalendarEventInput): string {
  const params = [
    'v=60',
    `title=${encodeURIComponent(e.title)}`,
    `st=${encodeURIComponent(toUtcBasicFormat(e.start))}`,
    `et=${encodeURIComponent(toUtcBasicFormat(e.end))}`,
    `desc=${encodeURIComponent(e.description)}`,
  ];
  if (e.location) params.push(`in_loc=${encodeURIComponent(e.location)}`);
  return `https://calendar.yahoo.com/?${params.join('&')}`;
}

/** Escape text per RFC 5545: backslash, comma, semicolon; newlines become literal \n. */
function escapeIcsText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;')
    .replace(/\n/g, '\\n');
}

export function buildIcsContent(e: CalendarEventInput): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Chime//Booking Widget//EN',
    'BEGIN:VEVENT',
    `UID:${crypto.randomUUID()}@chime-widget`,
    `DTSTAMP:${toUtcBasicFormat(new Date())}`,
    `DTSTART:${toUtcBasicFormat(e.start)}`,
    `DTEND:${toUtcBasicFormat(e.end)}`,
    `SUMMARY:${escapeIcsText(e.title)}`,
    `DESCRIPTION:${escapeIcsText(e.description)}`,
  ];
  if (e.location) lines.push(`LOCATION:${escapeIcsText(e.location)}`);
  lines.push('END:VEVENT', 'END:VCALENDAR');
  return lines.join('\r\n');
}

export function downloadIcs(e: CalendarEventInput, filename = 'appointment.ics'): void {
  const blob = new Blob([buildIcsContent(e)], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}
