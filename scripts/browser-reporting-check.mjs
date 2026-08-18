#!/usr/bin/env node
/*
 * Proves the customer widget never carries a DSN, and never loads a reporting
 * SDK it was not asked to load.
 *
 * This is the check that matters, because the failure it guards against is
 * invisible: putting VITE_CHIME_SENTRY_DSN in the repository root would work
 * perfectly, report errors correctly, and quietly copy the value onto every
 * website that embeds the booking page. src/lib/widgetConfig.ts does a bare
 * `import.meta.env` read, so Vite inlines the entire env object into the bundle
 * — visible in the shipped file today as {BASE_URL:"/",DEV:!1,...} — and
 * vite.embed.config.ts sets no envDir, so it reads the root.
 *
 * So this builds the widget with a sentinel in the root environment and greps
 * the artifact for it.
 *
 *   node scripts/browser-reporting-check.mjs
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SENTINEL = 'sentinel-dsn-must-never-ship-a1b2c3';
const rootEnv = path.join(root, '.env.local');

const results = [];
const check = (name, ok, detail) => results.push({ name, ok, detail });

let restore = null;
if (existsSync(rootEnv)) restore = readFileSync(rootEnv, 'utf8');

try {
  writeFileSync(
    rootEnv,
    `${restore ?? ''}\nVITE_CHIME_SENTRY_DSN=https://${SENTINEL}@o0.ingest.sentry.io/0\n`,
  );

  execFileSync('npm', ['run', 'build:embed', '--silent'], { cwd: root, stdio: 'pipe' });

  const bundle = readFileSync(path.join(root, 'dist-embed', 'chime-widget.js'), 'utf8');

  check(
    'a root VITE DSN never reaches the customer bundle',
    !bundle.includes(SENTINEL),
    'the sentinel was found in dist-embed/chime-widget.js — the widget must take its DSN at runtime',
  );

  check(
    'the widget reads its DSN from the host page instead',
    bundle.includes('CHIME_WIDGET_CONFIG'),
    'the runtime configuration contract is missing from the bundle',
  );

  /*
   * The SDK must not be in the main chunk. A dynamic import means a site that
   * sets no DSN downloads none of it — which is most of them, and all of them
   * on day one.
   */
  check(
    'the reporting SDK is not in the widget bundle itself',
    !/@sentry\/browser/.test(bundle) && !bundle.includes('sentry_browser'),
    'the SDK appears to be statically bundled; it should be a dynamic import',
  );
} catch (error) {
  check('the widget builds', false, error instanceof Error ? error.message.slice(0, 300) : String(error));
} finally {
  if (restore === null) rmSync(rootEnv, { force: true });
  else writeFileSync(rootEnv, restore);
  // Rebuilt clean, so a check never leaves a sentinel in the artifact it just
  // told you was safe.
  try {
    execFileSync('npm', ['run', 'build:embed', '--silent'], { cwd: root, stdio: 'pipe' });
  } catch {
    check('the widget rebuilds cleanly afterwards', false, 'the post-check rebuild failed');
  }
}

for (const result of results) {
  console.log(`  ${result.ok ? 'ok  ' : 'FAIL'}  ${result.name}${result.ok ? '' : ` — ${result.detail}`}`);
}
const failed = results.filter((result) => !result.ok).length;
if (results.length === 0) {
  console.error('\n  FAIL  nothing was checked.');
  process.exit(1);
}
console.log(failed === 0 ? `\n  PASS  ${results.length} widget reporting checks` : `\n  FAIL  ${failed} of ${results.length}`);
process.exit(failed === 0 ? 0 : 1);
