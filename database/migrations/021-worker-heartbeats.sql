-- A place for background workers to say they are still running.
--
-- The notification worker has no port and no request log. When it dies, or
-- wedges on a query that never returns, nothing visible changes: the API keeps
-- answering, the studio keeps loading, and confirmations and reminders simply
-- stop being sent. The first person to notice is a customer who did not get
-- their reminder, which is days later and too late.
--
-- So the worker writes here at the end of every cycle, and the health endpoints
-- read it. A missing beat is the signal.
--
-- One row per worker, not an append-only log. What matters operationally is
-- "when did it last complete a cycle", and keeping only that answer means this
-- table never needs pruning.

BEGIN;

CREATE TABLE IF NOT EXISTS chime_app.worker_heartbeats (
  worker text PRIMARY KEY,
  -- Set once when the process starts, so a restart loop is visible as a
  -- started_at that keeps moving while cycles keeps resetting to zero.
  started_at timestamptz NOT NULL,
  last_beat_at timestamptz NOT NULL,
  -- The worker's own poll interval, recorded by the worker. A reader deciding
  -- whether a beat is late needs to know what "on time" was, and only the
  -- worker knows how it was configured.
  interval_seconds integer NOT NULL CHECK (interval_seconds > 0),
  cycles bigint NOT NULL DEFAULT 0,
  -- A worker that catches its own errors and keeps looping stays alive but
  -- stops doing its job. The beat alone cannot tell those apart, so the last
  -- failure travels with it.
  last_error text,
  last_error_at timestamptz,
  hostname text,
  pid integer,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT worker_heartbeats_error_pair CHECK (
    (last_error IS NULL) = (last_error_at IS NULL)
  )
);

COMMENT ON TABLE chime_app.worker_heartbeats IS
  'One row per background worker, rewritten each cycle. Absence of a recent beat means the worker is not running.';

COMMIT;
