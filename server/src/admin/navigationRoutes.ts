import { Router, type Request, type Response } from 'express';
import type { Pool } from 'pg';

import { getAdminSession } from './auth.js';

/**
 * Counts for the sidebar badges.
 *
 * The tightening plan asks that pending requests and failed messages show
 * beside their parent navigation area. The sidebar is present on every screen,
 * so it cannot depend on a particular studio being mounted to know its numbers,
 * and loading the full /operations or /communications payload for two integers
 * would be wasteful.
 *
 * Deliberately excludes test-origin records, matching the rest of the admin
 * surface: a smoke run should not make the sidebar claim a business has work
 * waiting.
 */
export function createNavigationRouter(pool: Pool): Router {
  const router = Router();

  router.get('/navigation/counts', (request: Request, response: Response, next) => {
    void (async () => {
      try {
        const session = getAdminSession(request);
        const { rows } = await pool.query<{
          pending_requests: number;
          failed_messages: number;
        }>(
          `SELECT
             (SELECT count(*)::int
                FROM chime_app.appointments
               WHERE organization_id = $1
                 AND origin <> 'test'
                 AND status IN ('pending_approval', 'change_pending')
             ) AS pending_requests,
             (SELECT count(*)::int
                FROM chime_app.notification_deliveries
               WHERE organization_id = $1
                 AND status = 'failed'
             ) AS failed_messages`,
          [session.organizationId],
        );

        const counts = rows[0] ?? { pending_requests: 0, failed_messages: 0 };
        response.json({
          pendingRequests: Number(counts.pending_requests),
          failedMessages: Number(counts.failed_messages),
        });
      } catch (error) {
        next(error);
      }
    })();
  });

  return router;
}
