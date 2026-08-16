/**
 * What kind of workspace this server is running: demo, test, or live.
 *
 * The tightening plan asks for one global indicator so an administrator can
 * never mistake a sandboxed action for a real one, and so production cannot
 * quietly accept demo-payment identifiers.
 *
 * The environment is derived from the two capabilities that decide whether an
 * action can reach a real person or a real card:
 *
 *   - notification delivery: sandboxed, or actually sending
 *   - payment provider: none, demo identifiers, Stripe test, or Stripe live
 *
 * CHIME_WORKSPACE_ENV overrides the derivation when a deployment wants to be
 * explicit. It is also what makes the production guard meaningful: a server
 * declaring itself live must not accept demo payments.
 */

export type WorkspaceEnvironment = 'demo' | 'test' | 'live';

export interface WorkspaceRuntime {
  environment: WorkspaceEnvironment;
  /** True when the environment was declared rather than inferred. */
  declared: boolean;
  notifications: {
    mode: 'sandbox' | 'live';
    /** Whether a message can actually leave this machine. */
    canReachRealPeople: boolean;
  };
  payments: {
    provider: 'stripe' | 'demo' | 'none';
    mode: 'live' | 'test' | 'demo' | 'unconfigured';
    /** Whether a real card can actually be charged. */
    canChargeRealCards: boolean;
    demoIdentifiersAccepted: boolean;
  };
  /** One sentence an administrator can act on. */
  summary: string;
}

const ENVIRONMENTS: readonly WorkspaceEnvironment[] = ['demo', 'test', 'live'];

function declaredEnvironment(): WorkspaceEnvironment | null {
  const raw = process.env.CHIME_WORKSPACE_ENV?.trim().toLowerCase();
  return raw && ENVIRONMENTS.includes(raw as WorkspaceEnvironment)
    ? raw as WorkspaceEnvironment
    : null;
}

function notificationsLive(): boolean {
  return process.env.CHIME_NOTIFICATION_MODE === 'live'
    && process.env.CHIME_NOTIFICATIONS_LIVE === 'true';
}

function paymentState() {
  const secret = process.env.STRIPE_SECRET_KEY?.trim();
  const demoAccepted = process.env.CHIME_ALLOW_DEMO_PAYMENTS === 'true';
  if (secret) {
    const live = secret.startsWith('sk_live_');
    return {
      provider: 'stripe' as const,
      mode: live ? 'live' as const : 'test' as const,
      canChargeRealCards: live,
      demoIdentifiersAccepted: demoAccepted,
    };
  }
  if (demoAccepted) {
    return {
      provider: 'demo' as const,
      mode: 'demo' as const,
      canChargeRealCards: false,
      demoIdentifiersAccepted: true,
    };
  }
  return {
    provider: 'none' as const,
    mode: 'unconfigured' as const,
    canChargeRealCards: false,
    demoIdentifiersAccepted: false,
  };
}

export function describeWorkspace(): WorkspaceRuntime {
  const payments = paymentState();
  const liveNotifications = notificationsLive();
  const declared = declaredEnvironment();

  // Anything that can reach a real person or a real card is live. Demo payment
  // identifiers mean demo. Everything else is a test workspace.
  const inferred: WorkspaceEnvironment = liveNotifications || payments.canChargeRealCards
    ? 'live'
    : payments.demoIdentifiersAccepted
      ? 'demo'
      : 'test';

  const environment = declared ?? inferred;

  const summary = environment === 'live'
    ? 'Actions here reach real customers and real cards.'
    : environment === 'demo'
      ? 'Demo workspace. Messages are sandboxed and payments use demo identifiers.'
      : 'Test workspace. Messages are sandboxed and no live cards can be charged.';

  return {
    environment,
    declared: declared !== null,
    notifications: {
      mode: liveNotifications ? 'live' : 'sandbox',
      canReachRealPeople: liveNotifications,
    },
    payments,
    summary,
  };
}

/**
 * A workspace declaring itself live must not accept demo payment identifiers.
 * Called at startup so the mistake surfaces before any booking is taken, not
 * after a fake deposit has been accepted as real.
 */
export function assertWorkspaceIsCoherent(): void {
  const declared = declaredEnvironment();
  if (declared === 'live' && process.env.CHIME_ALLOW_DEMO_PAYMENTS === 'true') {
    throw new Error(
      'CHIME_WORKSPACE_ENV=live cannot run with CHIME_ALLOW_DEMO_PAYMENTS=true. '
      + 'Demo payment identifiers would be accepted as real deposits. Unset one of them.',
    );
  }
}
