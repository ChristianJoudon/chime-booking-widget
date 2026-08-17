/**
 * Accessibility coverage for the administrator studio.
 *
 * The tightening plan asks for coverage of keyboard and touch interactions.
 * This drives the real studio against the real API — not a rendered fixture —
 * because the failures worth catching are the ones that only appear once data
 * has loaded and a dialog is open.
 *
 * Three things are checked on every screen:
 *
 *   1. axe-core, limited to WCAG A and AA. Rules are advisory in aggregate but
 *      each violation names a specific element, so they are reported per node.
 *   2. Keyboard reachability: every control that responds to a click can be
 *      reached with Tab and shows a visible focus indicator.
 *   3. Touch target size: 24x24 CSS pixels, the WCAG 2.2 AA minimum, measured
 *      after layout rather than inferred from CSS.
 *
 * The modal dialog gets its own pass, because a dialog is where keyboard
 * failures actually trap someone: no Escape, no focus trap, and Tab walks out
 * of the dialog into the page behind it with no way back.
 *
 * Uses puppeteer-core against the Chrome already installed, so nothing here
 * downloads a browser.
 *
 * Usage:
 *   npm run dev:admin                    # studio on 4374
 *   cd server && npm run dev:admin       # API on 8888
 *   npm run test:accessibility
 */
import { createHmac } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import process from 'node:process';

import puppeteer from 'puppeteer-core';

const STUDIO_URL = process.env.CHIME_STUDIO_URL ?? 'http://localhost:4374/admin.html';
const SESSION_SECRET = process.env.CHIME_ADMIN_SESSION_SECRET;
const ORGANIZATION_ID = process.env.CHIME_ADMIN_ORGANIZATION_ID
  ?? '00000000-0000-4000-8000-000000000001';
const USER_ID = process.env.CHIME_ADMIN_USER_ID
  ?? '00000000-0000-4000-8000-000000000101';

