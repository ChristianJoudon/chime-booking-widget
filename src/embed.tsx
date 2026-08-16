import React from 'react';
import ReactDOM from 'react-dom/client';
import App from '@/App';
import type { WidgetConfigInput } from '@/types/widget';
import '@/index.css';

/**
 * Mount the booking widget into a host page element.
 *
 * @param target A CSS selector or the element itself.
 * @param config Optional widget config; assigned to `window.CHIME_WIDGET_CONFIG`
 *   before the widget renders.
 */
export function mount(
  target: string | Element,
  config?: WidgetConfigInput,
): { unmount: () => void } {
  const element =
    typeof target === 'string' ? document.querySelector(target) : target;

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

  const root = ReactDOM.createRoot(element);
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

  targets.forEach((element) => {
    mountConfiguredElement(element, mount);
  });

  return targets.length;
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
