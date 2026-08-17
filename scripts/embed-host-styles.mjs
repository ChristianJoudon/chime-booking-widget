#!/usr/bin/env node
/**
 * Verifies the embeddable widget against hostile host-page styles.
 *
 * The widget is dropped onto small-business websites nobody here controls, and
 * those sites carry whatever CSS they carry. A global `box-sizing: content-box`,
 * a 32px root font, a framework that makes every input full-width — any of
 * those can turn a working widget into a broken one on someone else's site, and
 * the business owner sees it before we do.
 *
 * The check runs in both directions, because both are the same bug:
 *
 *   in   host CSS reaching into the widget and changing its layout
 *   out  widget CSS escaping and changing the host page around it
 *
 * Method: render the widget on a neutral page and record a layout fingerprint —
 * box sizes and the computed styles that matter — then render it again under
 * each hostile stylesheet and compare. Anything that moves is leakage. The host
 * page's own elements are fingerprinted the same way against a copy of the page
 * with no widget on it at all.
 *
 * This only reads dist-embed/. The widget's own source is not standalone
 * territory (see ISOLATION.md), so this reports what breaks rather than
 * changing it, and it never runs `npm run build:embed`, which would empty
 * dist-embed/.
 *
 * Usage:
 *   npm run test:embed-host-styles
 *
 * Requires a built widget in dist-embed/. Nothing else — the host pages supply
 * services and availability inline, so no API or database is involved.
 */

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import process from 'node:process';

import puppeteer from 'puppeteer-core';

