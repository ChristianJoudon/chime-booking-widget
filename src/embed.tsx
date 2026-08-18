import React from 'react';
import ReactDOM from 'react-dom/client';
import App from '@/App';
import type { WidgetConfigInput } from '@/types/widget';
import { isolate } from './embedIsolation';
// Still imported for its side effect so the build keeps emitting
// chime-widget.css. Embed snippets already in the wild link that file, and a
// 404 in a customer's console is a poor way to ship an improvement. Nothing
// inside a shadow root reads it — embedIsolation injects its own copy.
import '@/index.css';

/**
 * Mount the booking widget into a host page element.
 *
 * @param target A CSS selector or the element itself.
 * @param config Optional widget config; assigned to `window.CHIME_WIDGET_CONFIG`
 *   before the widget renders.
 */
/*
 * Read from the page at runtime, never from a build-time variable.
 *
 * A VITE_ variable would be inlined into this bundle and copied onto every
 * customer's website — src/lib/widgetConfig.ts does a bare `import.meta.env`
 * read, so Vite bakes the whole env object in, and vite.embed.config.ts loads
 * the repository root. window.CHIME_WIDGET_CONFIG is the contract host pages
 * already use for everything else the widget needs to know.
 */
type HostConfig = { sentryDsn?: unknown; supportLine?: unknown };

function readHostConfig(): HostConfig {
  try {
    return ((window as unknown as { CHIME_WIDGET_CONFIG?: HostConfig }).CHIME_WIDGET_CONFIG) ?? {};
  } catch {
    return {};
  }
}

function readWidgetSupportLine(): string | null {
  const value = readHostConfig().supportLine;
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/*
 * Nothing is loaded, requested or reported unless the host page asked for it.
 *
 * This runs on other people's websites. The SDK arrives through a dynamic
 * import, so a site that sets no DSN downloads none of it, and a site that sets
 * one but blocks the request carries on with a booking form that works.
 */
function startWidgetReporting(): void {
  const dsn = readHostConfig().sentryDsn;
  if (typeof dsn !== 'string' || !dsn.trim()) return;
  void initBrowserReporting({ dsn, surface: 'booking-widget' }).then((on) => {
    if (!on) return;
    window.addEventListener('error', (event) => {
      reportBrowserError(event.error ?? event.message, { surface: 'booking-widget', kind: 'uncaught' });
    });
    window.addEventListener('unhandledrejection', (event) => {
      reportBrowserError(event.reason, { surface: 'booking-widget', kind: 'unhandledRejection' });
    });
  });
}

startWidgetReporting();

export function mount(
  target: string | HTMLElement,
  config?: WidgetConfigInput,
): { unmount: () => void } {
  const element =
    typeof target === 'string' ? document.querySelector<HTMLElement>(target) : target;

  if (!element) {
    throw new Error(
      `ChimeWidget.mount: no element found for selector "${String(target)}". ` +
        'Add the element to the page before calling mount.',
    );
  }

  if (config) {
    window.CHIME_WIDGET_CONFIG = config;
  }

  element.setAttribute('data-chime-mounted', 'true');

  // Rendered inside a shadow root rather than directly into the host's element,
  // so the host page's stylesheet cannot reach the widget at all.
  const container = isolate(element);

  const root = ReactDOM.createRoot(container);
  root.render(
    <React.StrictMode>
      {/*
        * A booking form that fails silently is a lost customer who thinks the
        * business is shut. Whatever else breaks, the phone number stays on
        * screen — the host page supplies it in the same configuration object
        * everything else here comes from.
        */}
      <ErrorBoundary
        surface="booking-widget"
        fallback={(retry) => (
          <div className="chime-widget chime-crash" role="alert">
            <h2>This booking form could not load</h2>
            <p>
              {readWidgetSupportLine()
                ?? 'Please contact the business directly to make your appointment.'}
            </p>
            <button type="button" onClick={retry}>Try again</button>
          </div>
        )}
      >
        <App />
      </ErrorBoundary>
    </React.StrictMode>,
  );

  return {
    unmount: () => {
      root.unmount();
      element.removeAttribute('data-chime-mounted');
    },
  };
}

/**
 * Mount the widget into every default target on the page that has not been
 * mounted yet. Returns how many widgets were mounted.
 */
export function autoMount(): number {
  const targets = document.querySelectorAll<HTMLElement>(
    '#chime-widget-root:not([data-chime-mounted]), [data-chime-widget]:not([data-chime-mounted])',
  );

  // Counts what actually mounted rather than what matched. Those were the same
  // number while mountConfiguredElement could not decline; it can now, for an
  // element that cannot host the widget, and "returns how many widgets were
  // mounted" should stay true.
  let mounted = 0;
  targets.forEach((element) => {
    if (mountConfiguredElement(element, mount, isolate)) mounted += 1;
  });

  return mounted;
}

window.ChimeWidget = { mount, autoMount };

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    autoMount();
  });
} else {
  autoMount();
}
import { mountConfiguredElement } from './embedPresentation';
import { ErrorBoundary } from './observability/ErrorBoundary';
import { initBrowserReporting, reportBrowserError } from './observability/browserReporting';
