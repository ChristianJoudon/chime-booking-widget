/* eslint-disable @typescript-eslint/no-namespace */
import { createHmac, timingSafeEqual } from 'node:crypto';

import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { Pool } from 'pg';

import {
  ADMIN_ROLES,
  AdminApiError,
  type AdminRole,
  type AdminSessionClaims,
} from './types.js';

declare global {
  namespace Express {
    interface Request {
      chimeAdminSession?: AdminSessionClaims;
      chimeRequestId?: string;
    }
  }
}

const TOKEN_ISSUER = 'chime-admin';

function encodeJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

function signatureFor(payload: string, secret: string): Buffer {
  return createHmac('sha256', secret).update(payload).digest();
}

function isAdminRole(value: unknown): value is AdminRole {
  return typeof value === 'string' && ADMIN_ROLES.includes(value as AdminRole);
}

function validateClaims(value: unknown): AdminSessionClaims {
  if (!value || typeof value !== 'object') {
    throw new AdminApiError(401, 'INVALID_SESSION', 'Administrator session is invalid.');
  }

  const claims = value as Partial<AdminSessionClaims>;
  if (
    claims.issuer !== TOKEN_ISSUER
    || typeof claims.subject !== 'string'
    || typeof claims.organizationId !== 'string'
    || !isAdminRole(claims.role)
    || typeof claims.email !== 'string'
    || typeof claims.issuedAt !== 'number'
    || typeof claims.expiresAt !== 'number'
  ) {
    throw new AdminApiError(401, 'INVALID_SESSION', 'Administrator session is malformed.');
  }

  if (claims.expiresAt <= Math.floor(Date.now() / 1000)) {
    throw new AdminApiError(401, 'SESSION_EXPIRED', 'Administrator session has expired.');
  }

  return claims as AdminSessionClaims;
}

export function signAdminSession(
  claims: Omit<AdminSessionClaims, 'issuer' | 'issuedAt'> & { issuedAt?: number },
  secret: string,
): string {
  if (secret.length < 32) {
    throw new Error('CHIME_ADMIN_SESSION_SECRET must contain at least 32 characters.');
  }

  const payload = encodeJson({
    ...claims,
    issuer: TOKEN_ISSUER,
    issuedAt: claims.issuedAt ?? Math.floor(Date.now() / 1000),
  });
  return `${payload}.${signatureFor(payload, secret).toString('base64url')}`;
}

export function verifyAdminSession(token: string, secret: string): AdminSessionClaims {
  const [payload, providedSignature, extra] = token.split('.');
  if (!payload || !providedSignature || extra) {
    throw new AdminApiError(401, 'INVALID_SESSION', 'Administrator session is invalid.');
  }

  const expected = signatureFor(payload, secret);
  const provided = Buffer.from(providedSignature, 'base64url');
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    throw new AdminApiError(401, 'INVALID_SESSION', 'Administrator session signature is invalid.');
  }

  try {
    return validateClaims(JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')));
  } catch (error) {
    if (error instanceof AdminApiError) throw error;
    throw new AdminApiError(401, 'INVALID_SESSION', 'Administrator session payload is invalid.');
  }
}

function bearerToken(request: Request): string {
  const authorization = request.get('authorization');
  if (!authorization?.startsWith('Bearer ')) {
    throw new AdminApiError(401, 'SESSION_REQUIRED', 'A signed administrator session is required.');
  }
  return authorization.slice('Bearer '.length).trim();
}

async function authenticateRequest(
  request: Request,
  response: Response,
  next: NextFunction,
  pool: Pool,
) {
  try {
    const secret = process.env.CHIME_ADMIN_SESSION_SECRET;
    if (!secret || secret.length < 32) {
      throw new AdminApiError(503, 'SESSION_NOT_CONFIGURED', 'Administrator sessions are not configured.');
    }

    const tokenClaims = verifyAdminSession(bearerToken(request), secret);
    const membership = await pool.query<{
      role: AdminRole;
      email: string;
    }>(
      `SELECT m.role, u.email
         FROM chime_app.memberships m
         JOIN chime_app.users u ON u.id = m.user_id
         JOIN chime_app.organizations o ON o.id = m.organization_id
        WHERE m.organization_id = $1
          AND m.user_id = $2
          AND u.status = 'active'
          AND o.status = 'active'`,
      [tokenClaims.organizationId, tokenClaims.subject],
    );

    const current = membership.rows[0];
    if (!current || !isAdminRole(current.role)) {
      throw new AdminApiError(403, 'MEMBERSHIP_REQUIRED', 'This user no longer has access to the organization.');
    }

    request.chimeAdminSession = {
      ...tokenClaims,
      role: current.role,
      email: current.email,
    };
    next();
  } catch (error) {
    next(error);
  }
}

export function requireAdminSession(pool: Pool): RequestHandler {
  return (request, response, next) => {
    void authenticateRequest(request, response, next, pool);
  };
}

export function requireRoles(...roles: readonly AdminRole[]): RequestHandler {
  return (request, _response, next) => {
    try {
      const session = getAdminSession(request);
      if (!roles.includes(session.role)) {
        throw new AdminApiError(403, 'ROLE_REQUIRED', 'Your role cannot make this change.');
      }
      next();
    } catch (error) {
      next(error);
    }
  };
}

export function getAdminSession(request: Request): AdminSessionClaims {
  if (!request.chimeAdminSession) {
    throw new AdminApiError(401, 'SESSION_REQUIRED', 'Administrator session is required.');
  }
  return request.chimeAdminSession;
}
