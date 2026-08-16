/**
 * The single source of truth for how the admin studio reaches the Chime admin API.
 *
 * Three modules used to resolve this independently, from three different sets of
 * environment variable names. serviceStudioDirectory never read the documented
 * VITE_CHIME_ADMIN_TOKEN at all, so a correctly configured workspace could still
 * fall back to demo staff and zero locations. Everything now goes through here.
 *
 * Resolution order, first match wins:
 *
 *   1. window.CHIME_ADMIN_CONFIG   — supplied at runtime by the host page
 *   2. VITE_CHIME_ADMIN_API_URL / VITE_CHIME_ADMIN_TOKEN — build-time env
 *
 * Prefer (1). Vite inlines VITE_* values into the JavaScript bundle, so a token
 * provided that way is readable by anyone who can fetch the built asset. See
 * ISOLATION.md.
 */

export interface AdminConnection {
  /** Normalized, no trailing slash, always ending in /api/chime/admin. */
  baseUrl: string;
  token: string;
  /** Where the values came from, for display in the workspace indicator. */
  source: 'runtime' | 'build';
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

function readEnv(key: string): string {
  // import.meta.env is absent when this module is loaded outside Vite.
  const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
  return env?.[key]?.trim() ?? '';
}

export function resolveAdminConnection(): AdminConnection | null {
  const runtime = typeof window === 'undefined' ? undefined : window.CHIME_ADMIN_CONFIG;

  const runtimeBase = runtime?.baseUrl ?? runtime?.apiBaseUrl ?? runtime?.apiUrl ?? '';
  const runtimeToken = runtime?.token ?? runtime?.accessToken ?? runtime?.sessionToken ?? '';
  if (runtimeBase && runtimeToken) {
    return { baseUrl: normalizeBaseUrl(runtimeBase), token: runtimeToken, source: 'runtime' };
  }

  const envBase = readEnv('VITE_CHIME_ADMIN_API_URL');
  const envToken = readEnv('VITE_CHIME_ADMIN_TOKEN');
  if (envBase && envToken) {
    return { baseUrl: normalizeBaseUrl(envBase), token: envToken, source: 'build' };
  }

  return null;
}

/**
 * Why the studio cannot reach the API, in language an administrator can act on.
 * Returns null when the connection is fine.
 */
export function describeMissingConnection(): string | null {
  const runtime = typeof window === 'undefined' ? undefined : window.CHIME_ADMIN_CONFIG;
  const hasBase = Boolean(
    (runtime?.baseUrl ?? runtime?.apiBaseUrl ?? runtime?.apiUrl ?? '') || readEnv('VITE_CHIME_ADMIN_API_URL'),
  );
  const hasToken = Boolean(
    (runtime?.token ?? runtime?.accessToken ?? runtime?.sessionToken ?? '') || readEnv('VITE_CHIME_ADMIN_TOKEN'),
  );

  if (hasBase && hasToken) return null;
  if (!hasBase && !hasToken) {
    return 'This studio has no Chime connection configured. Add VITE_CHIME_ADMIN_API_URL and VITE_CHIME_ADMIN_TOKEN to config/admin/.env.local, then restart the dev server.';
  }
  if (!hasToken) {
    return 'A Chime API address is configured but no administrator session. Run "cd server && npm run session:admin" and put the token in VITE_CHIME_ADMIN_TOKEN in config/admin/.env.local.';
  }
  return 'An administrator session is configured but no Chime API address. Set VITE_CHIME_ADMIN_API_URL in config/admin/.env.local.';
}

/** Resolved once at module load; the values cannot change without a reload. */
export const ADMIN_CONNECTION = resolveAdminConnection();
