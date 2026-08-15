import React from 'react';
import ReactDOM from 'react-dom/client';

import AdminApp from './AdminApp';
import './admin.css';

const mountNode = document.getElementById('chime-admin-root');

if (!mountNode) {
  throw new Error('Unable to find the Chime admin mount node.');
}

ReactDOM.createRoot(mountNode).render(
  <React.StrictMode>
    <AdminApp />
  </React.StrictMode>,
);
