#!/usr/bin/env node
/**
 * Applies database migrations to an existing database and records what ran.
 *
 * The gap this closes: docker-compose mounts migrations into
 * /docker-entrypoint-initdb.d, which Postgres runs ONLY when the data directory
 * is empty. An existing database therefore never receives a new migration, and
 * there was no way to ask a database which ones it had. Migrations 014 and 015
 * had to be applied by hand for exactly this reason.
 *
 *   npm run migrate           apply everything pending
 *   npm run migrate:status    report applied, pending, and checksum drift
 *   npm run migrate -- --baseline
 *                             record every migration as applied WITHOUT running
 *                             it, for a database already known to be current
 *
 * Each migration file manages its own transaction — every one opens with BEGIN
 * and ends with a single COMMIT — so the runner does not add another. The
 * ledger row is written immediately after. If the process dies in between, the
 * migration is applied but unrecorded; re-running is safe because every
 * migration is idempotent, which is verified by re-applying all of them.
 *
 * This runner does NOT replace the ordering in docker-compose, and that
 * ordering is load-bearing. Migrations 007, 008, 011, 012 and 013 seed
 * organization-scoped rows with `SELECT ... FROM chime_app.organizations`, so
 * they insert nothing unless an organization already exists. docker-compose
 * therefore interleaves seed-admin-demo.sql between migrations 001 and 002.
 * Running every migration and then every seed produces a database with no
 * notification templates — confirmed by doing it.
 */

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const requireFromServer = createRequire(new URL('../server/package.json', import.meta.url));
const { Client } = requireFromServer('pg');

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(HERE, '..', 'database', 'migrations');

/**
 * The migration sequence does not stand alone. Migration 002 adds constraints
 * to public.chime_bookings, which is created by postgres-schema.sql — the
 * original widget schema, which predates the migrations and is not part of the
 * numbered sequence. Running migrations against a genuinely empty database
 * fails at 002 without it.
 *
 * The runner applies it first and records it as 000, so the prerequisite is
 * tracked like everything else instead of being folklore.
 */
const BASE_SCHEMA = join(HERE, '..', 'database', 'postgres-schema.sql');
const BASE_SCHEMA_NAME = '000-postgres-schema.sql';

/*
 * The demo data, applied where docker-compose applies it.
 *
 * The comment at the top of this file explains why the position matters and
 * says the consequence was "confirmed by doing it" — and then this runner had
 * no way to do it, which meant nobody could build a working database from the
 * runner alone. The first time CI ran, twenty-three migrations applied cleanly
 * and the very next step failed on a foreign key to an organisation that does
 * not exist. This machine only worked because compose's initdb had created one
 * long before.
 *
 * Off by default, because a production database must not be given a demo
 * organisation. `--with-demo-data` is for a machine that needs the same
 * database compose builds: a fresh checkout, or a build agent.
 *
 * Recorded in the ledger under its compose position, so the ordering is tracked
 * like everything else rather than living in a comment.
 */
const DEMO_FILES = [
  // Between the base schema and 001, as compose has it at position 02.
  { after: '001-', file: 'seed-demo.sql', name: '000a-seed-demo.sql' },
  // Both admin seeds sit between 001 and 002 — compose positions 04 and 05.
  // The organisation comes first; the second adds the read-only user that
  // several suites need in order to check a role is actually refused.
  { after: '002-', file: 'seed-admin-demo.sql', name: '001a-seed-admin-demo.sql' },
  { after: '002-', file: 'seed-admin-test.sql', name: '001b-seed-admin-test.sql' },
  // After everything, because it needs the organisation and its team, and the
  // slots it produces are generated from the rules it writes. Without it a
  // fresh database has no bookable time at all — which reads, in three
  // different suites, as "requires two available slots".
  { after: null, file: 'seeds/003-demo-availability.sql', name: '999-demo-availability.sql' },
];
const withDemoData = process.argv.includes('--with-demo-data');

const DATABASE_URL = process.env.CHIME_DATABASE_URL
  ?? process.env.DATABASE_URL
  ?? 'postgres://chime:chime@127.0.0.1:5534/chime';

// The ledger lives in public, not chime_app: it has to exist before migration
// 001 creates that schema.
const LEDGER = 'public.chime_schema_migrations';

function baseSchema() {
  const sql = readFileSync(BASE_SCHEMA, 'utf8');
  return { name: BASE_SCHEMA_NAME, sql, checksum: createHash('sha256').update(sql).digest('hex') };
}

function demoFile(entry) {
  const sql = readFileSync(join(HERE, '..', 'database', entry.file), 'utf8');
  return { name: entry.name, sql, checksum: createHash('sha256').update(sql).digest('hex') };
}