const CHROME_CANDIDATES = [
  process.env.CHIME_CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter(Boolean);

/** Every screen the sidebar can reach, as [area, screen]. */
const SCREENS = [
  ['Appointments', 'Schedule'],
  ['Appointments', 'Requests'],
  ['Business setup', 'Services'],
  ['Business setup', 'Team'],
  ['Business setup', 'Availability'],
  ['Customers', 'Customers'],
  ['Customers', 'Messages'],
  ['Money', 'Payments'],
  ['Money', 'Insights'],
  ['Booking widget', 'Widget designer'],
  ['Booking widget', 'Launch'],
];

/** WCAG 2.2 AA minimum, in CSS pixels. */
const MIN_TOUCH_TARGET = 24;

const failures = [];
const notes = [];

function fail(screen, check, detail) {
  failures.push({ screen, check, detail });
}

/**
 * Mints a session the same way `npm run session:admin` does, so the script can
 * sign in without a password. Read-only screens are all this needs.
 */
function mintSession() {
  if (!SESSION_SECRET) {
    console.error(
      'CHIME_ADMIN_SESSION_SECRET is not set.\n'
      + 'Run this with the same environment the admin API uses, for example:\n'
      + '  env $(grep -v "^#" config/admin/.env.local | xargs) npm run test:accessibility',
    );
    process.exit(2);
  }
  const expiresAt = Math.floor(Date.now() / 1000) + 3600;
  const body = Buffer.from(JSON.stringify({
    subject: USER_ID,
    organizationId: ORGANIZATION_ID,
    role: 'owner',
    email: 'accessibility-smoke@chime.local',
    expiresAt,
    issuer: 'chime-admin',
    issuedAt: Math.floor(Date.now() / 1000),
  })).toString('base64url');
  const signature = createHmac('sha256', SESSION_SECRET).update(body).digest('base64url');
  return {
    token: `${body}.${signature}`,
    expiresAt: new Date(expiresAt * 1000).toISOString(),
    email: 'accessibility-smoke@chime.local',
    role: 'owner',
    organizationId: ORGANIZATION_ID,
  };
}

function resolveChrome() {
  const found = CHROME_CANDIDATES.find((path) => existsSync(path));
  if (!found) {
    console.error(
      'No Chrome found. Set CHIME_CHROME_PATH to a Chrome or Chromium binary.\n'
      + `Looked in:\n${CHROME_CANDIDATES.map((p) => `  ${p}`).join('\n')}`,
    );
    process.exit(2);
  }
  return found;
}

async function openStudio(page, session) {
  // Seeded before the app boots, so the studio comes up signed in rather than
  // on the login screen.
  await page.evaluateOnNewDocument((value) => {
    // The widget preview renders in a sandboxed iframe without same-origin, so
    // touching sessionStorage there throws a SecurityError that is noise rather
    // than a finding. Only the top document needs the session.
    if (window.top !== window.self) return;
    try {
      sessionStorage.setItem('chime.admin.session', value);
    } catch {
      // A storage-less context cannot host the studio anyway.
    }
  }, JSON.stringify(session));
  await page.goto(STUDIO_URL, { waitUntil: 'networkidle2', timeout: 30000 });
  await page.waitForSelector('main h1', { timeout: 15000 });
}

const settle = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Clicks an area header, then the screen inside it.
 *
 * Each click is its own evaluate with the wait on the Node side. Awaiting
 * inside a single page.evaluate lets Chrome collect the pending promise when
 * React re-renders the sidebar underneath it, which fails as an opaque
 * "Promise was collected" protocol error.
 */
async function goToScreen(page, area, screen) {
  const findScreen = (screenLabel) => page.evaluate((label) => {
    // A screen button renders as <Icon/><span>Label</span> plus an optional
    // count badge, so its full text reads "Requests2". The span holds the
    // label on its own.
    const labelOf = (b) => (b.querySelector('span')?.textContent ?? b.textContent).trim();
    const button = [...document.querySelectorAll('aside button')].find(
      (b) => !b.className.includes('area-header')
        && !b.className.includes('admin-')
        && labelOf(b) === label,
    );
    if (!button) return false;
    button.click();
    return true;
  }, screenLabel);

  if (!await findScreen(screen)) {
    const opened = await page.evaluate((label) => {
      const header = [...document.querySelectorAll('aside button')].find(
        (b) => b.className.includes('area-header') && b.textContent.trim().startsWith(label),
      );
      if (!header) return false;
      header.click();
      return true;
    }, area);
    if (!opened) return `no area header "${area}"`;
    await settle(600);
    if (!await findScreen(screen)) return `no screen button "${screen}"`;
  }
  // Studios load their own data after mounting; a fixed settle beats racing a
  // per-studio selector that differs on every screen.
  await settle(2200);
  await selectFirstRecord(page);
  await settle(1400);
  return null;
}

/**
 * Opens the first record in a list-and-detail screen.
 *
 * Several studios render an editor only once something is selected, and
 * whether one is selected on arrival depends on load order. That made the
 * control count swing between 120 and 141 across runs of this script — the
 * editors were being checked only sometimes, and a pass meant "nothing failed
 * in whatever happened to render". Selecting explicitly makes each run cover
 * the same surface.
 */
async function selectFirstRecord(page) {
  await page.evaluate(() => {
    const alreadyOpen = document.querySelector(
      '.team-editor__section, .service-editor__section, .customer-profile, .payments-detail__top',
    );
    if (alreadyOpen) return;
    const row = document.querySelector(
      '.team-roster button, .service-list button, .customer-directory button, '
      + '.payments-row, .operations-appointment, .communication-list article button',
    );
    if (row instanceof HTMLElement) row.click();
  });
}

async function runAxe(page, axeSource, screen, context) {
  // addScriptTag rather than evaluate: axe is a library to install in the
  // page, and evaluating its source as an expression is what produced the
  // opaque protocol error the first time this ran.
  if (!await page.evaluate(() => typeof window.axe !== 'undefined')) {
    await page.addScriptTag({ content: axeSource });
  }
  const results = await page.evaluate(async (ctx) => {
    const run = await window.axe.run(ctx ?? document, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] },
      resultTypes: ['violations'],
    });
    return run.violations.map((v) => ({
      id: v.id,
      impact: v.impact,
      help: v.help,
      // Colour rules carry the measured values. Printing them turns a finding
      // into something directly actionable instead of a prompt to go and
      // measure it by hand.
      nodes: v.nodes.slice(0, 6).map((n) => {
        const data = n.any[0]?.data ?? {};
        const measured = data.contrastRatio
          ? `${data.contrastRatio}:1 need ${data.expectedContrastRatio} `
            + `— ${data.fgColor} on ${data.bgColor} at ${data.fontSize}  `
          : '';
        return measured + n.html.slice(0, 110);
      }),
      count: v.nodes.length,
    }));
  }, context);

  for (const violation of results) {
    fail(screen, `axe:${violation.id}`,
      `${violation.help} (${violation.count} element${violation.count === 1 ? '' : 's'})`
      + violation.nodes.map((n) => `\n        ${n}`).join(''));
  }
  return results.length;
}

