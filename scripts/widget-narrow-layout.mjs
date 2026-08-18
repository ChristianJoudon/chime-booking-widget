#!/usr/bin/env node
/*
 * What the booking widget costs a customer on a phone, measured in scrolling.
 *
 * The existing host-styles suite proves the widget does not overflow or clip at
 * narrow widths, and it doesn't. That turned out to be the easy half. What it
 * never asked was how *tall* the result is, and the answer at 320px was a
 * calendar step nearly nineteen hundred pixels long — a month grid stacked on
 * top of every time in the day, roughly three phone screens of scrolling to
 * pick one appointment.
 *
 * Nothing was broken. It was simply unusable, and no check could see it,
 * because every check was looking sideways.
 *
 *   npm run dev            # in another terminal
 *   node scripts/widget-narrow-layout.mjs
 *
 * Needs only the widget dev server — not the API, and not the database. The
 * widget's dev entry renders from src/data/sampleServices.ts, so the layout
 * under test is the same on every machine and on a build agent with no
 * Postgres. That is a virtue here: this measures the shape of the widget, and a
 * shape that changed because someone edited a seed would be a false alarm.
 */

import { existsSync } from 'node:fs';
import process from 'node:process';

import puppeteer from 'puppeteer-core';

const CHROME = [
  process.env.CHIME_CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter(Boolean).find((candidate) => existsSync(candidate));

if (!CHROME) {
  console.error('No Chrome found. Set CHIME_CHROME_PATH to a Chrome or Chromium binary.');
  process.exit(2);
}

const WIDGET_URL = process.env.CHIME_WIDGET_URL ?? 'http://localhost:5373/';

/*
 * Budgets in pixels of rendered height, per container width.
 *
 * A phone shows roughly 700 logical pixels at a time, so these are expressed as
 * "screens of scrolling a customer must do to get through this step". Two and a
 * half screens is the ceiling for choosing a time — past that people lose their
 * place between the date they tapped and the times below it.
 *
 * The numbers are deliberately not tight. This exists to catch a step growing
 * to three thousand pixels again, not to police a fifty-pixel change.
 */
const PHONE_SCREEN = 700;
/*
 * The reserve step gets the same allowance at every width, and the others
 * tighten as the container grows.
 *
 * Because the reserve step does not reflow. A month grid gets wider and
 * shorter; a terms document, a receipt and a checkbox are a vertical stack of
 * fixed things whether the container is 320px or 600px — measured at 2377,
 * 2239 and 2136, which is nearly flat. Giving 600px a tighter number was a
 * guess made before that step had ever been measured, and it failed for that
 * reason rather than for anything about the layout.
 */
const BUDGETS = {
  320: { service: 3.0, calendar: 2.5, terms: 3.5 },
  375: { service: 3.0, calendar: 2.5, terms: 3.5 },
  600: { service: 2.5, calendar: 2.5, terms: 3.5 },
};

/*
 * How far down the button that finishes the step sits.
 *
 * The more useful number, and the one that found the real problem. The terms
 * step measured 2428px, which is bad but survivable — what made it unusable was
 * that the button finishing it sat at 2248px, disabled until a checkbox further
 * up had been found. Almost three screens down, with nothing at the top to say
 * so.
 *
 * A page can be long for good reasons; a legal document is one. What a customer
 * cannot afford is the *action* being long away. Terms get more room because
 * the document above the button is the point of the step.
 */
/*
 * Terms gets more room than the others on purpose. Its action sits below a
 * document the customer is required to scroll through — that height is the
 * step working, not waste. The others have nothing below them that has to be
 * read, so 2.5 screens is already generous there.
 */
const REACH_BUDGET = { service: 2.5, calendar: 2.5, terms: 2.75 };
const PRIMARY_ACTION = {
  service: /Continue to calendar/i,
  calendar: /Continue to terms/i,
  terms: /Continue to contact details/i,
};

const WIDTHS = Object.keys(BUDGETS).map(Number);

const findings = [];
let browser;

try {
  browser = await puppeteer.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 1000, deviceScaleFactor: 1 });

  /*
   * Retried, because a cold Vite reloads the page out from under us.
   *
   * On its first request Vite optimises dependencies and then forces a full
   * reload. If that lands while our own navigation is in flight, Puppeteer
   * throws "Navigating frame was detached" — which is not a fault in the page,
   * only a race with the dev server warming up. It happens on a build agent,
   * where the server is always cold, and essentially never at a keyboard, where
   * it has been running for minutes. Retrying is the difference between a check
   * and a flaky check.
   */
  const load = async () => {
    let lastError;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        await page.goto(WIDGET_URL, { waitUntil: 'networkidle0', timeout: 60_000 });
        await page.waitForSelector('.chime-widget', { timeout: 30_000 });
        return;
      } catch (error) {
        lastError = error;
        await new Promise((resolve) => setTimeout(resolve, 1500));
      }
    }
    throw lastError;
  };

  await load();

  const setWidth = (width) =>
    page.evaluate((value) => {
      const host = document.querySelector('.chime-widget').parentElement;
      host.style.width = `${value}px`;
      host.style.maxWidth = `${value}px`;
      host.style.margin = '0';
    }, width);

  const clickText = (pattern) =>
    page.evaluate((source) => {
      const test = new RegExp(source, 'i');
      const button = [...document.querySelectorAll('.chime-widget button')]
        .find((candidate) => test.test(candidate.textContent || ''));
      if (!button) return false;
      button.click();
      return true;
    }, pattern);

  const settle = (ms = 500) => new Promise((resolve) => setTimeout(resolve, ms));

  const measure = (stepName) =>
    page.evaluate((pattern) => {
      const action = pattern
        ? [...document.querySelectorAll('.chime-widget button')]
            .find((button) => new RegExp(pattern, 'i').test(button.textContent || ''))
        : null;
      const actionTop = action
        ? Math.round(action.getBoundingClientRect().top - document.querySelector('.chime-widget').getBoundingClientRect().top)
        : null;
      return { actionTop, ...(() => {
      const root = document.querySelector('.chime-widget');
      const stage = root.querySelector('.chime-stage') ?? root;
      const tallest = [...stage.querySelectorAll('*')]
        .map((element) => ({
          className: (element.className || '').toString().trim().split(/\s+/)[0] || element.tagName.toLowerCase(),
          height: Math.round(element.getBoundingClientRect().height),
        }))
        .filter((entry) => entry.height > 40)
        .sort((a, b) => b.height - a.height)
        .slice(0, 3);
      return {
        widgetHeight: Math.round(root.getBoundingClientRect().height),
        stageHeight: Math.round(stage.getBoundingClientRect().height),
        tallest,
      };
      })() };
    }, PRIMARY_ACTION[stepName]?.source ?? null);

  for (const width of WIDTHS) {
    // Back to the start for each width, so a step is always measured from the
    // same place rather than from wherever the previous width left the flow.
    await load();
    await setWidth(width);
    await settle();

    const steps = [];
    steps.push({ name: 'service', ...(await measure('service')) });

    const picked = await clickText('min\\s*•|Consultation|Repair|Installation');
    await settle(400);
    const advanced = picked && (await clickText('Continue to calendar|Continue'));
    await settle(1600);
    if (advanced) steps.push({ name: 'calendar', ...(await measure('calendar')) });

    // A time, then the reserve step — the one a customer said they could not
    // scroll to the end of, and the only one with a gated action.
    const slot = advanced && (await page.evaluate(() => {
      const button = document.querySelector('.chime-widget .time-slot-button:not([disabled])');
      if (!button) return false;
      button.click();
      return true;
    }));
    await settle(700);
    const reserved = slot && (await clickText('Continue to terms'));
    await settle(1600);
    if (reserved) steps.push({ name: 'terms', ...(await measure('terms')) });

    for (const step of steps) {
      const budget = BUDGETS[width][step.name];
      if (budget === undefined) continue;
      const screens = step.widgetHeight / PHONE_SCREEN;
      const reachScreens = step.actionTop === null ? null : step.actionTop / PHONE_SCREEN;
      const reachBudget = REACH_BUDGET[step.name];
      const ok =
        screens <= budget && (reachScreens === null || reachScreens <= reachBudget);
      findings.push({
        width,
        step: step.name,
        height: step.widgetHeight,
        screens,
        budget,
        reachScreens,
        reachBudget,
        ok,
        tallest: step.tallest,
      });
    }
  }
} catch (error) {
  findings.push({ fatal: error instanceof Error ? error.message : String(error) });
} finally {
  await browser?.close();
}