function migrationFiles() {
  const numbered = [...readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith('.sql'))
    // Names are zero-padded (001-, 002-, ... 015-), so a plain sort is the
    // intended order. Reject anything that would sort unpredictably.
    .sort()
    .map((name) => {
      if (!/^\d{3}-/.test(name)) {
        throw new Error(`Migration "${name}" must start with a three-digit prefix.`);
      }
      const sql = readFileSync(join(MIGRATIONS_DIR, name), 'utf8');
      return { name, sql, checksum: createHash('sha256').update(sql).digest('hex') };
    })];

  if (!withDemoData) return [baseSchema(), ...numbered];

  /*
   * Interleaved exactly where docker-compose interleaves them.
   *
   * Migrations 007, 008, 011, 012 and 013 seed organisation-scoped rows with
   * `SELECT ... FROM chime_app.organizations`. Run them before an organisation
   * exists and they insert nothing — a database with no notification templates,
   * which then fails much later and somewhere unrelated.
   *
   * Getting this wrong is not hypothetical: the first version of this flag
   * placed only the organisation seed, and the suite stopped on "the seeded
   * organisation has no viewer" — a guard written for exactly the case where a
   * permission test can only ever exercise the half that is allowed.
   */
  const ordered = [baseSchema(), ...numbered];
  for (const entry of DEMO_FILES) {
    if (entry.after === null) {
      ordered.push(demoFile(entry));
      continue;
    }
    const at = ordered.findIndex((item) => item.name.startsWith(entry.after));
    if (at === -1) {
      throw new Error(`Expected a ${entry.after} migration to place ${entry.file} before.`);
    }
    ordered.splice(at, 0, demoFile(entry));
  }
  return ordered;
}

async function ensureLedger(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS ${LEDGER} (
      filename    text PRIMARY KEY,
      checksum    text NOT NULL,
      applied_at  timestamptz NOT NULL DEFAULT now(),
      applied_by  text NOT NULL DEFAULT current_user
    )`);
}

async function readLedger(client) {
  const { rows } = await client.query(`SELECT filename, checksum, applied_at FROM ${LEDGER}`);
  return new Map(rows.map((row) => [row.filename, row]));
}

async function record(client, migration) {
  await client.query(
    `INSERT INTO ${LEDGER} (filename, checksum) VALUES ($1, $2)
     ON CONFLICT (filename) DO UPDATE SET checksum = EXCLUDED.checksum`,
    [migration.name, migration.checksum],
  );
}

/**
 * A database created before the ledger existed already has every migration
 * applied by initdb. Running them again would work, but recording them without
 * running is faster and states the truth.
 */
async function looksAlreadyMigrated(client) {
  const { rows } = await client.query(`
    SELECT count(*)::int AS tables
      FROM information_schema.tables
     WHERE table_schema = 'chime_app'`);
  return rows[0].tables > 0;
}

function drift(migrations, ledger) {
  return migrations.filter((migration) => {
    const applied = ledger.get(migration.name);
    return applied && applied.checksum !== migration.checksum;
  });
}

async function main() {
  const mode = process.argv.includes('--status')
    ? 'status'
    : process.argv.includes('--baseline')
      ? 'baseline'
      : 'apply';

  const client = new Client({ connectionString: DATABASE_URL });
  await client.connect();

  try {
    await ensureLedger(client);
    const migrations = migrationFiles();
    const ledger = await readLedger(client);
    const pending = migrations.filter((migration) => !ledger.has(migration.name));
    const changed = drift(migrations, ledger);

    if (mode === 'status') {
      console.log(`${migrations.length} migrations, ${ledger.size} applied, ${pending.length} pending\n`);
      for (const migration of migrations) {
        const applied = ledger.get(migration.name);
        const mark = !applied ? 'PENDING' : applied.checksum === migration.checksum ? 'applied' : 'CHANGED';
        const when = applied ? applied.applied_at.toISOString().slice(0, 19).replace('T', ' ') : '';
        console.log(`  ${mark.padEnd(8)} ${migration.name}  ${when}`);
      }
      if (changed.length) {
        console.log(`\n${changed.length} applied migration(s) differ from the file on disk.`);
        console.log('Editing an applied migration means databases disagree. Add a new one instead.');
        process.exitCode = 1;
      }
      return;
    }

    if (changed.length) {
      console.error('Refusing to run: these applied migrations have been edited since they ran.');
      for (const migration of changed) console.error(`  ${migration.name}`);
      console.error('Databases would disagree. Add a new migration instead of editing an applied one.');
      process.exitCode = 1;
      return;
    }

    if (mode === 'baseline') {
      for (const migration of pending) await record(client, migration);
      console.log(`Baselined ${pending.length} migration(s) as applied without running them.`);
      return;
    }

    if (!pending.length) {
      console.log(`Up to date: ${migrations.length} migrations applied.`);
      return;
    }

    // A pre-ledger database already ran everything through initdb.
    if (ledger.size === 0 && await looksAlreadyMigrated(client)) {
      for (const migration of pending) await record(client, migration);
      console.log(
        `This database predates the migration ledger and already has the chime_app schema.\n`
        + `Recorded ${pending.length} migration(s) as applied without re-running them.\n`
        + `Use --status to confirm, or --baseline to do this deliberately in future.`,
      );
      return;
    }

    for (const migration of pending) {
      process.stdout.write(`  applying ${migration.name} ... `);
      // The numbered migrations open with BEGIN and end with COMMIT. The base
      // schema does not, so it is wrapped here rather than left to run
      // statement-by-statement in autocommit.
      const wrap = migration.name === BASE_SCHEMA_NAME;
      await client.query(wrap ? `BEGIN;\n${migration.sql}\nCOMMIT;` : migration.sql);
      await record(client, migration);
      console.log('done');
    }
    console.log(`\nApplied ${pending.length} migration(s).`);
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(`\nMigration failed: ${error instanceof Error ? error.message : error}`);
  process.exit(1);
});
