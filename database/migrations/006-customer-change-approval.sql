BEGIN;

CREATE TABLE IF NOT EXISTS chime_app.customer_action_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES chime_app.organizations(id) ON DELETE CASCADE,
  appointment_id uuid NOT NULL,
  change_request_id uuid NOT NULL,
  customer_id uuid NOT NULL,
  purpose text NOT NULL CHECK (purpose IN ('change_decision')),
  token_hash character(64) NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  revoked_at timestamptz,
  decision text CHECK (decision IS NULL OR decision IN ('approve', 'decline')),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, appointment_id)
    REFERENCES chime_app.appointments(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, change_request_id)
    REFERENCES chime_app.appointment_change_requests(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, customer_id)
    REFERENCES chime_app.customers(organization_id, id) ON DELETE CASCADE,
  CHECK (used_at IS NULL OR decision IS NOT NULL),
  CHECK (NOT (used_at IS NOT NULL AND revoked_at IS NOT NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_chime_customer_action_one_live_change
  ON chime_app.customer_action_tokens (organization_id, change_request_id)
  WHERE used_at IS NULL AND revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_chime_customer_action_expiry
  ON chime_app.customer_action_tokens (expires_at)
  WHERE used_at IS NULL AND revoked_at IS NULL;

COMMIT;
