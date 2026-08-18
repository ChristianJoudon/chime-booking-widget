#!/usr/bin/env node
/**
 * Creates a business and its first owner account.
 *
 * Onboarding used to mean writing SQL by hand against four tables and hoping
 * the order was right. Migration 016 already does the hard part — a trigger
 * gives every new organization its notification templates, business settings
 * and defaults — so this only has to create the organization and the owner,
 * and let the database do the rest.
 *
 * The password is read from stdin with the echo suppressed, and hashed by the
 * same module the sign-in endpoint verifies against, so there is one
 * implementation rather than two that must agree.
 *
 * Everything happens in one transaction: a half-created business that can be
 * signed into but has no templates is worse than no business at all.
 *
 * Usage:
 *   npm run provision -- --name "Sea & Kin Studio" --email owner@example.com
 *   npm run provision -- --name "…" --email … --slug sea-and-kin --time-zone Pacific/Honolulu
 */

import { createRequire } from 'node:module';
import { createInterface } from 'node:readline';
import process from 'node:process';

const requireFromServer = createRequire(new URL('../server/package.json', import.meta.url));
const { Pool } = requireFromServer('pg');

const { hashPassword, describePasswordProblem } =
  await import(new URL('../server/dist/admin/passwords.js', import.meta.url));

const DATABASE_URL = process.env.CHIME_DATABASE_URL
  ?? process.env.DATABASE_URL
  ?? 'postgres://chime:chime@127.0.0.1:5534/chime';

function argument(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

/** Lowercase, hyphenated, no leading or trailing punctuation. */
function toSlug(value) {
  return value.toLowerCase().replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/**
 * Reads a line without echoing it.
 *
 * Only a terminal can suppress echo, and forcing terminal mode on a pipe hangs
 * waiting for input that has already arrived — which is what an automated
 * provision would hit. Piped input is read plainly instead; it was never on
 * screen to hide.
 */
function readSecret(prompt) {
  const interactive = Boolean(process.stdin.isTTY);
  return new Promise((resolve) => {
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: interactive,
    });
    if (interactive) {
      rl._writeToOutput = (chunk) => { if (chunk.includes(prompt)) rl.output.write(prompt); };
    }
    rl.question(prompt, (answer) => {
      rl.close();
      if (interactive) process.stdout.write('\n');
      resolve(answer.trim());
    });
  });
}

async function main() {
  const name = argument('name');
  const email = argument('email');
  if (!name || !email) {
    console.error('Usage: npm run provision -- --name "Business name" --email owner@example.com');
    console.error('Optional: --slug my-business  --time-zone Pacific/Honolulu  --currency USD');
    process.exit(2);
  }

  const slug = argument('slug') ?? toSlug(name);
  const timeZone = argument('time-zone') ?? 'Pacific/Honolulu';
  const currency = argument('currency') ?? 'USD';

  // CHIME_OWNER_PASSWORD exists for automated provisioning. Interactive use
  // should not pass a password on the command line, where it lands in shell
  // history, so there is no flag for it.
  const password = process.env.CHIME_OWNER_PASSWORD ?? await readSecret(`Password for ${email}: `);
  const problem = describePasswordProblem(password, email);
  if (problem) {
    console.error(`  ${problem}`);
    process.exit(1);
  }
  const confirm = process.env.CHIME_OWNER_PASSWORD ?? await readSecret('Repeat it: ');
  if (password !== confirm) {
    console.error('  The two entries did not match. Nothing was created.');
    process.exit(1);
  }

  const passwordHash = await hashPassword(password);
  const pool = new Pool({ connectionString: DATABASE_URL });
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const { rows: existing } = await client.query(
      `SELECT id FROM chime_app.organizations WHERE slug = $1`, [slug],
    );
    if (existing.length) {
      throw new Error(`An organization with the slug "${slug}" already exists. Pass a different --slug.`);
    }

    // The AFTER INSERT trigger from migration 016 seeds templates and settings.
    const { rows: [organization] } = await client.query(
      `INSERT INTO chime_app.organizations (name, slug, default_time_zone, default_currency)
       VALUES ($1, $2, $3, $4)
       RETURNING id, name, slug`,
      [name, slug, timeZone, currency],
    );

    // Users are global and join an organization through a membership, so the
    // same person can hold accounts at more than one business without a
    // duplicate login. An existing user is reused rather than rejected.
    // Email is already unique on lower(email) — chime_users_email_unique, since
    // migration 001 — so the conflict target has to match that expression
    // rather than the bare column.
    const { rows: [user] } = await client.query(
      `INSERT INTO chime_app.users (email, display_name)
       VALUES ($1, $2)
       ON CONFLICT (lower(email)) DO UPDATE SET updated_at = now()
       RETURNING id, email`,
      [email.toLowerCase(), email.split('@')[0]],
    );

    await client.query(
      `INSERT INTO chime_app.memberships (organization_id, user_id, role)
       VALUES ($1, $2, 'owner')
       ON CONFLICT (organization_id, user_id) DO UPDATE SET role = 'owner'`,
      [organization.id, user.id],
    );

    // One password per person, not per business, which follows from users being
    // global. Re-provisioning with a new password replaces the old one.
    await client.query(
      `INSERT INTO chime_app.user_credentials (user_id, password_hash)
       VALUES ($1, $2)
       ON CONFLICT (user_id) DO UPDATE SET
         password_hash = EXCLUDED.password_hash,
         password_updated_at = now(),
         failed_attempts = 0,
         locked_until = NULL`,
      [user.id, passwordHash],
    );

    // Proof the trigger did its work. A business with no templates cannot send
    // a confirmation, and would not find out until its first booking.
    const { rows: [seeded] } = await client.query(
      `SELECT
         (SELECT count(*)::int FROM chime_app.notification_templates WHERE organization_id = $1) AS templates,
         (SELECT count(*)::int FROM chime_app.business_settings WHERE organization_id = $1) AS settings`,
      [organization.id],
    );
    if (seeded.templates === 0) {
      throw new Error('The organization was created without notification templates; rolling back.');
    }

    await client.query('COMMIT');

    console.log(`  organization  ${organization.name}  (${organization.slug})`);
    console.log(`  id            ${organization.id}`);
    console.log(`  owner         ${user.email}`);
    console.log(`  seeded        ${seeded.templates} notification templates, ${seeded.settings} settings row`);
    console.log('\nPASS  the business can sign in and send confirmations');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error(`  FAIL  ${error.message}`);
    console.error('  Nothing was created.');
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => { console.error(error); process.exit(1); });