/**
 * Every element that responds to a click should be reachable with Tab and show
 * a focus indicator. A control you can only reach with a mouse is not usable by
 * keyboard, however correct its markup is.
 */
async function checkKeyboardReach(page, screen) {
  const report = await page.evaluate((minSize) => {
    const clickable = [...document.querySelectorAll('main button, main a[href], main [role="button"]')]
      .filter((el) => {
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 && !el.disabled;
      });

    const unreachable = [];
    const noFocusRing = [];
    const smallTargets = [];

    for (const el of clickable) {
      const tabbable = el.tabIndex >= 0;
      if (!tabbable) {
        unreachable.push(el.outerHTML.slice(0, 110));
        continue;
      }
      // A focus style must come from somewhere. Reading :focus-visible directly
      // is not possible, so compare the computed outline against the default.
      el.focus();
      const focused = getComputedStyle(el);
      const hasRing = focused.outlineStyle !== 'none'
        || focused.boxShadow !== 'none'
        || el.matches(':focus-visible');
      if (!hasRing) noFocusRing.push(el.outerHTML.slice(0, 110));

      // WCAG 2.2 exempts a link sitting inline in a sentence: the target is
      // the text itself, and padding it would break the paragraph.
      const inlineLink = el.tagName === 'A'
        && getComputedStyle(el).display.startsWith('inline')
        && el.parentElement
        && el.parentElement.textContent.trim() !== el.textContent.trim();

      const rect = el.getBoundingClientRect();
      if (!inlineLink && (rect.width < minSize || rect.height < minSize)) {
        smallTargets.push(
          `${Math.round(rect.width)}x${Math.round(rect.height)} ${el.outerHTML.slice(0, 90)}`,
        );
      }
    }
    document.activeElement?.blur();
    return { total: clickable.length, unreachable, noFocusRing, smallTargets };
  }, MIN_TOUCH_TARGET);

  if (report.unreachable.length) {
    fail(screen, 'keyboard:unreachable',
      `${report.unreachable.length} clickable control(s) cannot be reached with Tab`
      + report.unreachable.map((h) => `\n        ${h}`).join(''));
  }
  if (report.noFocusRing.length) {
    fail(screen, 'keyboard:no-focus-indicator',
      `${report.noFocusRing.length} control(s) show nothing when focused`
      + report.noFocusRing.slice(0, 4).map((h) => `\n        ${h}`).join(''));
  }
  if (report.smallTargets.length) {
    fail(screen, 'touch:target-too-small',
      `${report.smallTargets.length} target(s) below ${MIN_TOUCH_TARGET}x${MIN_TOUCH_TARGET}`
      + report.smallTargets.slice(0, 6).map((h) => `\n        ${h}`).join(''));
  }
  return report.total;
}

/**
 * The modal is checked separately because its failures are the disabling kind:
 * a keyboard user who cannot close a dialog, or who tabs out of it and cannot
 * get back, is stuck.
 */
