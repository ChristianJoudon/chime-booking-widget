#!/usr/bin/env node
/**
 * Takes a compressed dump of the database and verifies it is restorable.
 *
 * A backup nobody has restored is a hope, not a backup. This one is read back
 * with `pg_restore --list` immediately after it is written, so a dump that is
 * truncated or corrupt fails here rather than on the day it is needed.
 *
 * Uses the custom format, which restores selectively and compresses, rather
 * than plain SQL.
 *
 * Usage:
 *   npm run backup                    write to ./backups
 *   CHIME_BACKUP_DIR=/mnt/x npm run backup
 *   CHIME_BACKUP_KEEP=30 npm run backup    keep the newest 30
 */

import { execFile } from 'node:child_process';
import { mkdir, readdir, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import process from 'node:process';

const run = promisify(execFile);

const DATABASE_URL = process.env.CHIME_DATABASE_URL
  ?? process.env.DATABASE_URL
  ?? 'postgres://chime:chime@127.0.0.1:5534/chime';
const DIR = process.env.CHIME_BACKUP_DIR ?? new URL('../backups', import.meta.url).pathname;
const KEEP = Number(process.env.CHIME_BACKUP_KEEP ?? 14);

/** Sortable, filename-safe, and unambiguous about the time zone. */
function stamp() {
  return new Date().toISOString().replace(/[:.]/g, '-').replace('Z', 'Z');
}

/**
 * Finds a working pg_dump: the host's, or the one inside the database
 * container. The container path writes to a directory the compose file mounts
 * from the host, so the dump survives the container.
 */
async function resolveTools() {
  const local = await run('pg_dump', ['--version']).then(() => true).catch(() => false);
  if (local) {
    return {
      how: 'pg_dump on this machine',
      dump: (file) => run('pg_dump', ['--format=custom', '--compress=9', '--file', file, DATABASE_URL],
        { maxBuffer: 1024 * 1024 * 64 }),
      list: (file) => run('pg_restore', ['--list', file], { maxBuffer: 1024 * 1024 * 64 }),
    };
  }

  const container = process.env.CHIME_DB_CONTAINER ?? 'chime-standalone-db';
  const running = await run('docker', ['inspect', '-f', '{{.State.Running}}', container])
    .then(({ stdout }) => stdout.trim() === 'true').catch(() => false);
  if (!running) {
    console.error(
      `  FAIL  no pg_dump on this machine and no running container named "${container}".\n`
      + '        Install the Postgres client tools, or set CHIME_DB_CONTAINER.',
    );
    process.exit(2);
  }

  // Dump to a file inside the container, verify it there, then copy it out.
  // Piping the archive back in over stdin deadlocked; moving whole files does
  // not, and the verification happens where the tools already are.
  const scratch = '/tmp/chime-backup.dump';
  return {
    how: `pg_dump inside ${container}`,
    dump: async (file) => {
      await run('docker', ['exec', container, 'pg_dump', '--format=custom', '--compress=9',
        '--file', scratch, DATABASE_URL], { timeout: 240000, maxBuffer: 1024 * 1024 * 16 });
      await run('docker', ['cp', `${container}:${scratch}`, file], { timeout: 120000 });
      await run('docker', ['exec', container, 'rm', '-f', scratch]).catch(() => {});
    },
    list: (file) => run('docker', ['exec', container, 'sh', '-c',
      `pg_restore --list ${scratch} 2>/dev/null || true`], { maxBuffer: 1024 * 1024 * 32 })
      // The scratch file is gone by now, so re-create it from the copy we kept.
      .then(async () => {
        await run('docker', ['cp', file, `${container}:${scratch}`], { timeout: 120000 });
        const result = await run('docker', ['exec', container, 'pg_restore', '--list', scratch],
          { maxBuffer: 1024 * 1024 * 32 });
        await run('docker', ['exec', container, 'rm', '-f', scratch]).catch(() => {});
        return result;
      }),
  };
}

async function main() {
  await mkdir(DIR, { recursive: true });
  const file = join(DIR, `chime-${stamp()}.dump`);

  // pg_dump usually is not installed next to the application — the Postgres
  // tools live in the database container. Preferring a local binary and falling
  // back to the container means the same command works on a workstation and on
  // a server, rather than only wherever it was written.
  const tools = await resolveTools();
  console.log(`  using ${tools.how}`);
  try {
    await tools.dump(file);
  } catch (error) {
    console.error(`  FAIL  pg_dump: ${String(error.stderr || error.message).slice(0, 200)}`);
    process.exit(1);
  }

  const { size } = await stat(file);
  if (size < 1024) {
    console.error(`  FAIL  the dump is only ${size} bytes, which cannot be a real database`);
    process.exit(1);
  }

  // Reading the archive's table of contents proves the file is a complete,
  // parseable dump rather than a truncated write.
  let tables = 0;
  try {
    const { stdout } = await tools.list(file);
    tables = stdout.split('\n').filter((l) => / TABLE DATA /.test(l)).length;
  } catch (error) {
    console.error(`  FAIL  the dump is not restorable: ${String(error.stderr || error.message).slice(0, 160)}`);
    await unlink(file).catch(() => {});
    process.exit(1);
  }

  if (tables === 0) {
    console.error('  FAIL  the dump contains no table data');
    await unlink(file).catch(() => {});
    process.exit(1);
  }

  console.log(`  wrote ${file}`);
  console.log(`  ${(size / 1024 / 1024).toFixed(1)} MB, ${tables} tables, verified restorable`);

  // Retention. Oldest first, keep the newest KEEP.
  const all = (await readdir(DIR)).filter((f) => f.startsWith('chime-') && f.endsWith('.dump')).sort();
  const excess = all.slice(0, Math.max(0, all.length - KEEP));
  for (const old of excess) await unlink(join(DIR, old));
  if (excess.length) console.log(`  removed ${excess.length} older backup(s), keeping ${KEEP}`);

  console.log(`\nPASS  backup verified`);
}

main().catch((error) => { console.error(error); process.exit(1); });
