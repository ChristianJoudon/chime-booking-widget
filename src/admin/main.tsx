import React from 'react';
import ReactDOM from 'react-dom/client';

import AdminApp from './AdminApp';
import { ErrorBoundary } from '../observability/ErrorBoundary';
import { initBrowserReporting, reportBrowserError } from '../observability/browserReporting';
import './admin.css';

const mountNode = document.getElementById('chime-admin-root');

if (!mountNode) {
  throw new Error('Unable to find the Chime admin mount node.');
}

/*
 * Safe here, and only here.
 *
 * vite.admin.config.ts scopes envDir to config/admin, so this variable cannot
 * reach the customer widget's bundle. The same variable placed at the
 * repository root would be inlined into dist-embed/chime-widget.js and copied
 * onto every site that embeds the booking page — see browserReporting.ts.
 */
void initBrowserReporting({
  dsn: import.meta.env.VITE_CHIME_SENTRY_DSN,
  surface: 'admin-studio',
  environment: import.meta.env.MODE,
});

window.addEventListener('error', (event) => {
  reportBrowserError(event.error ?? event.message, { surface: 'admin-studio', kind: 'uncaught' });
});
window.addEventListener('unhandledrejection', (event) => {
  reportBrowserError(event.reason, { surface: 'admin-studio', kind: 'unhandledRejection' });
});

ReactDOM.createRoot(mountNode).render(
  <React.StrictMode>
    <ErrorBoundary
      surface="admin-studio"
      fallback={(retry) => (
        <div className="admin-crash" role="alert">
          <h1>Chime hit a problem</h1>
          <p>
            The screen you were on could not be drawn. Nothing you had saved is affected — this is
            the studio failing to display, not your appointments failing to exist.
          </p>
          <button type="button" onClick={retry}>Try that screen again</button>
          <button type="button" onClick={() => window.location.reload()}>Reload Chime</button>
        </div>
      )}
    >
      <AdminApp />
    </ErrorBoundary>
  </React.StrictMode>,
);
