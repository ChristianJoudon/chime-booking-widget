import 'dotenv/config';

import { Pool } from 'pg';

import {
  notificationConfigFromEnv,
  processNotificationBatch,
} from './service.js';
import { Heartbeat } from './heartbeat.js';
import { startWorkerHealthServer } from './healthServer.js';

const connectionString = process.env.CHIME_DATABASE_URL ?? process.env.DATABASE_URL;
if (!connectionString) throw new Error('CHIME_DATABASE_URL or DATABASE_URL is required.');

const pool = new Pool({ connectionString });
const config = notificationConfigFromEnv();
const pollMilliseconds = Math.max(1000, Number(process.env.CHIME_NOTIFICATION_POLL_MS ?? 5000));
const runOnce = process.env.CHIME_NOTIFICATION_RUN_ONCE === 'true';
let stopping = false;
let health: { close: () => Promise<void> } | null = null;

const heartbeat = new Heartbeat(pool, 'notifications', Math.ceil(pollMilliseconds / 1000), {
  mode: config.mode,
});

async function tick() {
  const result = await processNotificationBatch(pool, config);
  if (result.claimed > 0) {
    console.log(JSON.stringify({ event: 'notification.batch', ...result }));
  }
}

async function run() {
  if (runOnce) {
    await tick();
    await pool.end();
    return;
  }
  console.log(`Chime notification worker started in ${config.mode} mode.`);
  health = startWorkerHealthServer(pool, 'notifications');
  while (!stopping) {
    try {
      await tick();
    } catch (error) {
      console.error('Notification worker batch failed', error);
      heartbeat.recordFailure(error);
    }
    // After the batch, so a cycle that never returns stops the beat. A worker
    // wedged on a query is still a worker that has stopped sending reminders.
    await heartbeat.beat();
    await new Promise((resolve) => setTimeout(resolve, pollMilliseconds));
  }
}

async function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  console.log(`${signal} received; closing Chime notification worker.`);
  await health?.close();
  await pool.end();
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

void run().catch(async (error) => {
  console.error('Notification worker stopped unexpectedly', error);
  await health?.close();
  await pool.end();
  process.exitCode = 1;
});
