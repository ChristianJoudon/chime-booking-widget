BEGIN;

CREATE INDEX IF NOT EXISTS appointments_business_period_idx
  ON chime_app.appointments (organization_id, starts_at DESC, status);

CREATE INDEX IF NOT EXISTS appointments_business_customer_period_idx
  ON chime_app.appointments (organization_id, customer_id, starts_at DESC);

CREATE INDEX IF NOT EXISTS appointments_business_service_period_idx
  ON chime_app.appointments (organization_id, service_id, starts_at DESC);

CREATE INDEX IF NOT EXISTS payments_business_period_idx
  ON chime_app.payments (organization_id, updated_at DESC, status);

CREATE INDEX IF NOT EXISTS customers_business_created_idx
  ON chime_app.customers (organization_id, created_at DESC);

COMMIT;
