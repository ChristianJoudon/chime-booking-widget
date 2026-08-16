import 'dotenv/config';

import { createInterface } from 'node:readline';
import { Pool } from 'pg';

import { describePasswordProblem, hashPassword } from './passwords.js';

/**
 * Sets an administrator password.
 *
 *   cd server && npm run set-password
 *   cd server && npm run set-password -- owner@chime.local
 *
 * The password is read from stdin with echo suppressed, so it does not land in
 * shell history, process arguments, or this repository. CHIME_ADMIN_PASSWORD
 * is honoured for non-interactive use (CI, container provisioning).
 */

const connectionString = process.env.CHIME_DATABASE_URL ?? process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('CHIME_DATABASE_URL or DATABASE_URL is required.');
}

const email = (process.argv[2] ?? process.env.CHIME_ADMIN_USER_EMAIL ?? '').trim();
if (!email) {
  throw new Error('Pass an email address, or set CHIME_ADMIN_USER_EMAIL.');
}

async function readSecret(prompt: string): Promise<string> {
  const fromEnv = process.env.CHIME_ADMIN_PASSWORD;
  if (fromEnv) return fromEnv;

  if (!process.stdin.isTTY) {
    throw new Error(
      'No TTY available. Set CHIME_ADMIN_PASSWORD for non-interactive use.',
    );
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  // Suppress echo so the password is not left on screen or in a scrollback.
  const asMutable = rl as unknown as { _writeToOutput?: (value: string) => void };
  let silence = false;
  asMutable._writeToOutput = function write(value: string) {
    if (!silence) process.stdout.write(value);
  };

  process.stdout.write(prompt);
  silence = true;
  const value = await new Promise<string>((resolve) => rl.question('', resolve));
  silence = false;
  process.stdout.write('\n');
  rl.close();
  return value;
}

async function main() {
  const pool = new Pool({ connectionString });
  try {
    const user = await pool.query<{ id: string; email: string; status: string }>(
      `SELECT id, email, status FROM chime_app.users WHERE lower(email) = lower($1)`,
      [email],
    );
    const found = user.rows[0];
    if (!found) {
      throw new Error(`No administrator account exists for ${email}.`);
    }
    if (found.status !== 'active') {
      throw new Error(`${email} is ${found.status}, so a password would not let them sign in.`);
    }

    const password = await readSecret(`New password for ${found.email}: `);
    const problem = describePasswordProblem(password, found.email);
    if (problem) throw new Error(problem);

    if (!process.env.CHIME_ADMIN_PASSWORD) {
      const again = await readSecret('Confirm password: ');
      if (again !== password) throw new Error('The two entries did not match.');
    }

    const encoded = await hashPassword(password);
    await pool.query(
      `INSERT INTO chime_app.user_credentials (user_id, password_hash, password_updated_at)
       VALUES ($1, $2, now())
       ON CONFLICT (user_id) DO UPDATE
         SET password_hash = EXCLUDED.password_hash,
             password_updated_at = now(),
             failed_attempts = 0,
             locked_until = NULL`,
      [found.id, encoded],
    );

    console.log(`Password set for ${found.email}. Any lockout has been cleared.`);
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
