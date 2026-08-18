/*
 * Error reporting in a browser, off until a DSN turns up at runtime.
 *
 * Two surfaces use this and they get their DSN from different places, for a
 * reason worth stating plainly.
 *
 * The administrator studio reads a build-time variable. That is safe because
 * vite.admin.config.ts scopes envDir to config/admin, so the value cannot reach
 * any other bundle.
 *
 * The customer widget does NOT, and must not. src/lib/widgetConfig.ts does a
 * bare `import.meta.env` read, which makes Vite inline the *entire* env object
 * into dist-embed/chime-widget.js as a literal — it is visible in the shipped
 * file today as `{BASE_URL:"/",DEV:!1,...}`. vite.embed.config.ts sets no
 * envDir, so it loads the repository root. Any VITE_ variable placed there
 * would be copied onto every customer's website whether or not the widget reads
 * it. The widget therefore takes its DSN at runtime, from the configuration the
 * host page already supplies.
 *
 * The SDK is loaded with a dynamic import, so a page with no DSN downloads none
 * of it. That matters most for the widget, which runs on other people's sites:
 * with reporting off the cost of this module is a few hundred bytes and one
 * comparison.
 */

let started = false;
let client: typeof import('@sentry/browser') | null = null;

/*
 * The same rule the server uses: nothing about a person leaves the page.
 *
 * On the widget a report could otherwise carry the name, email and phone
 * someone has half-typed into the booking form, straight out of the DOM or the
 * URL. On the studio it could carry a customer's details from whichever record
 * was open. Neither is worth knowing which line threw.
 */
function scrub(event: Record<string, unknown>): Record<string, unknown> | null {
  const request = event.request as Record<string, unknown> | undefined;
  if (request) {
    delete request.data;
    delete request.cookies;
    if (typeof request.url === 'string') request.url = request.url.split('?')[0];
    delete request.query_string;
  }
  // Breadcrumbs are the quiet leak: the SDK records every input the person
  // touched and every URL they visited, and on a booking form that is the whole
  // of what they typed.
  delete event.breadcrumbs;
  delete event.user;
  return event;
}

export type BrowserReportingOptions = {
  dsn: string | undefined;
  surface: 'admin-studio' | 'booking-widget';
  release?: string;
  environment?: string;
};

export async function initBrowserReporting(options: BrowserReportingOptions): Promise<boolean> {
  const dsn = options.dsn?.trim();
  if (!dsn || started) return false;
  try {
    const Sentry = await import('@sentry/browser');
    Sentry.init({
      dsn,
      environment: options.environment ?? 'unknown',
      release: options.release,
      // Errors only, and none of the SDK's default instrumentation that watches
      // what a person clicks and types.
      tracesSampleRate: 0,
      sendDefaultPii: false,
      defaultIntegrations: false,
      integrations: [],
      beforeSend: (event) => scrub(event as unknown as Record<string, unknown>) as never,
      initialScope: { tags: { surface: options.surface } },
    });
    client = Sentry;
    started = true;
    return true;
  } catch {
    // A page that cannot load its reporting SDK is a page that carries on
    // without it. This runs on other people's websites, where a blocked request
    // to a third-party host is an ordinary Tuesday.
    return false;
  }
}

export function isBrowserReportingOn(): boolean {
  return started;
}

/** Never throws. Reporting a fault must not become one. */
export function reportBrowserError(error: unknown, context: Record<string, string> = {}): void {
  if (!started || !client) return;
  try {
    client.withScope((scope) => {
      for (const [key, value] of Object.entries(context)) scope.setTag(key, value);
      client?.captureException(error);
    });
  } catch {
    // Nothing useful left to do here.
  }
}

/** Exported for the smoke test, which checks what the scrub actually removes. */
export const scrubForTests = scrub;
