import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';

import { AdminApiError } from './types.js';

const DAY_KEYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

type DayKey = (typeof DAY_KEYS)[number];

interface WorkingDay {
  enabled: boolean;
  start: string;
  end: string;
}

export interface AvailabilityWorkingBlock {
  id: string;
  start: string;
  end: string;
}

interface ServiceRow {
  id: string;
  name: string;
  short_description: string | null;
  default_duration_minutes: number;
  duration_increment_minutes: number;
  buffer_before_minutes: number;
  buffer_after_minutes: number;
  minimum_notice_minutes: number;
  maximum_advance_days: number;
  price_minor: number;
  currency: string;
  deposit_mode: 'none' | 'fixed' | 'percentage' | 'full';
  deposit_amount_minor: number | null;
  deposit_percentage: number | string | null;
  staff_ids: string[];
  location_ids: string[];
}

interface StaffRow {
  id: string;
  display_name: string;
  settings: Record<string, unknown>;
}

interface LocationRow {
  id: string;
  name: string;
  time_zone: string;
}

interface ExceptionRow {
  id: string;
  subject_id: string;
  starts_at: Date | string;
  ends_at: Date | string;
  reason: string | null;
  created_at: Date | string;
}

interface GeneratedCandidate {
  staffMemberId: string;
  locationId: string | null;
  busyStartsAt: string;
  busyEndsAt: string;
}

interface GeneratedSlot {
  generationKey: string;
  serviceId: string;
  startsAt: string;
  endsAt: string;
  label: string;
  candidates: GeneratedCandidate[];
}

export interface AvailabilityServiceSummary {
  id: string;
  name: string;
  slotCount: number;
  candidateCount: number;
}

export interface AvailabilitySummary {
  mode: 'preview' | 'published';
  publicationId?: string;
  publishedAt?: string;
  startsOn: string;
  endsOn: string;
  horizonDays: number;
  timeZone: string;
  serviceCount: number;
  staffCount: number;
  slotCount: number;
  candidateCount: number;
  warnings: string[];
  services: AvailabilityServiceSummary[];
}

export interface AvailabilityExceptionDto {
  id: string;
  staffId: string;
  startDate: string;
  endDate: string;
  reason: string | null;
  startsAt: string;
  endsAt: string;
  createdAt: string;
}

export interface AvailabilityMutationContext {
  organizationId: string;
  userId: string;
  requestId: string;
  idempotencyKey: string;
}

interface GeneratedAvailability {
  summary: AvailabilitySummary;
  services: ServiceRow[];
  staff: StaffRow[];
  slots: GeneratedSlot[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validTimeZone(value: string | undefined): string {
  const candidate = value?.trim() || process.env.CHIME_TIME_ZONE?.trim() || 'UTC';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: candidate }).format(new Date());
    return candidate;
  } catch {
    return 'UTC';
  }
}

function dateParts(value: Date, timeZone: string): Record<string, number> {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(value);
  return Object.fromEntries(parts
    .filter((part) => part.type !== 'literal')
    .map((part) => [part.type, Number(part.value)]));
}

function dateInZone(value: Date, timeZone: string): string {
  const parts = dateParts(value, timeZone);
  return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
}

