import { hostname } from 'node:os';

import type { Pool } from 'pg';

/*
 * Recording that a background worker is still alive.
 *
 * The beat is written at the *end* of a cycle, not the start. That is the
 * difference between "the process exists" and "the process is doing its job":
 * a tick wedged on a query that never returns leaves the process running and
 * responsive to signals, but stops the beat, which is exactly the failure we
 * are trying to make visible.
 */

export type HeartbeatState = {
  cycles: number;
  lastError: string | null;
  lastErrorAt: Date | null;
};

export class Heartbeat {
  private readonly startedAt = new Date();
  private cycles = 0;
  private lastError: string | null = null;
  private lastErrorAt: Date | null = null;

  constructor(
    private readonly pool: Pool,
    private readonly worker: string,
    private readonly intervalSeconds: number,
    private readonly detail: Record<string, unknown> = {},
  ) {}

  recordFailure(error: unknown) {
    this.lastError = error instanceof Error ? error.message : String(error);
    this.lastErrorAt = new Date();
  }

  /*
   * Never throws.
   *
   * A worker that crashed because it could not report that it was healthy would
   * be a strictly worse outcome than one that ran unmonitored, so a failed beat
   * is logged and the cycle continues. The absent beat is itself the signal;
   * the health endpoint reads staleness, not a written error.
   */
  async beat(): Promise<void> {
    this.cycles += 1;
    try {
      await this.pool.query(
        `INSERT INTO chime_app.worker_heartbeats
           (worker, started_at, last_beat_at, interval_seconds, cycles,
            last_error, last_error_at, hostname, pid, detail)
         VALUES ($1, $2, now(), $3, $4, $5, $6, $7, $8, $9::jsonb)
         ON CONFLICT (worker) DO UPDATE SET
           started_at = EXCLUDED.started_at,
           last_beat_at = EXCLUDED.last_beat_at,
           interval_seconds = EXCLUDED.interval_seconds,
           cycles = EXCLUDED.cycles,
           last_error = EXCLUDED.last_error,
           last_error_at = EXCLUDED.last_error_at,
           hostname = EXCLUDED.hostname,
           pid = EXCLUDED.pid,
           detail = EXCLUDED.detail`,
        [
          this.worker,
          this.startedAt,
          this.intervalSeconds,
          this.cycles,
          this.lastError,
          this.lastErrorAt,
          hostname(),
          process.pid,
          JSON.stringify(this.detail),
        ],
      );
    } catch (error) {
      console.error('Heartbeat could not be recorded', error);
    }
  }

  state(): HeartbeatState {
    return { cycles: this.cycles, lastError: this.lastError, lastErrorAt: this.lastErrorAt };
  }
}

export type WorkerStatus = {
  worker: string;
  running: boolean;
  lastBeatAt: string | null;
  secondsSinceBeat: number | null;
  intervalSeconds: number | null;
  cycles: number | null;
  startedAt: string | null;
  lastError: string | null;
  lastErrorAt: string | null;
  reason?: string;
};

/*
 * How late a beat has to be before the worker counts as down.
 *
 * Four intervals plus thirty seconds. Generous on purpose: one slow batch, a
 * brief database stall, or a container restart should not page anyone, while a
 * worker that has genuinely stopped is caught within about half a minute of a
 * default five-second poll. A tighter threshold buys nothing — nobody acts on
 * a notification worker being ten seconds behind — and false alarms are how
 * monitoring gets ignored.
 */
export function beatDeadlineSeconds(intervalSeconds: number): number {
  return intervalSeconds * 4 + 30;
}

export async function readWorkerStatus(pool: Pool, worker: string): Promise<WorkerStatus> {
  const { rows } = await pool.query<{
    started_at: Date;
    last_beat_at: Date;
    interval_seconds: number;
    cycles: string;
    last_error: string | null;
    last_error_at: Date | null;
    seconds_since_beat: string;
  }>(
    `SELECT started_at, last_beat_at, interval_seconds, cycles, last_error, last_error_at,
            EXTRACT(EPOCH FROM (now() - last_beat_at)) AS seconds_since_beat
       FROM chime_app.worker_heartbeats
      WHERE worker = $1`,
    [worker],
  );

  const row = rows[0];
  if (!row) {
    // No row at all means the worker has never run against this database. That
    // is reported as down rather than unknown: on a deployment where reminders
    // are expected, a worker that has never started is the same problem as one
    // that stopped, and phrasing it as "unknown" invites it to be ignored.
    return {
      worker,
      running: false,
      lastBeatAt: null,
      secondsSinceBeat: null,
      intervalSeconds: null,
      cycles: null,
      startedAt: null,
      lastError: null,
      lastErrorAt: null,
      reason: 'This worker has never recorded a heartbeat.',
    };
  }

  const secondsSinceBeat = Number(row.seconds_since_beat);
  const deadline = beatDeadlineSeconds(row.interval_seconds);
  const running = secondsSinceBeat <= deadline;

  return {
    worker,
    running,
    lastBeatAt: row.last_beat_at.toISOString(),
    secondsSinceBeat: Math.round(secondsSinceBeat),
    intervalSeconds: row.interval_seconds,
    cycles: Number(row.cycles),
    startedAt: row.started_at.toISOString(),
    lastError: row.last_error,
    lastErrorAt: row.last_error_at?.toISOString() ?? null,
    ...(running
      ? {}
      : {
          reason: `Last heartbeat was ${Math.round(secondsSinceBeat)}s ago; expected one every ${row.interval_seconds}s.`,
        }),
  };
}
