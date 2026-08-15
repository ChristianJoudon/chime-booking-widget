import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import ApprovalApp from './ApprovalApp';
import './approval.css';

createRoot(document.getElementById('approval-root')!).render(
  <StrictMode>
    <ApprovalApp />
  </StrictMode>,
);
