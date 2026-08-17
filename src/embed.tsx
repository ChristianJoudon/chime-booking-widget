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
      <App />
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
