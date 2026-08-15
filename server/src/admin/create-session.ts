import 'dotenv/config';

import { signAdminSession } from './auth.js';
import { ADMIN_ROLES, type AdminRole } from './types.js';

const secret = process.env.CHIME_ADMIN_SESSION_SECRET;
const organizationId = process.env.CHIME_ADMIN_ORGANIZATION_ID;
const userId = process.env.CHIME_ADMIN_USER_ID;
const email = process.env.CHIME_ADMIN_USER_EMAIL ?? 'owner@chime.local';
const role = (process.env.CHIME_ADMIN_USER_ROLE ?? 'owner') as AdminRole;
const hours = Number(process.env.CHIME_ADMIN_SESSION_HOURS ?? 12);

if (!secret || !organizationId || !userId) {
  throw new Error('CHIME_ADMIN_SESSION_SECRET, CHIME_ADMIN_ORGANIZATION_ID, and CHIME_ADMIN_USER_ID are required.');
}
if (!ADMIN_ROLES.includes(role)) {
  throw new Error(`CHIME_ADMIN_USER_ROLE must be one of: ${ADMIN_ROLES.join(', ')}.`);
}
if (!Number.isFinite(hours) || hours <= 0 || hours > 168) {
  throw new Error('CHIME_ADMIN_SESSION_HOURS must be between 1 and 168.');
}

const now = Math.floor(Date.now() / 1000);
const token = signAdminSession({
  subject: userId,
  organizationId,
  role,
  email,
  expiresAt: now + Math.round(hours * 60 * 60),
}, secret);

console.log(token);
