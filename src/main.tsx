import React from 'react';
import ReactDOM from 'react-dom/client';
import App from '@/App';
import '@/index.css';

const mountNode =
  document.getElementById('chime-widget-root') ?? document.getElementById('root');

if (!mountNode) {
  throw new Error('Unable to find a widget mount node. Add #chime-widget-root or #root.');
}

ReactDOM.createRoot(mountNode).render(
  <React.StrictMode>
    <App variant="fullpage" />
  </React.StrictMode>,
);
