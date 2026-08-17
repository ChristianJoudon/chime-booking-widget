import { normalizeBaseUrl } from './adminConnection';

/**
 * Where the administrator session lives in the browser.
 *
 * sessionStorage, not localStorage: the session ends with the tab, so a shared
 * or unattended machine does not keep an administrator signed in indefinitely.
 * It is also per-origin and not sent automatically with any request, unlike a
 * cookie, so there is nothing for a cross-site request to ride on.
 *
 * The token is still a bearer credential held by JavaScript, which an XSS bug
 * could read. The httpOnly-cookie alternative needs CSRF protection and a
 * same-site story for the embed; that is the next step, not this one.
 */

const STORAGE_KEY = 'chime.admin.session';

export interface StoredSession {
  token: string;
  /** ISO timestamp. Checked before use so an expired session shows the login screen. */
  expiresAt: string;
  email: string;
  role: string;
  organizationId: string;
}

function isExpired(session: StoredSession): boolean {
  const at = Date.parse(session.expiresAt);
  return !Number.isFinite(at) || at <= Date.now();
}

export function readSession(): StoredSession | null {
  if (typeof sessionStorage === 'undefined') return null;
  const raw = sessionStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<StoredSession>;
    if (typeof parsed.token !== 'string' || typeof parsed.expiresAt !== 'string') return null;
    const session = parsed as StoredSession;
    if (isExpired(session)) {
      sessionStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return session;
  } catch {
    sessionStorage.removeItem(STORAGE_KEY);
    return null;
  }
}

export function writeSession(session: StoredSession): void {
  if (typeof sessionStorage === 'undefined') return;
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(session));
}

export function clearSession(): void {
  if (typeof sessionStorage === 'undefined') return;
  sessionStorage.removeItem(STORAGE_KEY);
}

export interface SignInResult {
  ok: boolean;
  /** Present when ok is false; already phrased for an administrator. */
  message?: string;
}

/**
 * Exchanges a password for a session. The password is used for this one
 * request and never stored.
 */
export async function signIn(
  baseUrl: string,
  email: string,
  password: string,
): Promise<SignInResult> {
  let response: Response;
  try {
    response = await fetch(`${normalizeBaseUrl(baseUrl)}/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ email, password }),
    });
  } catch {
    return { ok: false, message: `Chime did not respond at ${baseUrl}. Check that the admin API is running.` };
  }

  const body = await response.json().catch(() => null) as {
    token?: string;
    expiresAt?: string;
    user?: { email: string; role: string; organizationId: string };
    error?: { message?: string };
  } | null;

  if (!response.ok || !body?.token || !body.user) {
    return { ok: false, message: body?.error?.message ?? `Sign-in failed (${response.status}).` };
  }

  writeSession({
    token: body.token,
    expiresAt: body.expiresAt ?? new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    email: body.user.email,
    role: body.user.role,
    organizationId: body.user.organizationId,
  });
  return { ok: true };
}

/**
 * Lets the shell learn that a request was rejected as unauthenticated, so it
 * can return to the login screen. A plain callback rather than an event bus:
 * there is exactly one subscriber and it lives for the life of the page.
 */
type SessionEndedListener = () => void;
let sessionEndedListener: SessionEndedListener | null = null;

export function onSessionEnded(listener: SessionEndedListener | null): void {
  sessionEndedListener = listener;
}

export function notifySessionEnded(): void {
  sessionEndedListener?.();
}
