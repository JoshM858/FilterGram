// Loads site/filtergram.user.js into mock instagram.com pages in headless
// Chromium and checks the behaviours. Instagram's real markup is obfuscated and
// changes often, so the mocks only model the stable parts the script relies on
// (link hrefs, <article>, URL paths).
//
//   node test/run.mjs   (set CHROMIUM_PATH to use an existing Chromium binary)
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright'); // npm i -D playwright, or set NODE_PATH to a global install

const here = dirname(fileURLToPath(import.meta.url));
const script = readFileSync(join(here, '../site/filtergram.user.js'), 'utf8');

const NAV = `
  <nav>
    <div><a href="/">Home</a></div>
    <div><a href="/explore/" id="explore">Explore</a></div>
    <div><a href="/reels/" id="reels">Reels</a></div>
    <div><a href="/direct/inbox/" id="dm">Messages</a></div>
  </nav>`;

const pages = {
  '/': `${NAV}<main>
    <article id="normal"><a href="/p/AAA/">photo</a> friend post</article>
    <article id="reel"><a href="/reel/BBB/">a reel from the feed</a></article>
    <article id="suggested"><span>Suggested for you</span> some post</article>
  </main>`,
  '/direct/inbox/': `${NAV}<main>
    <article id="dm-reel"><a href="/reel/CCC/">reel shared in a DM</a></article>
  </main>`,
  '/someone/': `${NAV}<main>
    <a id="tab-reels" href="/someone/reels/">Reels</a><a id="tab-posts" href="/someone/">Posts</a>
  </main>`,
  '/reel/CCC/': `<main style="height:3000px"><video></video></main>`,
  '/reels/': `<main>the reels feed</main>`,
  '/someone/reels/': `<main>profile reels tab</main>`,
  '/explore/': `<main>explore</main>`,
};

let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  ${detail}`}`);
  if (!ok) failures++;
};

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });

async function open(path, { settings } = {}) {
  const context = await browser.newContext({ hasTouch: true, viewport: { width: 390, height: 800 } });
  const page = await context.newPage();
  await context.route('https://www.instagram.com/**', (route) => {
    const { pathname } = new URL(route.request().url());
    const body = pages[pathname];
    route.fulfill({
      status: body ? 200 : 404,
      contentType: 'text/html',
      body: `<!doctype html><html><head><title>mock</title></head><body>${body ?? 'not found'}</body></html>`,
    });
  });
  await page.addInitScript(
    (s) => { if (s) localStorage.setItem('filtergram:settings:v1', JSON.stringify(s)); },
    settings,
  );
  await page.addInitScript(script);
  await page.goto(`https://www.instagram.com${path}`);
  await page.waitForTimeout(250);
  return { page, context };
}

// "Hidden" = not rendered at all (the element itself or a wrapper has display:none).
const hidden = (page, selector) =>
  page.$eval(selector, (el) => el.getClientRects().length === 0);

// --- home feed
{
  const { page, context } = await open('/');
  check('Reels nav tab hidden', await hidden(page, '#reels'));
  check('Explore nav tab hidden', await hidden(page, '#explore'));
  check('Messages nav tab still visible', !(await hidden(page, '#dm')));
  check('Reel post hidden in feed', await hidden(page, '#reel'));
  check('Suggested post hidden in feed', await hidden(page, '#suggested'));
  check('Normal post still visible', !(await hidden(page, '#normal')));
  check('Settings button mounted', (await page.$('#fg-root')) !== null);
  await context.close();
}

// --- toggles off
{
  const off = { reelsTab: false, feedReels: false, explore: false, suggested: false };
  const { page, context } = await open('/', { settings: off });
  check('Toggles off: Reels tab visible', !(await hidden(page, '#reels')));
  check('Toggles off: reel post visible', !(await hidden(page, '#reel')));
  check('Toggles off: suggested visible', !(await hidden(page, '#suggested')));
  await context.close();
}

// --- DMs keep their reels
{
  const { page, context } = await open('/direct/inbox/');
  check('Reel shared in DM stays visible', !(await hidden(page, '#dm-reel')));
  await context.close();
}

// --- profile
{
  const { page, context } = await open('/someone/');
  check('Profile Reels tab hidden', await hidden(page, '#tab-reels'));
  check('Profile Posts tab visible', !(await hidden(page, '#tab-posts')));
  await context.close();
}

// --- redirects
for (const path of ['/reels/', '/explore/']) {
  const { page, context } = await open(path);
  check(`${path} redirects home`, new URL(page.url()).pathname === '/', page.url());
  await context.close();
}
{
  const { page, context } = await open('/someone/reels/');
  check('/someone/reels/ redirects to profile', new URL(page.url()).pathname === '/someone/', page.url());
  await context.close();
}

// --- single reel lock
{
  const { page, context } = await open('/reel/CCC/');
  check('Single reel is not redirected', new URL(page.url()).pathname === '/reel/CCC/', page.url());
  check('Lock class applied on reel page', await page.evaluate(() => document.documentElement.classList.contains('fg-reel-lock')));
  const prevented = await page.evaluate(() => {
    const out = {};
    const wheel = new WheelEvent('wheel', { deltaY: 400, bubbles: true, cancelable: true });
    document.querySelector('video').dispatchEvent(wheel);
    out.wheel = wheel.defaultPrevented;
    const key = new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true });
    document.querySelector('video').dispatchEvent(key);
    out.key = key.defaultPrevented;
    return out;
  });
  check('Wheel scroll blocked on reel', prevented.wheel);
  check('Arrow-down blocked on reel', prevented.key);
  check('Page scrolling disabled (overflow hidden)', await page.evaluate(() => getComputedStyle(document.documentElement).overflow === 'hidden'));

  // URL jumps to a different reel (Instagram advancing) -> bounce back to the first
  await page.evaluate(() => history.pushState({}, '', '/reel/DDD/'));
  await page.waitForTimeout(400);
  check('Advancing to another reel bounces back', new URL(page.url()).pathname === '/reel/CCC/', page.url());
  await context.close();
}
{
  const { page, context } = await open('/reel/CCC/', { settings: { lockReel: false } });
  const prevented = await page.evaluate(() => {
    const wheel = new WheelEvent('wheel', { deltaY: 400, bubbles: true, cancelable: true });
    document.querySelector('video').dispatchEvent(wheel);
    return wheel.defaultPrevented;
  });
  check('Lock off: scrolling allowed', !prevented);
  await context.close();
}

// --- settings panel round trip
{
  const { page, context } = await open('/');
  await page.evaluate(() => {
    const shadow = document.getElementById('fg-root').shadowRoot;
    const box = shadow.querySelector('input[data-key="explore"]');
    box.checked = false;
    box.dispatchEvent(new Event('change'));
  });
  await page.waitForTimeout(150);
  check('Panel toggle un-hides Explore', !(await hidden(page, '#explore')));
  check('Panel toggle persisted', await page.evaluate(() => JSON.parse(localStorage.getItem('filtergram:settings:v1')).explore === false));
  await context.close();
}

await browser.close();
console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
