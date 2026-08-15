import 'dotenv/config';

import { Pool } from 'pg';

import {
  notificationConfigFromEnv,
  processNotificationBatch,
} from './service.js';

const connectionString = process.env.CHIME_DATABASE_URL ?? process.env.DATABASE_URL;
if (!connectionString) throw new Error('CHIME_DATABASE_URL or DATABASE_URL is required.');

const pool = new Pool({ connectionString });
const config = notificationConfigFromEnv();
const pollMilliseconds = Math.max(1000, Number(process.env.CHIME_NOTIFICATION_POLL_MS ?? 5000));
const runOnce = process.env.CHIME_NOTIFICATION_RUN_ONCE === 'true';
let stopping = false;

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
  while (!stopping) {
    try {
      await tick();
    } catch (error) {
      console.error('Notification worker batch failed', error);
    }
    await new Promise((resolve) => setTimeout(resolve, pollMilliseconds));
  }
}

async function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  console.log(`${signal} received; closing Chime notification worker.`);
  await pool.end();
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

void run().catch(async (error) => {
  console.error('Notification worker stopped unexpectedly', error);
  await pool.end();
  process.exitCode = 1;
});
