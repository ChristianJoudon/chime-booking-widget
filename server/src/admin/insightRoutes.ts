import {
  Router,
  type NextFunction,
  type Request,
  type RequestHandler,
  type Response,
} from 'express';
import type { Pool } from 'pg';

import { getAdminSession } from './auth.js';
import { AdminApiError } from './types.js';

const RANGE_OPTIONS = new Set([7, 30, 90, 365]);

function asyncRoute(
  handler: (request: Request, response: Response) => Promise<void>,
): RequestHandler {
  return (request, response, next: NextFunction) => {
    void handler(request, response).catch(next);
  };
}

function numberValue(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function iso(value: unknown): string {
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? new Date(0).toISOString() : date.toISOString();
}

function rate(numerator: unknown, denominator: unknown): number {
  const total = numberValue(denominator);
  return total > 0 ? Math.round((numberValue(numerator) / total) * 1000) / 10 : 0;
}

function trend(current: unknown, previous: unknown): number | null {
  const currentValue = numberValue(current);
  const previousValue = numberValue(previous);
  if (previousValue === 0) return currentValue === 0 ? 0 : null;
  return Math.round(((currentValue - previousValue) / previousValue) * 1000) / 10;
}

export function createInsightRouter(pool: Pool): Router {
  const router = Router();

  router.get('/insights', asyncRoute(async (request, response) => {
    const session = getAdminSession(request);
    const days = Number(request.query.days ?? 30);
    if (!RANGE_OPTIONS.has(days)) {
      throw new AdminApiError(400, 'INVALID_INSIGHT_RANGE', 'Choose a 7, 30, 90, or 365 day range.');
    }
    const timeZone = process.env.CHIME_TIME_ZONE?.trim() || 'Pacific/Honolulu';
    const parameters = [session.organizationId, days];
    const timeZoneParameters = [session.organizationId, days, timeZone];

    const [summaryResult, customerResult, dailyResult, serviceResult, heatmapResult, sourceResult] = await Promise.all([
      pool.query(
        `WITH bounds AS (
           SELECT now() AS ends_at,
             now() - ($2::int * interval '1 day') AS starts_at,
             now() - (($2::int * 2) * interval '1 day') AS previous_starts_at
         ), payment_totals AS (
           SELECT organization_id, appointment_id,
             sum(captured_amount_minor - refunded_amount_minor)::int AS net_collected_minor,
             max(currency) AS currency
           FROM chime_app.payments
           WHERE organization_id = $1
           GROUP BY organization_id, appointment_id
         )
         SELECT
           count(*) FILTER (
             WHERE appointment.starts_at >= bounds.starts_at
               AND appointment.status NOT IN ('draft', 'held', 'expired')
           )::int AS appointments,
           count(*) FILTER (
             WHERE appointment.starts_at >= bounds.previous_starts_at
               AND appointment.starts_at < bounds.starts_at
               AND appointment.status NOT IN ('draft', 'held', 'expired')
           )::int AS previous_appointments,
           count(DISTINCT appointment.customer_id) FILTER (
             WHERE appointment.starts_at >= bounds.starts_at
               AND appointment.status NOT IN ('draft', 'held', 'expired')
           )::int AS unique_customers,
           count(DISTINCT appointment.customer_id) FILTER (
             WHERE appointment.starts_at >= bounds.previous_starts_at
               AND appointment.starts_at < bounds.starts_at
               AND appointment.status NOT IN ('draft', 'held', 'expired')
           )::int AS previous_unique_customers,
           count(*) FILTER (WHERE appointment.starts_at >= bounds.starts_at AND appointment.status = 'completed')::int AS completed,
           count(*) FILTER (WHERE appointment.starts_at >= bounds.starts_at AND appointment.status = 'cancelled')::int AS cancelled,
           count(*) FILTER (WHERE appointment.starts_at >= bounds.starts_at AND appointment.status = 'no_show')::int AS no_show,
           count(*) FILTER (WHERE appointment.starts_at >= bounds.starts_at AND appointment.status = 'pending_approval')::int AS pending_approval,
           COALESCE(round(avg(EXTRACT(epoch FROM (appointment.ends_at - appointment.starts_at)) / 60)
             FILTER (WHERE appointment.starts_at >= bounds.starts_at)), 0)::int AS average_duration_minutes,
           COALESCE(sum(payment.net_collected_minor)
             FILTER (WHERE appointment.starts_at >= bounds.starts_at), 0)::int AS net_collected_minor,
           COALESCE(sum(payment.net_collected_minor)
             FILTER (WHERE appointment.starts_at >= bounds.previous_starts_at AND appointment.starts_at < bounds.starts_at), 0)::int AS previous_net_collected_minor,
           COALESCE(max(payment.currency), 'USD') AS currency,
           min(bounds.starts_at) AS starts_at,
           max(bounds.ends_at) AS ends_at
         FROM chime_app.appointments appointment
         CROSS JOIN bounds
         LEFT JOIN payment_totals payment
           ON payment.organization_id = appointment.organization_id
          AND payment.appointment_id = appointment.id
         WHERE appointment.organization_id = $1
           AND appointment.starts_at >= bounds.previous_starts_at
           AND appointment.starts_at < bounds.ends_at`,
        parameters,
      ),
      pool.query(
        `WITH first_appointments AS (
           SELECT customer_id, min(starts_at) AS first_at
           FROM chime_app.appointments
           WHERE organization_id = $1
             AND status NOT IN ('draft', 'held', 'expired', 'cancelled')
           GROUP BY customer_id
         ), period_customers AS (
           SELECT DISTINCT customer_id
           FROM chime_app.appointments
           WHERE organization_id = $1
             AND starts_at >= now() - ($2::int * interval '1 day')
             AND starts_at < now()
             AND status NOT IN ('draft', 'held', 'expired')
         )
         SELECT
           count(*) FILTER (WHERE first.first_at >= now() - ($2::int * interval '1 day'))::int AS new_customers,
           count(*) FILTER (WHERE first.first_at < now() - ($2::int * interval '1 day'))::int AS returning_customers
         FROM period_customers period
         JOIN first_appointments first ON first.customer_id = period.customer_id`,
        parameters,
      ),
      pool.query(
        `WITH days AS (
           SELECT generate_series(
             (now() AT TIME ZONE $3)::date - ($2::int - 1),
             (now() AT TIME ZONE $3)::date,
             interval '1 day'
           )::date AS day
         ), payment_totals AS (
           SELECT organization_id, appointment_id,
             sum(captured_amount_minor - refunded_amount_minor)::int AS net_collected_minor
           FROM chime_app.payments
           WHERE organization_id = $1
           GROUP BY organization_id, appointment_id
         )
         SELECT days.day::text AS date,
           count(appointment.id) FILTER (WHERE appointment.status NOT IN ('draft', 'held', 'expired'))::int AS appointments,
           count(appointment.id) FILTER (WHERE appointment.status = 'completed')::int AS completed,
           count(appointment.id) FILTER (WHERE appointment.status = 'cancelled')::int AS cancelled,
           COALESCE(sum(payment.net_collected_minor), 0)::int AS net_collected_minor
         FROM days
         LEFT JOIN chime_app.appointments appointment
           ON appointment.organization_id = $1
          AND (appointment.starts_at AT TIME ZONE $3)::date = days.day
         LEFT JOIN payment_totals payment
           ON payment.organization_id = appointment.organization_id
          AND payment.appointment_id = appointment.id
         GROUP BY days.day
         ORDER BY days.day`,
        timeZoneParameters,
      ),
      pool.query(
        `WITH payment_totals AS (
           SELECT organization_id, appointment_id,
             sum(captured_amount_minor - refunded_amount_minor)::int AS net_collected_minor
           FROM chime_app.payments
           WHERE organization_id = $1
           GROUP BY organization_id, appointment_id
         )
         SELECT service.id, service.name,
           count(appointment.id) FILTER (WHERE appointment.status NOT IN ('draft', 'held', 'expired'))::int AS appointments,
           count(appointment.id) FILTER (WHERE appointment.status = 'completed')::int AS completed,
           count(appointment.id) FILTER (WHERE appointment.status = 'cancelled')::int AS cancelled,
           count(DISTINCT appointment.customer_id)::int AS unique_customers,
           COALESCE(sum(payment.net_collected_minor), 0)::int AS net_collected_minor
         FROM chime_app.services service
         LEFT JOIN chime_app.appointments appointment
           ON appointment.organization_id = service.organization_id
          AND appointment.service_id = service.id
          AND appointment.starts_at >= now() - ($2::int * interval '1 day')
          AND appointment.starts_at < now()
         LEFT JOIN payment_totals payment
           ON payment.organization_id = appointment.organization_id
          AND payment.appointment_id = appointment.id
         WHERE service.organization_id = $1
           AND service.is_active = true
         GROUP BY service.id, service.name
         ORDER BY appointments DESC, service.name
         LIMIT 8`,
        parameters,
      ),
      pool.query(
        `SELECT
           EXTRACT(isodow FROM appointment.starts_at AT TIME ZONE $3)::int AS day,
           EXTRACT(hour FROM appointment.starts_at AT TIME ZONE $3)::int AS hour,
           count(*)::int AS appointments
         FROM chime_app.appointments appointment
         WHERE appointment.organization_id = $1
           AND appointment.starts_at >= now() - ($2::int * interval '1 day')
           AND appointment.starts_at < now()
           AND appointment.status NOT IN ('draft', 'held', 'expired', 'cancelled')
         GROUP BY day, hour
         ORDER BY day, hour`,
        timeZoneParameters,
      ),
      pool.query(
        `SELECT COALESCE(NULLIF(trim(source), ''), 'admin') AS source, count(*)::int AS appointments
         FROM chime_app.appointments
         WHERE organization_id = $1
           AND starts_at >= now() - ($2::int * interval '1 day')
           AND starts_at < now()
           AND status NOT IN ('draft', 'held', 'expired')
         GROUP BY COALESCE(NULLIF(trim(source), ''), 'admin')
         ORDER BY appointments DESC`,
        parameters,
      ),
    ]);

    const summary = summaryResult.rows[0] ?? {};
    const customers = customerResult.rows[0] ?? {};
    const appointments = numberValue(summary.appointments);
    response.json({
      range: {
        days,
        startsAt: iso(summary.starts_at ?? new Date(Date.now() - days * 86400000)),
        endsAt: iso(summary.ends_at ?? new Date()),
        timeZone,
      },
      summary: {
        appointments,
        appointmentTrend: trend(summary.appointments, summary.previous_appointments),
        uniqueCustomers: numberValue(summary.unique_customers),
        customerTrend: trend(summary.unique_customers, summary.previous_unique_customers),
        newCustomers: numberValue(customers.new_customers),
        returningCustomers: numberValue(customers.returning_customers),
        netCollectedMinor: numberValue(summary.net_collected_minor),
        collectedTrend: trend(summary.net_collected_minor, summary.previous_net_collected_minor),
        completedRate: rate(summary.completed, appointments),
        cancelledRate: rate(summary.cancelled, appointments),
        noShowRate: rate(summary.no_show, appointments),
        averageDurationMinutes: numberValue(summary.average_duration_minutes),
        pendingApproval: numberValue(summary.pending_approval),
        currency: String(summary.currency ?? 'USD'),
      },
      daily: dailyResult.rows.map((row) => ({
        date: row.date,
        appointments: numberValue(row.appointments),
        completed: numberValue(row.completed),
        cancelled: numberValue(row.cancelled),
        netCollectedMinor: numberValue(row.net_collected_minor),
      })),
      services: serviceResult.rows.map((row) => ({
        id: row.id,
        name: row.name,
        appointments: numberValue(row.appointments),
        completed: numberValue(row.completed),
        cancelled: numberValue(row.cancelled),
        uniqueCustomers: numberValue(row.unique_customers),
        netCollectedMinor: numberValue(row.net_collected_minor),
      })),
      heatmap: heatmapResult.rows.map((row) => ({
        day: numberValue(row.day),
        hour: numberValue(row.hour),
        appointments: numberValue(row.appointments),
      })),
      sources: sourceResult.rows.map((row) => ({
        source: row.source,
        appointments: numberValue(row.appointments),
      })),
    });
  }));

  return router;
}
