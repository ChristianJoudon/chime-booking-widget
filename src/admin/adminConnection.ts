/**
 * The single source of truth for how the admin studio reaches the Chime admin API.
 *
 * Three modules used to resolve this independently, from three different sets of
 * environment variable names. serviceStudioDirectory never read the documented
 * VITE_CHIME_ADMIN_TOKEN at all, so a correctly configured workspace could still
 * fall back to demo staff and zero locations. Everything now goes through here.
 *
 * Token resolution order, first match wins:
 *
 *   1. the session created by signing in — the normal path
 *   2. window.CHIME_ADMIN_CONFIG, injected at runtime by a host page
 *
 * There is deliberately no environment path for a token. See the note on
 * envApiUrl below, and ISOLATION.md.
 */

import { readSession } from './adminSession';

export interface AdminConnection {
  /** Normalized, no trailing slash, always ending in /api/chime/admin. */
  baseUrl: string;
  token: string;
  /** Where the values came from, for display in the workspace indicator. */
  source: 'session' | 'runtime';
}

/** Accepted aliases, kept so an existing host page keeps working. */
interface RuntimeAdminConfig {
  baseUrl?: string;
  apiBaseUrl?: string;
  apiUrl?: string;
  token?: string;
  accessToken?: string;
  sessionToken?: string;
}

declare global {
  interface Window {
    CHIME_ADMIN_CONFIG?: RuntimeAdminConfig;
  }
}

const API_SUFFIX = '/api/chime/admin';

/**
 * Accepts either a bare origin or a full admin API URL and always returns the
 * full form, so callers can append paths without guessing.
 */
export function normalizeBaseUrl(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, '');
  if (!trimmed) return '';
  return new RegExp(`${API_SUFFIX}$`, 'i').test(trimmed)
    ? trimmed
    : `${trimmed}${API_SUFFIX}`;
}

/**
 * NOTHING SECRET MAY EVER BE PUT IN A VITE_* VARIABLE IN THIS PROJECT.
 *
 * The admin bundle reaches src/lib/widgetConfig.ts through WidgetStudio's live
 * preview of the booking app, and that module does a bare `import.meta.env`
 * read. A bare read makes Vite inline the ENTIRE env object — every VITE_*
 * value — into the bundle as a plain object literal. No amount of care on this
 * side prevents it: a `import.meta.env.DEV` guard, static property access, and
 * dead-code elimination were all tried, and the value still shipped, because
 * it is that other module pulling the object in, not this one.
 *
 * widgetConfig.ts belongs to the booking widget and is not ours to change.
 *
 * The API address below is deliberately not a secret. There is no environment
 * path for a token at all: administrators sign in.
 */
function envApiUrl(): string {
  return (import.meta.env.VITE_CHIME_ADMIN_API_URL ?? '').trim();
}

/**
 * Where the API lives, independent of who is signed in. Needed by the login
 * screen, which has no session yet.
 */
export function resolveAdminBaseUrl(): string {
  const runtime = typeof window === 'undefined' ? undefined : window.CHIME_ADMIN_CONFIG;
  const candidate = runtime?.baseUrl ?? runtime?.apiBaseUrl ?? runtime?.apiUrl
    ?? envApiUrl();
  return candidate ? normalizeBaseUrl(candidate) : '';
}

export function resolveAdminConnection(): AdminConnection | null {
  const baseUrl = resolveAdminBaseUrl();
  if (!baseUrl) return null;

  // 1. A session obtained by signing in. This is the normal path.
  const session = readSession();
  if (session) {
    return { baseUrl, token: session.token, source: 'session' };
  }

  // 2. A token injected at runtime by the host page.
  const runtime = typeof window === 'undefined' ? undefined : window.CHIME_ADMIN_CONFIG;
  const runtimeToken = runtime?.token ?? runtime?.accessToken ?? runtime?.sessionToken ?? '';
  if (runtimeToken) {
    return { baseUrl, token: runtimeToken, source: 'runtime' };
  }

  return null;
}

/**
 * Why the studio cannot reach the API, in language an administrator can act on.
 * Returns null when the connection is fine.
 */
export function describeMissingConnection(): string | null {
  if (resolveAdminConnection()) return null;
  if (!resolveAdminBaseUrl()) {
    return 'No Chime API address is configured. Set VITE_CHIME_ADMIN_API_URL in config/admin/.env.local, then restart the dev server.';
  }
  return 'You are not signed in to Chime. Sign in to continue.';
}

/**
 * Call this rather than caching the result: signing in creates a session after
 * these modules have already been evaluated, and signing out removes it. A
 * module-level constant would be stale in both directions.
 */
export function getAdminConnection(): AdminConnection | null {
  return resolveAdminConnection();
}
