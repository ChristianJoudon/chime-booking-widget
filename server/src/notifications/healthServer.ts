import { createServer, type Server } from 'node:http';

import type { Pool } from 'pg';

import { readWorkerStatus } from './heartbeat.js';

/*
 * A port on the worker, purely so a container runtime can ask if it is well.
 *
 * Docker, Compose and every orchestrator restart an unhealthy container, but
 * they need something to check, and a process with no listener gives them
 * nothing to check but "did it exit" — which a wedged worker never does.
 *
 * The check reads the worker's own heartbeat rather than reporting on the
 * process it is running inside. A health server that answers "yes" simply
 * because it is able to answer would report every worker healthy including the
 * stuck ones, which is the failure this whole mechanism exists to catch.
 */
export function startWorkerHealthServer(pool: Pool, worker: string): { close: () => Promise<void> } {
  const port = Number(process.env.CHIME_WORKER_HEALTH_PORT ?? 8889);
  const host = process.env.CHIME_WORKER_HEALTH_HOST ?? '127.0.0.1';

  const server: Server = createServer((request, response) => {
    if (request.method !== 'GET' || !request.url?.startsWith('/health')) {
      response.writeHead(404, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: 'Not found.' }));
      return;
    }
    void readWorkerStatus(pool, worker)
      .then((status) => {
        response.writeHead(status.running ? 200 : 503, { 'content-type': 'application/json' });
        response.end(JSON.stringify(status));
      })
      .catch((error: unknown) => {
        // The database is how this worker does anything at all, so failing to
        // reach it is a genuine unhealthy, not a monitoring glitch to swallow.
        response.writeHead(503, { 'content-type': 'application/json' });
        response.end(
          JSON.stringify({
            worker,
            running: false,
            reason: error instanceof Error ? error.message : 'Database unreachable.',
          }),
        );
      });
  });

  server.on('error', (error) => {
    // Losing the health port must not take the worker down with it. Reminders
    // still going out unmonitored beats reminders not going out at all.
    console.error('Worker health server could not listen', error);
  });

  server.listen(port, host, () => {
    console.log(`Worker health available at http://${host}:${port}/health`);
  });

  return {
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}