const ROOT = new URL('..', import.meta.url).pathname;
const CHROME_CANDIDATES = [
  process.env.CHIME_CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter(Boolean);

/**
 * Host stylesheets that break embedded widgets in the wild. Each is something a
 * real site does for its own reasons, not a contrived attack.
 */
const HOSTILE_HOSTS = [
  {
    id: 'content-box',
    what: 'a site that sets box-sizing globally, the way older stylesheets do',
    css: '* { box-sizing: content-box !important; }',
  },
  {
    id: 'hard-reset',
    what: 'an aggressive reset that zeroes every margin and padding',
    css: '* { margin: 0 !important; padding: 0 !important; }',
  },
  {
    id: 'large-root-font',
    what: 'a site with a 32px root font, which rescales anything sized in rem',
    css: 'html { font-size: 32px; }',
  },
  {
    id: 'global-typography',
    what: 'a site that forces its own font on every element',
    css: 'body, div, span, p, h1, h2, h3, button, input, select, label '
      + '{ font-family: Georgia, serif !important; font-size: 22px !important; }',
  },
  {
    id: 'full-width-controls',
    what: 'a framework that makes form controls block-level and full width',
    css: 'button, input, select, textarea { display: block !important; width: 100% !important; }',
  },
  {
    id: 'tall-line-height',
    what: 'a site with a generous global line height',
    css: '* { line-height: 3 !important; }',
  },
  {
    id: 'fluid-media',
    what: 'the near-universal responsive-image rule',
    css: 'img, svg { max-width: 100% !important; height: auto !important; }',
  },
  {
    id: 'rtl',
    what: 'a right-to-left site',
    css: 'html { direction: rtl; }',
  },
];

/** Widget elements whose geometry a business owner would notice moving. */
const WIDGET_PROBES = [
  '.chime-widget',
  '.chime-widget button',
  '.chime-widget input',
  '.chime-widget h1, .chime-widget h2',
];

/**
 * Tolerance in CSS pixels.
 *
 * Not zero: sub-pixel layout and font metrics move things by a fraction across
 * otherwise identical renders, and failing on that would make the check noise.
 * Two pixels is well below anything a person would call a visual change.
 */
const TOLERANCE = 2;

const failures = [];
const passes = [];

function check(name, condition, detail) {
  if (condition) passes.push(name);
  else failures.push({ name, detail });
}

function resolveChrome() {
  const found = CHROME_CANDIDATES.find((path) => existsSync(path));
  if (!found) {
    console.error('No Chrome found. Set CHIME_CHROME_PATH to a Chrome or Chromium binary.');
    process.exit(2);
  }
  return found;
}

/** The host page, with `hostCss` injected and the widget optionally omitted. */
function hostPage({ hostCss = '', withWidget = true }) {
  const services = [
    { id: 'diagnostic', name: 'Diagnostic Visit', description: 'A technician inspects the issue.', durationMinutes: 30, depositAmountCents: 2000 },
    { id: 'repair', name: 'Repair Session', description: 'Hands-on repair work.', durationMinutes: 60, depositAmountCents: 2000 },
  ];
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  /* The host's own look. Distinctive on purpose: if the widget leaks, these
     move, and the check reports which. */
  body { font-family: Georgia, serif; background: #f4ecdd; margin: 0; padding: 24px; }
  h1.host-title { color: #5a3e2b; font-size: 40px; font-style: italic; margin: 0 0 12px; }
  p.host-copy { color: #4a3728; font-size: 18px; line-height: 1.6; margin: 0 0 16px; }
  button.host-button { background: #fff; border: 2px dashed #5a3e2b; color: #5a3e2b;
                       font-family: Georgia, serif; font-size: 16px; padding: 10px 18px; }

  /* The mount point is pinned so every host renders the widget in the same box.
     Without this the comparison measured the host's layout as much as the
     widget's: an aggressive reset removes this page's own body padding, the
     container grows 48px, and the widget correctly fills it. That is an
     embedded component behaving properly, and it was being reported as
     leakage. Holding the container constant isolates the widget's own
     rendering, which is what this check is for. */
  #chime-widget-root { width: 1000px; }
</style>
<style>${hostCss}</style>
<link rel="stylesheet" href="/dist-embed/chime-widget.css">
</head>
<body>
  <h1 class="host-title">Acme Repair Co.</h1>
  <p class="host-copy">Everything here belongs to the host page.</p>
  <button class="host-button" type="button">Host button</button>
  ${withWidget ? '<div id="chime-widget-root"></div>' : ''}
  <p class="host-copy host-after">This paragraph sits after the widget.</p>
<script>
window.CHIME_WIDGET_CONFIG = {
  businessName: 'Acme Repair Co.',
  location: '123 Main St, Honolulu, HI',
  payment: { demoMode: true },
  services: ${JSON.stringify(services)},
  availability: (function () {
    var days = [], start = new Date();
    for (var i = 1; i <= 10; i++) {
      var d = new Date(start); d.setDate(d.getDate() + i);
      days.push({ date: d.toISOString().slice(0, 10),
                  slots: ['09:00', '10:30', '13:00', '15:30'] });
    }
    return days;
  })()
};
</script>
${withWidget ? '<script src="/dist-embed/chime-widget.js" defer></script>' : ''}
</body>
</html>`;
}

const MIME = {
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
};

/**
 * Serves the repository, plus synthesised host pages at /host/<id>.
 *
 * The pages are generated rather than written to disk so this never adds files
 * to the repository just to test it.
 */
function startServer(pages) {
  return new Promise((resolve) => {
    const server = createServer(async (request, response) => {
      const url = new URL(request.url, 'http://localhost');
      const page = pages.get(url.pathname);
      if (page) {
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        response.end(page);
        return;
      }
      // Normalised and prefix-checked so a crafted path cannot escape the repo.
      const filePath = normalize(join(ROOT, decodeURIComponent(url.pathname)));
      if (!filePath.startsWith(normalize(ROOT)) || !existsSync(filePath)) {
        response.writeHead(404).end('not found');
        return;
      }
      try {
        const body = await readFile(filePath);
        response.writeHead(200, {
          'Content-Type': MIME[extname(filePath)] ?? 'application/octet-stream',
        });
        response.end(body);
      } catch {
        response.writeHead(500).end('read error');
      }
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

/** Box sizes and the computed styles that reveal inherited host CSS. */
async function fingerprint(page, selectors) {
  return page.evaluate((list) => {
    const record = {};
    for (const selector of list) {
      const elements = [...document.querySelectorAll(selector)].slice(0, 6);
      record[selector] = elements.map((element) => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return {
          w: Math.round(rect.width),
          h: Math.round(rect.height),
          fontSize: style.fontSize,
          fontFamily: style.fontFamily.split(',')[0].trim(),
          boxSizing: style.boxSizing,
          lineHeight: style.lineHeight,
          direction: style.direction,
        };
      });
    }
    return record;
  }, selectors);
}

function compare(baseline, actual, label) {
  const differences = [];
  for (const [selector, baseElements] of Object.entries(baseline)) {
    const nowElements = actual[selector] ?? [];
    if (baseElements.length !== nowElements.length) {
      differences.push(
        `${selector}: ${baseElements.length} element(s) normally, ${nowElements.length} here`,
      );
      continue;
    }
    baseElements.forEach((base, index) => {
      const now = nowElements[index];
      if (Math.abs(base.w - now.w) > TOLERANCE || Math.abs(base.h - now.h) > TOLERANCE) {
        differences.push(`${selector}[${index}]: ${base.w}x${base.h} normally, ${now.w}x${now.h} under ${label}`);
      }
      // `direction` is deliberately not compared. A widget on a right-to-left
      // site should inherit right-to-left — that is the page working, not host
      // CSS leaking. What would matter is the layout breaking, and geometry
      // above already catches that.
      for (const property of ['fontSize', 'fontFamily', 'boxSizing', 'lineHeight']) {
        if (base[property] !== now[property]) {
          differences.push(`${selector}[${index}] ${property}: "${base[property]}" normally, "${now[property]}" under ${label}`);
        }
      }
    });
  }
  return differences;
}

async function render(browser, url) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1100, height: 900 });
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
  // The widget mounts on defer, so wait for it rather than a fixed delay.
  await page.waitForSelector('.chime-widget', { timeout: 15000 }).catch(() => {});
  await new Promise((resolve) => setTimeout(resolve, 700));
  return page;
}

async function main() {
  if (!existsSync(join(ROOT, 'dist-embed/chime-widget.js'))) {
    console.error(
      'dist-embed/chime-widget.js is missing. Build the embed first with\n'
      + '  npm run build:embed\n'
      + 'noting that it empties dist-embed/ (see ISOLATION.md).',
    );
    process.exit(2);
  }

  const pages = new Map();
  pages.set('/host/neutral', hostPage({}));
  pages.set('/host/no-widget', hostPage({ withWidget: false }));
  for (const host of HOSTILE_HOSTS) {
    pages.set(`/host/${host.id}`, hostPage({ hostCss: host.css }));
  }

  const { server, port } = await startServer(pages);
  const browser = await puppeteer.launch({
    executablePath: resolveChrome(),
    headless: 'shell',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });

  try {
    const base = `http://127.0.0.1:${port}`;

    const neutral = await render(browser, `${base}/host/neutral`);
    const mounted = await neutral.evaluate(() => !!document.querySelector('.chime-widget'));
    check('the widget renders on a neutral host page', mounted,
      'no .chime-widget element appeared, so nothing below tests anything');
    if (!mounted) return;

    const widgetBaseline = await fingerprint(neutral, WIDGET_PROBES);
    const hostWithWidget = await fingerprint(neutral, ['h1.host-title', 'p.host-copy', 'button.host-button']);
    await neutral.close();

    // --- outward direction: does the widget change the page around it? ---
    const bare = await render(browser, `${base}/host/no-widget`);
    const hostAlone = await fingerprint(bare, ['h1.host-title', 'p.host-copy', 'button.host-button']);
    await bare.close();

    const leaked = compare(hostAlone, hostWithWidget, 'the widget being present');
    check(
      'the widget changes nothing on the host page',
      leaked.length === 0,
      leaked.join('\n        '),
    );

    // --- inward direction: does host CSS reach into the widget? ---
    for (const host of HOSTILE_HOSTS) {
      const page = await render(browser, `${base}/host/${host.id}`);
      const present = await page.evaluate(() => !!document.querySelector('.chime-widget'));
      if (!present) {
        check(`survives ${host.id}`, false, `the widget did not render at all on ${host.what}`);
        await page.close();
        continue;
      }
      const actual = await fingerprint(page, WIDGET_PROBES);
      await page.close();

      const differences = compare(widgetBaseline, actual, host.id);
      check(
        `survives ${host.id}`,
        differences.length === 0,
        `${host.what}\n        ` + differences.slice(0, 8).join('\n        ')
          + (differences.length > 8 ? `\n        ...and ${differences.length - 8} more` : ''),
      );
    }
  } finally {
    await browser.close();
    server.close();
  }

  for (const name of passes) console.log(`  ok    ${name}`);
  for (const failure of failures) {
    console.log(`  FAIL  ${failure.name}`);
    if (failure.detail) console.log(`        ${failure.detail}`);
  }

  if (failures.length) {
    console.log(`\nFAIL  ${failures.length} of ${passes.length + failures.length} host conditions break the widget`);
    process.exit(1);
  }
  console.log(`\nPASS  the widget holds its shape across ${passes.length} host conditions`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
