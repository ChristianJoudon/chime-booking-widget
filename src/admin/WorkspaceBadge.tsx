import { useEffect, useState } from 'react';

import type { AdminApiClient, AdminWorkspaceRuntime } from './adminApi';
import './workspaceBadge.css';

interface WorkspaceBadgeProps {
  api: AdminApiClient;
}

const LABELS: Record<AdminWorkspaceRuntime['environment'], string> = {
  demo: 'Demo workspace',
  test: 'Test workspace',
  live: 'Live workspace',
};

/**
 * Persistent indicator of which workspace this is, shown on every admin screen.
 *
 * Without it, a sandboxed message and a real one look identical once sent, and
 * an administrator has to remember which environment they opened. It also
 * states the two things that decide whether an action can cause real-world
 * effects: whether messages can reach people, and whether cards can be charged.
 */
export default function WorkspaceBadge({ api }: WorkspaceBadgeProps) {
  const [workspace, setWorkspace] = useState<AdminWorkspaceRuntime | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!api.configured) return;
    let cancelled = false;
    void api.getSession()
      .then((session) => { if (!cancelled) setWorkspace(session.workspace); })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [api]);

  if (!api.configured || failed) {
    // Not knowing the environment is itself worth surfacing: an administrator
    // should never assume "probably demo".
    return (
      <div className="workspace-badge workspace-badge--unknown" role="status">
        <i aria-hidden="true" />
        <span>
          <strong>Workspace unknown</strong>
          <small>Chime is not connected, so the environment cannot be confirmed.</small>
        </span>
      </div>
    );
  }

  if (!workspace) {
    return (
      <div className="workspace-badge workspace-badge--loading" role="status">
        <i aria-hidden="true" />
        <span><strong>Checking workspace...</strong></span>
      </div>
    );
  }

  const { environment, notifications, payments, summary } = workspace;
  const reach = notifications.canReachRealPeople ? 'Messages send' : 'Messages sandboxed';
  const cards = payments.canChargeRealCards
    ? 'Live cards'
    : payments.demoIdentifiersAccepted
      ? 'Demo payments'
      : payments.mode === 'test'
        ? 'Test cards'
        : 'No payments';

  return (
    <div
      className={`workspace-badge workspace-badge--${environment}`}
      role="status"
      title={summary}
    >
      <i aria-hidden="true" />
      <span>
        <strong>{LABELS[environment]}</strong>
        <small>{reach} &middot; {cards}</small>
      </span>
    </div>
  );
}