async function checkDialog(page, axeSource) {
  const screen = 'Action preview dialog';

  // Availability's publish is the one preview that is always openable: it does
  // not depend on there being a payment, a ready message or a selected record.
  // The dialog is only ever opened and cancelled — nothing here confirms an
  // action, so running this against a real workspace changes nothing.
  await goToScreen(page, 'Business setup', 'Availability');
  const clicked = await page.evaluate(() => {
    const publish = [...document.querySelectorAll('main button')]
      .find((b) => /^publish/i.test(b.textContent.trim()) && !b.disabled);
    if (!publish) return false;
    // Focus first, then click. A programmatic click leaves focus on <body>,
    // which is not how anyone reaches this button and would make the
    // focus-restore check test nothing.
    publish.focus();
    publish.click();
    return true;
  });
  await settle(1200);

  if (!clicked || !await page.evaluate(() => !!document.querySelector('.action-preview'))) {
    notes.push('Dialog checks skipped: no preview dialog could be opened');
    return;
  }

  await runAxe(page, axeSource, screen, '.action-preview');

  // Focus should be inside the dialog as soon as it opens. Without this a
  // keyboard user gets no signal that anything happened.
  const focusStart = await page.evaluate(
    () => !!document.activeElement?.closest('.action-preview'),
  );
  if (!focusStart) fail(screen, 'dialog:focus-not-moved', 'Focus stays behind the dialog when it opens');

  // Tab through more elements than the dialog contains. If focus is trapped it
  // stays inside; if not, it escapes into the page behind.
  const tabbed = [];
  for (let i = 0; i < 12; i += 1) {
    await page.keyboard.press('Tab');
    tabbed.push(await page.evaluate(() => {
      const el = document.activeElement;
      return {
        inside: !!el?.closest('.action-preview'),
        tag: `${el?.tagName}.${(el?.className || '').split(' ')[0]}`.slice(0, 40),
      };
    }));
  }
  const escaped = tabbed.filter((t) => !t.inside);
  if (escaped.length) {
    fail(screen, 'dialog:focus-not-trapped',
      `Tab leaves the dialog after ${tabbed.findIndex((t) => !t.inside) + 1} press(es); `
      + `reached ${escaped.slice(0, 3).map((t) => t.tag).join(', ')}. `
      + 'aria-modal="true" tells assistive technology the rest of the page is inert, '
      + 'so this is a promise the dialog does not keep.');
  }

  await page.keyboard.press('Escape');
  await settle(400);
  const stillOpen = await page.evaluate(() => !!document.querySelector('.action-preview'));
  if (stillOpen) {
    fail(screen, 'dialog:no-escape', 'Escape does not close the dialog');
    await page.evaluate(() => {
      document.querySelector('.action-preview__actions button')?.click();
    });
    await settle(400);
  } else {
    // Closing should hand focus back to the control that opened it, or a
    // keyboard user restarts from the top of the page.
    const restored = await page.evaluate(() => {
      const el = document.activeElement;
      return el && el !== document.body ? `${el.tagName}:${el.textContent?.trim().slice(0, 24)}` : null;
    });
    if (!restored) fail(screen, 'dialog:focus-not-restored', 'Focus is lost to <body> when the dialog closes');
  }
}

async function main() {
  const session = mintSession();
  const axeSource = await readFile(
    new URL('../node_modules/axe-core/axe.min.js', import.meta.url),
    'utf8',
  );

  const browser = await puppeteer.launch({
    executablePath: resolveChrome(),
    headless: 'shell',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });

  try {
    const page = await browser.newPage();
    // A realistic desktop viewport. Touch sizes are checked in CSS pixels, so
    // they hold at any device pixel ratio.
    await page.setViewport({ width: 1280, height: 900 });
    page.on('pageerror', (error) => {
      fail('console', 'page-error', String(error).slice(0, 200));
    });

    await openStudio(page, session);

    let controls = 0;
    for (const [area, screen] of SCREENS) {
      const problem = await goToScreen(page, area, screen);
      if (problem) {
        fail(screen, 'navigation', problem);
        continue;
      }
      await runAxe(page, axeSource, screen);
      controls += await checkKeyboardReach(page, screen);
    }

    await checkDialog(page, axeSource);

    console.log(`Checked ${SCREENS.length} screens and ${controls} interactive controls.`);
  } finally {
    await browser.close();
  }

  for (const note of notes) console.log(`NOTE  ${note}`);

  if (!failures.length) {
    console.log('PASS  no accessibility failures');
    return;
  }

  const byScreen = new Map();
  for (const failure of failures) {
    if (!byScreen.has(failure.screen)) byScreen.set(failure.screen, []);
    byScreen.get(failure.screen).push(failure);
  }
  console.log('');
  for (const [screen, list] of byScreen) {
    console.log(`  ${screen}`);
    for (const item of list) console.log(`    ${item.check}: ${item.detail}`);
  }
  console.log(`\nFAIL  ${failures.length} accessibility failure(s)`);
  process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
