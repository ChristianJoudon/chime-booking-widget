import { Router, type Request, type Response } from 'express';
import type { Pool } from 'pg';

import { signAdminSession } from './auth.js';
import { verifyPassword } from './passwords.js';
import { AdminApiError, ADMIN_ROLES, type AdminRole } from './types.js';
import { describeWorkspace } from './workspaceEnvironment.js';

/**
 * Administrator sign-in.
 *
 * This route is mounted OUTSIDE requireAdminSession — it is how a session is
 * obtained in the first place. It replaces the previous arrangement, where the
 * only way to get a session was a CLI that signed one and a build-time
 * environment variable that inlined it into the JavaScript bundle.
 */

const MAX_ATTEMPTS = 5;
const LOCK_MINUTES = 15;

/** Deliberately identical for unknown account, wrong password, and no password set. */
const REJECTION = 'That email and password combination was not recognized.';

/**
 * Stand-in hash used when no credential exists, so the work performed is the
 * same whether or not the account is real. Shaped exactly like a stored hash:
 * current work factors, 16-byte salt, 64-byte key. It can never match, because
 * an all-zero key is not a possible scrypt output for a random salt.
 */
const DUMMY_HASH = [
  'scrypt', 32768, 8, 1,
  Buffer.alloc(16).toString('base64'),
  Buffer.alloc(64).toString('base64'),
].join('$');

interface CredentialRow {
  user_id: string;
  email: string;
  password_hash: string | null;
  failed_attempts: number;
  locked_until: Date | null;
  organization_id: string | null;
  role: AdminRole | null;
}

function sessionHours(): number {
  const raw = Number(process.env.CHIME_ADMIN_SESSION_HOURS ?? 12);
  return Number.isFinite(raw) && raw > 0 && raw <= 168 ? raw : 12;
}

function clientAddress(request: Request): string {
  return request.ip ?? 'unknown';
}

async function recordAttempt(
  pool: Pool,
  userId: string,
  succeeded: boolean,
): Promise<void> {
  if (succeeded) {
    await pool.query(
      `UPDATE chime_app.user_credentials
          SET failed_attempts = 0, locked_until = NULL, last_signed_in_at = now()
        WHERE user_id = $1`,
      [userId],
    );
    return;
  }
  await pool.query(
    `UPDATE chime_app.user_credentials
        SET failed_attempts = failed_attempts + 1,
            locked_until = CASE
              WHEN failed_attempts + 1 >= $2 THEN now() + ($3 || ' minutes')::interval
              ELSE locked_until
            END
      WHERE user_id = $1`,
    [userId, MAX_ATTEMPTS, String(LOCK_MINUTES)],
  );
}

async function writeAudit(
  pool: Pool,
  organizationId: string | null,
  userId: string | null,
  action: string,
  detail: Record<string, unknown>,
): Promise<void> {
  if (!organizationId) return;
  await pool.query(
    `INSERT INTO chime_app.audit_events (
       organization_id, actor_kind, actor_id, action, entity_type, entity_id, after_state
     ) VALUES ($1, 'user', $2, $3, 'session', $2, $4)`,
    [organizationId, userId, action, JSON.stringify(detail)],
  ).catch(() => {
    // An audit failure must not prevent a legitimate sign-in, nor leak through
    // as a different response than a failed one.
  });
}

export function createSessionRouter(pool: Pool): Router {
  const router = Router();

  router.post('/session', (request: Request, response: Response, next) => {
    void (async () => {
      try {
        const secret = process.env.CHIME_ADMIN_SESSION_SECRET;
        if (!secret || secret.length < 32) {
          throw new AdminApiError(
            503,
            'SESSION_NOT_CONFIGURED',
            'Administrator sign-in is not configured on this server.',
          );
        }

        const email = typeof request.body?.email === 'string' ? request.body.email.trim() : '';
        const password = typeof request.body?.password === 'string' ? request.body.password : '';
        if (!email || !password) {
          throw new AdminApiError(400, 'CREDENTIALS_REQUIRED', 'Enter your email and password.');
        }

        const found = await pool.query<CredentialRow>(
          `SELECT u.id AS user_id,
                  u.email,
                  c.password_hash,
                  COALESCE(c.failed_attempts, 0) AS failed_attempts,
                  c.locked_until,
                  m.organization_id,
                  m.role
             FROM chime_app.users u
             LEFT JOIN chime_app.user_credentials c ON c.user_id = u.id
             LEFT JOIN chime_app.memberships m ON m.user_id = u.id
             LEFT JOIN chime_app.organizations o
                    ON o.id = m.organization_id AND o.status = 'active'
            WHERE lower(u.email) = lower($1)
              AND u.status = 'active'
            ORDER BY (o.id IS NOT NULL) DESC
            LIMIT 1`,
          [email],
        );
        const account = found.rows[0];

        if (account?.locked_until && account.locked_until > new Date()) {
          throw new AdminApiError(
            429,
            'ACCOUNT_LOCKED',
            `Too many failed attempts. Try again after ${account.locked_until.toISOString()}.`,
          );
        }

        // Verify even when the account or its password is missing, so a
        // non-existent email does not answer faster than a real one. This must
        // parse and have the same shape as a real hash — 16-byte salt, 64-byte
        // key, current work factors — or verifyPassword rejects it early and
        // the timing difference becomes an account-enumeration oracle.
        const encoded = account?.password_hash ?? DUMMY_HASH;
        const matched = await verifyPassword(password, encoded);
        const usable = Boolean(account?.password_hash && account.organization_id && account.role);

        if (!matched || !usable) {
          // Residual timing note: a known account also performs an attempt
          // update and an audit insert here, which an unknown one skips. The
          // dominant cost — the scrypt derivation above — is now equal, so the
          // remainder is a few milliseconds of local writes, well inside
          // network jitter. Equalizing it fully would mean writing rows for
          // addresses that do not exist.
          if (account?.password_hash) {
            await recordAttempt(pool, account.user_id, false);
          }
          await writeAudit(
            pool,
            account?.organization_id ?? null,
            account?.user_id ?? null,
            'session.sign_in_failed',
            { email, address: clientAddress(request) },
          );
          throw new AdminApiError(401, 'INVALID_CREDENTIALS', REJECTION);
        }

        if (!ADMIN_ROLES.includes(account.role as AdminRole)) {
          throw new AdminApiError(403, 'MEMBERSHIP_REQUIRED', 'This account has no access to a Chime organization.');
        }

        await recordAttempt(pool, account.user_id, true);

        const now = Math.floor(Date.now() / 1000);
        const expiresAt = now + Math.round(sessionHours() * 60 * 60);
        const token = signAdminSession({
          subject: account.user_id,
          organizationId: account.organization_id as string,
          role: account.role as AdminRole,
          email: account.email,
          expiresAt,
        }, secret);

        await writeAudit(
          pool,
          account.organization_id,
          account.user_id,
          'session.signed_in',
          { address: clientAddress(request) },
        );

        response.json({
          token,
          expiresAt: new Date(expiresAt * 1000).toISOString(),
          user: {
            id: account.user_id,
            email: account.email,
            organizationId: account.organization_id,
            role: account.role,
          },
          workspace: describeWorkspace(),
        });
      } catch (error) {
        next(error);
      }
    })();
  });

  return router;
}