function addDays(date: string, amount: number): string {
  const value = new Date(`${date}T12:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + amount);
  return value.toISOString().slice(0, 10);
}

function zonedDateTime(date: string, time: string, timeZone: string): Date {
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  const target = Date.UTC(year, month - 1, day, hour, minute, 0);
  let guess = target;
  for (let pass = 0; pass < 3; pass += 1) {
    const parts = dateParts(new Date(guess), timeZone);
    const represented = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
    guess -= represented - target;
  }
  return new Date(guess);
}

function validDate(value: string): boolean {
  if (!DATE_PATTERN.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function minutes(value: string): number {
  const [hour, minute] = value.split(':').map(Number);
  return hour * 60 + minute;
}

function timeFromMinutes(value: number): string {
  return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
}

function workingHours(settings: Record<string, unknown> | null): Record<DayKey, WorkingDay> {
  const source = isRecord(settings) && isRecord(settings.workingHours) ? settings.workingHours : {};
  return Object.fromEntries(DAY_KEYS.map((day) => {
    const raw = isRecord(source[day]) ? source[day] : {};
    return [day, {
      enabled: typeof raw.enabled === 'boolean' ? raw.enabled : !['saturday', 'sunday'].includes(day),
      start: typeof raw.start === 'string' ? raw.start : '09:00',
      end: typeof raw.end === 'string' ? raw.end : '17:00',
    }];
  })) as Record<DayKey, WorkingDay>;
}

export function availabilityBlocks(
  settings: Record<string, unknown>,
): Record<DayKey, AvailabilityWorkingBlock[]> {
  const legacyHours = workingHours(settings);
  const rawHours = isRecord(settings.workingHours)
    ? settings.workingHours as Record<string, unknown>
    : {};

  return Object.fromEntries(DAY_KEYS.map((dayKey) => {
    const day = legacyHours[dayKey];
    if (!day.enabled) return [dayKey, []];
    const rawDay = isRecord(rawHours[dayKey]) ? rawHours[dayKey] : {};
    const rawBlocks = Array.isArray(rawDay.blocks) ? rawDay.blocks : [];
    const blocks = rawBlocks
      .map((value, index): AvailabilityWorkingBlock | null => {
        if (!isRecord(value)) return null;
        const start = typeof value.start === 'string' ? value.start.slice(0, 5) : '';
        const end = typeof value.end === 'string' ? value.end.slice(0, 5) : '';
        if (!/^\d{2}:\d{2}$/.test(start) || !/^\d{2}:\d{2}$/.test(end) || minutes(start) >= minutes(end)) {
          return null;
        }
        return {
          id: typeof value.id === 'string' && value.id.trim() ? value.id.trim().slice(0, 80) : `${dayKey}-${index + 1}`,
          start,
          end,
        };
      })
      .filter((value): value is AvailabilityWorkingBlock => Boolean(value))
      .sort((left, right) => minutes(left.start) - minutes(right.start));
    const coherent = blocks.length > 0
      && blocks[0].start === day.start
      && blocks[blocks.length - 1].end === day.end
      && blocks.every((block, index) => index === 0 || minutes(block.start) >= minutes(blocks[index - 1].end));
    return [dayKey, coherent ? blocks : [{ id: `${dayKey}-primary`, start: day.start, end: day.end }]];
  })) as Record<DayKey, AvailabilityWorkingBlock[]>;
}

function staffLocationIds(staff: StaffRow): string[] {
  const value = isRecord(staff.settings) ? staff.settings.locationIds : [];
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function candidateLocation(service: ServiceRow, staff: StaffRow): string | null | undefined {
  const staffLocations = staffLocationIds(staff);
  if (service.location_ids.length) {
    if (!staffLocations.length) return service.location_ids[0];
    return service.location_ids.find((id) => staffLocations.includes(id));
  }
  return staffLocations[0] ?? null;
}

function overlapsException(exceptions: ExceptionRow[], startsAt: Date, endsAt: Date): boolean {
  return exceptions.some((exception) => (
    new Date(exception.starts_at).getTime() < endsAt.getTime()
    && new Date(exception.ends_at).getTime() > startsAt.getTime()
  ));
}

function depositAmount(service: ServiceRow): number {
  if (service.deposit_mode === 'fixed') return Number(service.deposit_amount_minor ?? 0);
  if (service.deposit_mode === 'percentage') {
    return Math.round(Number(service.price_minor) * Number(service.deposit_percentage ?? 0) / 100);
  }
  if (service.deposit_mode === 'full') return Number(service.price_minor);
  return 0;
}

async function organizationTimeZone(pool: Pool, organizationId: string): Promise<string> {
  const result = await pool.query<{ time_zone: string }>(
    `SELECT time_zone
       FROM chime_app.locations
      WHERE organization_id = $1 AND is_active = TRUE
      ORDER BY created_at ASC
      LIMIT 1`,
    [organizationId],
  );
  return validTimeZone(result.rows[0]?.time_zone);
}

async function generateAvailability(
  pool: Pool,
  organizationId: string,
  horizonDays: number,
): Promise<GeneratedAvailability> {
  const timeZone = await organizationTimeZone(pool, organizationId);
  const now = new Date();
  const startsOn = dateInZone(now, timeZone);
  const endsOn = addDays(startsOn, horizonDays - 1);
  const rangeStart = zonedDateTime(startsOn, '00:00', timeZone);
  const rangeEnd = zonedDateTime(addDays(endsOn, 1), '00:00', timeZone);

  const [serviceResult, staffResult, locationResult, exceptionResult] = await Promise.all([
    pool.query<ServiceRow>(
      `SELECT s.id::text, s.name, s.short_description, s.default_duration_minutes,
              s.duration_increment_minutes, s.buffer_before_minutes, s.buffer_after_minutes,
              s.minimum_notice_minutes, s.maximum_advance_days, s.price_minor, s.currency,
              s.deposit_mode, s.deposit_amount_minor, s.deposit_percentage,
              COALESCE(array_agg(DISTINCT ss.staff_member_id::text)
                FILTER (WHERE ss.staff_member_id IS NOT NULL), '{}') AS staff_ids,
              COALESCE(array_agg(DISTINCT sl.location_id::text)
                FILTER (WHERE sl.location_id IS NOT NULL), '{}') AS location_ids
         FROM chime_app.services s
         LEFT JOIN chime_app.service_staff ss
           ON ss.organization_id = s.organization_id AND ss.service_id = s.id
         LEFT JOIN chime_app.service_locations sl
           ON sl.organization_id = s.organization_id AND sl.service_id = s.id
        WHERE s.organization_id = $1 AND s.is_active = TRUE AND s.is_public = TRUE
        GROUP BY s.id
        ORDER BY s.name ASC`,
      [organizationId],
    ),
    pool.query<StaffRow>(
      `SELECT id::text, display_name, settings
         FROM chime_app.staff_members
        WHERE organization_id = $1 AND is_active = TRUE
        ORDER BY display_name ASC`,
      [organizationId],
    ),
    pool.query<LocationRow>(
      `SELECT id::text, name, time_zone
         FROM chime_app.locations
        WHERE organization_id = $1 AND is_active = TRUE`,
      [organizationId],
    ),
    pool.query<ExceptionRow>(
      `SELECT id::text, subject_id::text, starts_at, ends_at, reason, created_at
         FROM chime_app.availability_exceptions
        WHERE organization_id = $1
          AND subject_type = 'staff'
          AND mode = 'unavailable'
          AND starts_at < $3
          AND ends_at > $2`,
      [organizationId, rangeStart.toISOString(), rangeEnd.toISOString()],
    ),
  ]);

  const staffById = new Map(staffResult.rows.map((member) => [member.id, member]));
  const locationById = new Map(locationResult.rows.map((location) => [location.id, location]));
  const exceptionsByStaff = new Map<string, ExceptionRow[]>();
  for (const exception of exceptionResult.rows) {
    const current = exceptionsByStaff.get(exception.subject_id) ?? [];
    current.push(exception);
    exceptionsByStaff.set(exception.subject_id, current);
  }

  const warnings: string[] = [];
  const slots = new Map<string, GeneratedSlot>();
  const serviceSummaries = new Map<string, AvailabilityServiceSummary>();

  for (const service of serviceResult.rows) {
    serviceSummaries.set(service.id, { id: service.id, name: service.name, slotCount: 0, candidateCount: 0 });
    if (!service.staff_ids.length) {
      warnings.push(`${service.name} needs at least one assigned team member.`);
      continue;
    }

    const assignedStaff = service.staff_ids
      .map((id) => staffById.get(id))
      .filter((member): member is StaffRow => Boolean(member));
    if (!assignedStaff.length) {
      warnings.push(`${service.name} has no active assigned team members.`);
      continue;
    }

    const serviceMax = now.getTime() + Number(service.maximum_advance_days) * 86_400_000;
    for (let dayOffset = 0; dayOffset < horizonDays; dayOffset += 1) {
      const localDate = addDays(startsOn, dayOffset);
      const weekday = DAY_KEYS[new Date(`${localDate}T12:00:00.000Z`).getUTCDay()];

      for (const member of assignedStaff) {
        const locationId = candidateLocation(service, member);
        if (locationId === undefined) {
          warnings.push(`${member.display_name} and ${service.name} do not share a location.`);
          continue;
        }
        const candidateTimeZone = validTimeZone(
          (locationId ? locationById.get(locationId)?.time_zone : undefined) ?? timeZone,
        );
        const blocks = availabilityBlocks(member.settings)[weekday];
        if (!blocks.length) continue;

        for (const block of blocks) {
          const workStart = minutes(block.start);
          const workEnd = minutes(block.end);
          const firstStart = workStart + Number(service.buffer_before_minutes);
          const duration = Number(service.default_duration_minutes);
          const increment = Number(service.duration_increment_minutes);
          const lastEnd = workEnd - Number(service.buffer_after_minutes);

          for (let startMinute = firstStart; startMinute + duration <= lastEnd; startMinute += increment) {
            const startsAt = zonedDateTime(localDate, timeFromMinutes(startMinute), candidateTimeZone);
            const endsAt = zonedDateTime(localDate, timeFromMinutes(startMinute + duration), candidateTimeZone);
            const busyStartsAt = zonedDateTime(
              localDate,
              timeFromMinutes(startMinute - Number(service.buffer_before_minutes)),
              candidateTimeZone,
            );
            const busyEndsAt = zonedDateTime(
              localDate,
              timeFromMinutes(startMinute + duration + Number(service.buffer_after_minutes)),
              candidateTimeZone,
            );
            if (startsAt.getTime() < now.getTime() + Number(service.minimum_notice_minutes) * 60_000) continue;
            if (startsAt.getTime() > serviceMax) continue;
            if (overlapsException(exceptionsByStaff.get(member.id) ?? [], busyStartsAt, busyEndsAt)) continue;

            const generationKey = `${organizationId}:${service.id}:${startsAt.toISOString()}`;
            const slot = slots.get(generationKey) ?? {
              generationKey,
              serviceId: service.id,
              startsAt: startsAt.toISOString(),
              endsAt: endsAt.toISOString(),
              label: `${timeFromMinutes(startMinute)} · ${service.name}`,
              candidates: [],
            };
            if (!slot.candidates.some((candidate) => candidate.staffMemberId === member.id)) {
              slot.candidates.push({
                staffMemberId: member.id,
                locationId,
                busyStartsAt: busyStartsAt.toISOString(),
                busyEndsAt: busyEndsAt.toISOString(),
              });
            }
            slots.set(generationKey, slot);
          }
        }
      }
    }
  }

  const generatedSlots = [...slots.values()].sort((left, right) => left.startsAt.localeCompare(right.startsAt));
  for (const slot of generatedSlots) {
    const summary = serviceSummaries.get(slot.serviceId);
    if (summary) {
      summary.slotCount += 1;
      summary.candidateCount += slot.candidates.length;
    }
  }
  for (const summary of serviceSummaries.values()) {
    if (!summary.slotCount) warnings.push(`${summary.name} has no customer times in this window.`);
  }
  if (!serviceResult.rows.length) warnings.push('No active public services are ready to publish.');

  return {
    services: serviceResult.rows,
    staff: staffResult.rows,
    slots: generatedSlots,
    summary: {
      mode: 'preview',
      startsOn,
      endsOn,
      horizonDays,
      timeZone,
      serviceCount: serviceResult.rows.length,
      staffCount: staffResult.rows.length,
      slotCount: generatedSlots.length,
      candidateCount: generatedSlots.reduce((total, slot) => total + slot.candidates.length, 0),
      warnings: [...new Set(warnings)],
      services: [...serviceSummaries.values()],
    },
  };
}

export async function previewAvailability(
  pool: Pool,
  organizationId: string,
  horizonDays: number,
): Promise<AvailabilitySummary> {
  return (await generateAvailability(pool, organizationId, horizonDays)).summary;
}

async function synchronizeRules(
  client: PoolClient,
  organizationId: string,
  staff: StaffRow[],
  timeZone: string,
): Promise<void> {
  await client.query(
    `DELETE FROM chime_app.availability_rules
      WHERE organization_id = $1 AND subject_type = 'staff'`,
    [organizationId],
  );
  for (const member of staff) {
    const blocksByDay = availabilityBlocks(member.settings);
    for (let dayOfWeek = 0; dayOfWeek < DAY_KEYS.length; dayOfWeek += 1) {
      for (const block of blocksByDay[DAY_KEYS[dayOfWeek]]) {
        await client.query(
          `INSERT INTO chime_app.availability_rules (
             organization_id, subject_type, subject_id, day_of_week,
             local_start_time, local_end_time, time_zone, capacity, is_active
           ) VALUES ($1, 'staff', $2, $3, $4::time, $5::time, $6, 1, TRUE)`,
          [organizationId, member.id, dayOfWeek, block.start, block.end, timeZone],
        );
      }
    }
  }
}

async function synchronizeServices(
  client: PoolClient,
  organizationId: string,
  services: ServiceRow[],
): Promise<void> {
  await client.query(
    `UPDATE public.chime_services
        SET active = FALSE, updated_at = now()
      WHERE organization_id = $1 OR organization_id IS NULL`,
    [organizationId],
  );
  for (let index = 0; index < services.length; index += 1) {
    const service = services[index];
    await client.query(
      `INSERT INTO public.chime_services (
         id, name, description, duration_minutes, deposit_amount_cents,
         active, sort_order, organization_id, admin_service_id
       ) VALUES ($1, $2, $3, $4, $5, TRUE, $6, $7, $8)
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name,
         description = EXCLUDED.description,
         duration_minutes = EXCLUDED.duration_minutes,
         deposit_amount_cents = EXCLUDED.deposit_amount_cents,
         active = TRUE,
         sort_order = EXCLUDED.sort_order,
         organization_id = EXCLUDED.organization_id,
         admin_service_id = EXCLUDED.admin_service_id,
         updated_at = now()`,
      [
        service.id,
        service.name,
        service.short_description,
        service.default_duration_minutes,
        depositAmount(service),
        index + 1,
        organizationId,
        service.id,
      ],
    );
  }
}

async function persistSlots(
  client: PoolClient,
  organizationId: string,
  publicationId: string,
  slots: GeneratedSlot[],
): Promise<void> {
  await client.query(
    `DELETE FROM public.chime_slot_candidates c
      USING public.chime_availability_slots s
      WHERE c.slot_id = s.id
        AND s.organization_id = $1
        AND s.source = 'admin'
        AND s.starts_at >= now()`,
    [organizationId],
  );
  await client.query(
    `DELETE FROM public.chime_availability_slots
      WHERE organization_id = $1
        AND source = 'admin'
        AND starts_at >= now()
        AND booked_count = 0`,
    [organizationId],
  );

  if (!slots.length) return;
  const slotPayload = slots.map((slot) => ({
    generation_key: slot.generationKey,
    service_id: slot.serviceId,
    starts_at: slot.startsAt,
    ends_at: slot.endsAt,
    label: slot.label,
    capacity: slot.candidates.length,
  }));
  await client.query(
    `INSERT INTO public.chime_availability_slots (
       service_id, starts_at, ends_at, status, label, capacity, booked_count,
       organization_id, source, publication_id, generation_key
     )
     SELECT incoming.service_id, incoming.starts_at, incoming.ends_at, 'available',
            incoming.label, incoming.capacity, 0, $1, 'admin', $2, incoming.generation_key
       FROM jsonb_to_recordset($3::jsonb) AS incoming(
         generation_key TEXT, service_id TEXT, starts_at TIMESTAMPTZ,
         ends_at TIMESTAMPTZ, label TEXT, capacity INTEGER
       )
     ON CONFLICT (generation_key) WHERE generation_key IS NOT NULL DO UPDATE SET
       service_id = EXCLUDED.service_id,
       starts_at = EXCLUDED.starts_at,
       ends_at = EXCLUDED.ends_at,
       label = EXCLUDED.label,
       capacity = GREATEST(public.chime_availability_slots.booked_count, EXCLUDED.capacity),
       status = CASE
         WHEN public.chime_availability_slots.booked_count < EXCLUDED.capacity THEN 'available'
         ELSE 'booked'
       END,
       organization_id = EXCLUDED.organization_id,
       source = EXCLUDED.source,
       publication_id = EXCLUDED.publication_id,
       updated_at = now()`,
    [organizationId, publicationId, JSON.stringify(slotPayload)],
  );

  const candidatePayload = slots.flatMap((slot) => slot.candidates.map((candidate) => ({
    generation_key: slot.generationKey,
    service_id: slot.serviceId,
    staff_member_id: candidate.staffMemberId,
    location_id: candidate.locationId,
    busy_starts_at: candidate.busyStartsAt,
    busy_ends_at: candidate.busyEndsAt,
  })));
  await client.query(
    `INSERT INTO public.chime_slot_candidates (
       slot_id, organization_id, service_id, staff_member_id, location_id,
       busy_starts_at, busy_ends_at
     )
     SELECT s.id, $1, incoming.service_id, incoming.staff_member_id,
            incoming.location_id, incoming.busy_starts_at, incoming.busy_ends_at
       FROM jsonb_to_recordset($2::jsonb) AS incoming(
         generation_key TEXT, service_id TEXT, staff_member_id UUID, location_id UUID,
         busy_starts_at TIMESTAMPTZ, busy_ends_at TIMESTAMPTZ
       )
       JOIN public.chime_availability_slots s ON s.generation_key = incoming.generation_key
     ON CONFLICT (slot_id, staff_member_id) DO UPDATE SET
       location_id = EXCLUDED.location_id,
       busy_starts_at = EXCLUDED.busy_starts_at,
       busy_ends_at = EXCLUDED.busy_ends_at`,
    [organizationId, JSON.stringify(candidatePayload)],
  );
  await client.query('SELECT public.chime_refresh_generated_slot_capacities($1)', [organizationId]);
}

export async function publishAvailability(
  pool: Pool,
  horizonDays: number,
  context: AvailabilityMutationContext,
): Promise<AvailabilitySummary> {
  const replay = await pool.query<{ summary: AvailabilitySummary }>(
    `SELECT summary
       FROM chime_app.availability_publications
      WHERE organization_id = $1 AND idempotency_key = $2 AND status = 'published'`,
    [context.organizationId, context.idempotencyKey],
  );
  if (replay.rows[0]) return replay.rows[0].summary;

  const generated = await generateAvailability(pool, context.organizationId, horizonDays);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `SELECT pg_advisory_xact_lock(hashtextextended('chime-availability:' || $1::text, 0))`,
      [context.organizationId],
    );
    const lockedReplay = await client.query<{ summary: AvailabilitySummary }>(
      `SELECT summary
         FROM chime_app.availability_publications
        WHERE organization_id = $1 AND idempotency_key = $2 AND status = 'published'`,
      [context.organizationId, context.idempotencyKey],
    );
    if (lockedReplay.rows[0]) {
      await client.query('COMMIT');
      return lockedReplay.rows[0].summary;
    }

    const publicationId = randomUUID();
    const publishedAt = new Date().toISOString();
    const summary: AvailabilitySummary = {
      ...generated.summary,
      mode: 'published',
      publicationId,
      publishedAt,
    };
    await client.query(
      `INSERT INTO chime_app.availability_publications (
         id, organization_id, starts_on, ends_on, horizon_days, status,
         summary, actor_id, request_id, idempotency_key, published_at
       ) VALUES ($1, $2, $3, $4, $5, 'building', $6::jsonb, $7, $8, $9, $10)`,
      [
        publicationId,
        context.organizationId,
        summary.startsOn,
        summary.endsOn,
        horizonDays,
        JSON.stringify(summary),
        context.userId,
        context.requestId,
        context.idempotencyKey,
        publishedAt,
      ],
    );
    await synchronizeServices(client, context.organizationId, generated.services);
    await synchronizeRules(client, context.organizationId, generated.staff, summary.timeZone);
    await persistSlots(client, context.organizationId, publicationId, generated.slots);
    await client.query(
      `UPDATE chime_app.availability_publications
          SET status = 'published', summary = $2::jsonb, published_at = $3, updated_at = now()
        WHERE id = $1`,
      [publicationId, JSON.stringify(summary), publishedAt],
    );
    await client.query(
      `INSERT INTO chime_app.audit_events (
         organization_id, actor_kind, actor_id, action, entity_type, entity_id,
         before_state, after_state, correlation_id
       ) VALUES ($1, 'user', $2, 'availability.published', 'availability_publication', $3,
                 NULL, $4::jsonb, $5)`,
      [context.organizationId, context.userId, publicationId, JSON.stringify(summary), context.requestId],
    );
    await client.query(
      `INSERT INTO chime_app.outbox_events (
         organization_id, event_type, aggregate_type, aggregate_id, payload, idempotency_key
       ) VALUES ($1, 'availability.published', 'availability_publication', $2, $3::jsonb, $4)`,
      [context.organizationId, publicationId, JSON.stringify({ summary }), context.idempotencyKey],
    );
    await client.query('COMMIT');
    return summary;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

function exceptionDto(row: ExceptionRow, timeZone: string): AvailabilityExceptionDto {
  const startsAt = new Date(row.starts_at);
  const endsAt = new Date(row.ends_at);
  return {
    id: row.id,
    staffId: row.subject_id,
    startDate: dateInZone(startsAt, timeZone),
    endDate: dateInZone(new Date(endsAt.getTime() - 1), timeZone),
    reason: row.reason,
    startsAt: startsAt.toISOString(),
    endsAt: endsAt.toISOString(),
    createdAt: new Date(row.created_at).toISOString(),
  };
}

export async function listAvailabilityExceptions(
  pool: Pool,
  organizationId: string,
  staffId: string,
): Promise<AvailabilityExceptionDto[]> {
  const timeZone = await organizationTimeZone(pool, organizationId);
  const result = await pool.query<ExceptionRow>(
    `SELECT id::text, subject_id::text, starts_at, ends_at, reason, created_at
       FROM chime_app.availability_exceptions
      WHERE organization_id = $1 AND subject_type = 'staff' AND subject_id = $2
        AND mode = 'unavailable' AND ends_at >= now()
      ORDER BY starts_at ASC`,
    [organizationId, staffId],
  );
  return result.rows.map((row) => exceptionDto(row, timeZone));
}

export async function createAvailabilityException(
  pool: Pool,
  staffId: string,
  startDate: string,
  endDate: string,
  reason: string | null,
  context: AvailabilityMutationContext,
): Promise<AvailabilityExceptionDto> {
  if (!validDate(startDate) || !validDate(endDate) || startDate > endDate) {
    throw new AdminApiError(400, 'AVAILABILITY_DATES_INVALID', 'Choose a valid start and end date.');
  }
  const timeZone = await organizationTimeZone(pool, context.organizationId);
  const startsAt = zonedDateTime(startDate, '00:00', timeZone);
  const endsAt = zonedDateTime(addDays(endDate, 1), '00:00', timeZone);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const replay = await client.query<{ exception: AvailabilityExceptionDto }>(
      `SELECT payload -> 'exception' AS exception
         FROM chime_app.outbox_events
        WHERE organization_id = $1 AND idempotency_key = $2
          AND event_type = 'availability_exception.created'`,
      [context.organizationId, context.idempotencyKey],
    );
    if (replay.rows[0]?.exception) {
      await client.query('COMMIT');
      return replay.rows[0].exception;
    }
    const staffExists = await client.query(
      `SELECT 1 FROM chime_app.staff_members WHERE id = $1 AND organization_id = $2`,
      [staffId, context.organizationId],
    );
    if (!staffExists.rowCount) {
      throw new AdminApiError(404, 'STAFF_NOT_FOUND', 'That team member no longer exists.');
    }
    const id = randomUUID();
    const inserted = await client.query<ExceptionRow>(
      `INSERT INTO chime_app.availability_exceptions (
         id, organization_id, subject_type, subject_id, starts_at, ends_at, mode, reason
       ) VALUES ($1, $2, 'staff', $3, $4, $5, 'unavailable', $6)
       RETURNING id::text, subject_id::text, starts_at, ends_at, reason, created_at`,
      [id, context.organizationId, staffId, startsAt.toISOString(), endsAt.toISOString(), reason],
    );
    const exception = exceptionDto(inserted.rows[0], timeZone);
    await client.query(
      `INSERT INTO chime_app.audit_events (
         organization_id, actor_kind, actor_id, action, entity_type, entity_id,
         before_state, after_state, correlation_id
       ) VALUES ($1, 'user', $2, 'availability_exception.created', 'availability_exception', $3,
                 NULL, $4::jsonb, $5)`,
      [context.organizationId, context.userId, id, JSON.stringify(exception), context.requestId],
    );
    await client.query(
      `INSERT INTO chime_app.outbox_events (
         organization_id, event_type, aggregate_type, aggregate_id, payload, idempotency_key
       ) VALUES ($1, 'availability_exception.created', 'availability_exception', $2, $3::jsonb, $4)`,
      [context.organizationId, id, JSON.stringify({ exception }), context.idempotencyKey],
    );
    await client.query('COMMIT');
    return exception;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function deleteAvailabilityException(
  pool: Pool,
  staffId: string,
  exceptionId: string,
  context: AvailabilityMutationContext,
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const replay = await client.query(
      `SELECT 1 FROM chime_app.outbox_events
        WHERE organization_id = $1 AND idempotency_key = $2
          AND event_type = 'availability_exception.deleted'`,
      [context.organizationId, context.idempotencyKey],
    );
    if (replay.rowCount) {
      await client.query('COMMIT');
      return;
    }
    const result = await client.query<ExceptionRow>(
      `DELETE FROM chime_app.availability_exceptions
        WHERE id = $1 AND organization_id = $2 AND subject_type = 'staff' AND subject_id = $3
        RETURNING id::text, subject_id::text, starts_at, ends_at, reason, created_at`,
      [exceptionId, context.organizationId, staffId],
    );
    if (!result.rows[0]) {
      throw new AdminApiError(404, 'AVAILABILITY_EXCEPTION_NOT_FOUND', 'That time-off entry no longer exists.');
    }
    await client.query(
      `INSERT INTO chime_app.audit_events (
         organization_id, actor_kind, actor_id, action, entity_type, entity_id,
         before_state, after_state, correlation_id
       ) VALUES ($1, 'user', $2, 'availability_exception.deleted', 'availability_exception', $3,
                 $4::jsonb, NULL, $5)`,
      [context.organizationId, context.userId, exceptionId, JSON.stringify(result.rows[0]), context.requestId],
    );
    await client.query(
      `INSERT INTO chime_app.outbox_events (
         organization_id, event_type, aggregate_type, aggregate_id, payload, idempotency_key
       ) VALUES ($1, 'availability_exception.deleted', 'availability_exception', $2, $3::jsonb, $4)`,
      [context.organizationId, exceptionId, JSON.stringify({ deletedId: exceptionId }), context.idempotencyKey],
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