/*
 * Reported from a finally, and a run that measured nothing fails.
 *
 * A layout check that silently measures zero steps and exits green is worse
 * than no check, because it is quoted as evidence.
 */
const fatal = findings.filter((entry) => entry.fatal);
const measured = findings.filter((entry) => !entry.fatal);

for (const entry of measured) {
  const mark = entry.ok ? 'ok  ' : 'FAIL';
  const reach =
    entry.reachScreens === null || entry.reachScreens === undefined
      ? ''
      : `  action ${entry.reachScreens.toFixed(1)} down (budget ${entry.reachBudget.toFixed(1)})`;
  console.log(
    `  ${mark}  ${String(entry.width).padStart(3)}px  ${entry.step.padEnd(9)} ` +
      `${String(entry.height).padStart(5)}px  ${entry.screens.toFixed(1)} screens (budget ${entry.budget.toFixed(1)})${reach}`,
  );
  if (!entry.ok) {
    for (const item of entry.tallest) console.log(`          tallest: .${item.className} ${item.height}px`);
  }
}

for (const entry of fatal) console.error(`\n  FAIL  ${entry.fatal}`);

const failed = measured.filter((entry) => !entry.ok).length + fatal.length;
if (measured.length === 0) {
  console.error('\n  FAIL  nothing was measured.');
  process.exit(1);
}
console.log(
  failed === 0
    ? `\n  PASS  ${measured.length} step measurements within budget`
    : `\n  FAIL  ${failed} of ${measured.length} over budget`,
);
process.exit(failed === 0 ? 0 : 1);
