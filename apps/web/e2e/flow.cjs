// End-to-end walk through the real stack with Playwright (installed globally; not a dependency).
//   BASE=http://localhost:3100 SHOTS=/path/to/shots API_LOG=/path/to/api.log node e2e/flow.cjs
// The API must run without SMTP outside production, so sign-in codes are written to its log.
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const BASE = process.env.BASE || 'http://localhost:3000';
const SHOTS = process.env.SHOTS || path.join(__dirname, 'shots');
const API_LOG = process.env.API_LOG || '';
const PAGES = [['games', '/'], ['duels', '/duels'], ['board', '/leaderboard'], ['shop', '/shop'], ['about', '/rules'], ['profile', '/profile']];
const problems = [];
const note = (m) => { console.log(m); };
const bad = (m) => { problems.push(m); console.log('PROBLEM: ' + m); };

function watch(page, tag) {
  page.on('console', (m) => { if (m.type() === 'error') bad(`[${tag}] console: ${m.text().slice(0, 300)}`); });
  page.on('pageerror', (e) => bad(`[${tag}] pageerror: ${String(e).slice(0, 300)}`));
}
const shot = (page, name, full = true) => page.screenshot({ path: path.join(SHOTS, `web-${name}.png`), fullPage: full });

async function overflow(page, tag) {
  const o = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
  if (o.sw > o.iw + 1) bad(`[${tag}] horizontal overflow: scrollWidth ${o.sw} > ${o.iw}`);
}

async function playToDeath(page, tag, keys) {
  await page.waitForSelector('#cdn.on', { timeout: 15000 });
  await page.waitForFunction(() => !document.querySelector('#cdn').classList.contains('on'), null, { timeout: 8000 });
  await page.waitForTimeout(1200);
  await shot(page, `${tag}-ingame`, false);
  const t0 = Date.now();
  while (!(await page.$('#panel.on'))) {
    if (keys) { await page.keyboard.press(keys[Math.floor(Math.random() * keys.length)]); }
    await page.waitForTimeout(keys ? 180 + Math.random() * 240 : 300);
    if (Date.now() - t0 > 180000) { bad(`[${tag}] run did not end in 3 minutes`); break; }
  }
  await page.waitForTimeout(1500);
  await shot(page, `${tag}-result`, false);
  return page.evaluate(() => ({
    title: document.querySelector('#rTitle')?.textContent,
    score: document.querySelector('#rScore')?.textContent,
    live: document.querySelector('#oScore')?.textContent,
    badges: [...document.querySelectorAll('#rBadges span')].map((s) => s.textContent),
    info: document.querySelector('#rInfo')?.textContent,
    rows: [...document.querySelectorAll('#rBoard tr')].map((r) => r.textContent),
  }));
}

function lastCode(email) {
  const lines = fs.readFileSync(API_LOG, 'utf8').trim().split('\n').reverse();
  for (const l of lines) {
    try { const j = JSON.parse(l); if (j.email === email && j.code) return j.code; } catch { /* not json */ }
  }
  return null;
}

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  watch(page, 'desktop');

  // ---- welcome -> guest
  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  await page.waitForSelector('#welcome');
  await shot(page, 'd-welcome', false);
  await page.fill('#welcome input', 'Tester');
  await page.click('#welcome .btn.go');
  await page.waitForSelector('#welcome', { state: 'detached', timeout: 10000 });
  await page.waitForTimeout(600);
  note('guest name: ' + (await page.textContent('.mechip span:not(.avw)')));
  await page.waitForTimeout(4500); // let the toast go
  await shot(page, 'd-games');
  await overflow(page, 'd-games');

  // ---- pre-game sheet
  await page.click('#hero .btn.go');
  await page.waitForSelector('#sheetS');
  await shot(page, 'd-sheet', false);
  await page.keyboard.press('Escape');

  // ---- practice run of Duck Dash to death
  await page.click('#classics .mc:has-text("Duck Dash") .sbtn.lt');
  await page.waitForURL(/\/play\/duck/);
  const practice = await playToDeath(page, 'd');
  note('practice result: ' + JSON.stringify(practice));
  if (practice.title !== 'Practice run') bad('practice result title: ' + practice.title);
  if (!practice.badges.includes('Not recorded')) bad('practice result has no "Not recorded" badge');
  await page.keyboard.press('Escape');
  await page.waitForURL(BASE + '/');

  // ---- every page, desktop
  for (const [name, url] of PAGES.slice(1)) {
    await page.goto(BASE + url, { waitUntil: 'networkidle' });
    await shot(page, `d-${name}`);
    await overflow(page, `d-${name}`);
  }

  // ---- a guest who taps Ranked gets the sign-in sheet
  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  await page.click('#cards .gc >> nth=0 >> .btn.go');
  await page.waitForSelector('#signin');
  await shot(page, 'd-signin', false);

  if (API_LOG) {
    const email = `e2e${Date.now()}@example.com`;
    await page.fill('#signin input[type=email]', email);
    await page.click('#signin .field .sbtn');
    await page.waitForSelector('#signin input[inputmode=numeric]');
    await page.waitForTimeout(500);
    const code = lastCode(email);
    if (!code) bad('no sign-in code in the API log');
    await page.fill('#signin input[inputmode=numeric]', code || '000000');
    // Without the age box sign-up is refused.
    await page.click('#signin form:has(input[inputmode=numeric]) .sbtn');
    await page.waitForTimeout(600);
    if (!(await page.$('#signin'))) bad('sign-in went through without the 18+ box');
    await page.check('#signin .agree input');
    await page.click('#signin form:has(input[inputmode=numeric]) .sbtn');
    await page.waitForSelector('#signin', { state: 'detached', timeout: 10000 });
    await page.waitForTimeout(800);
    note('signed in as: ' + (await page.textContent('.mechip span:not(.avw)')) + ', balance ' + (await page.textContent('#bal')));

    // ---- ranked run with the live stream, played with the keyboard
    await page.click('#classics .mc:has-text("Duck Dash") .sbtn:not(.lt)');
    await page.waitForURL(/\/play\/duck\?mode=ranked/);
    const ranked = await playToDeath(page, 'd-ranked', ['ArrowLeft', 'ArrowRight']);
    note('ranked result: ' + JSON.stringify(ranked));
    if (ranked.title !== 'Ranked run') bad('ranked result title: ' + ranked.title);
    if (ranked.badges.includes('Not recorded')) bad('ranked run was not recorded: ' + ranked.info);
    if (ranked.score !== ranked.live) bad(`server score ${ranked.score} differs from the live score ${ranked.live}`);
    // share sheet
    await page.click('#shareB');
    await page.waitForSelector('#share', { timeout: 10000 });
    await page.waitForTimeout(500);
    await shot(page, 'd-share', false);
    await page.click('#share .x');
    await page.keyboard.press('Escape');
    await page.waitForURL(BASE + '/');
    await page.waitForTimeout(700);
    note('balance after ranked: ' + (await page.textContent('#bal')));
    await page.goto(BASE + '/leaderboard?game=duck', { waitUntil: 'networkidle' });
    await shot(page, 'd-board-duck');
    const rows = await page.$$eval('#board tr', (r) => r.map((x) => x.textContent));
    note('duck board: ' + JSON.stringify(rows));
    if (!(await page.$('#board tr.me'))) bad('my row is not highlighted on the board');
    await page.goto(BASE + '/', { waitUntil: 'networkidle' });
    await shot(page, 'd-games-signed');
    await page.goto(BASE + '/profile', { waitUntil: 'networkidle' });
    await shot(page, 'd-profile-signed');
    // ---- duel: create, play, waiting state
    await page.goto(BASE + '/duels', { waitUntil: 'networkidle' });
    await page.click('#duelL .chips button:has-text("Duck Dash")');
    await page.click('#dFind');
    await page.waitForSelector('#dPlay', { timeout: 10000 });
    await shot(page, 'd-duel-open');
    await page.click('#dPlay');
    await page.waitForURL(/mode=duel/);
    const duel = await playToDeath(page, 'd-duel', ['ArrowLeft', 'ArrowRight']);
    note('duel result: ' + JSON.stringify(duel));
    await page.keyboard.press('Escape');
    await page.waitForURL(BASE + '/duels');
    await page.waitForTimeout(800);
    await shot(page, 'd-duel-waiting');
    // ---- a 3D game renders (practice)
    await page.goto(BASE + '/play/hopper?mode=practice', { waitUntil: 'load' });
    await page.waitForSelector('#cdn.on', { timeout: 20000 });
    await page.waitForTimeout(3200);
    await shot(page, 'd-ingame-3d', false);
    await page.keyboard.press('Escape');
    await page.waitForSelector('#pauseP.on');
    await shot(page, 'd-pause', false);
    await page.click('#leave');
    await page.waitForURL(BASE + '/');
  }

  // ---- phone
  const state = await ctx.storageState();
  const mctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, storageState: state });
  const m = await mctx.newPage();
  watch(m, 'phone');
  for (const [name, url] of PAGES) {
    await m.goto(BASE + url, { waitUntil: 'networkidle' });
    await shot(m, `m-${name}`);
    await overflow(m, `m-${name}`);
  }
  await m.goto(BASE + '/', { waitUntil: 'networkidle' });
  await m.tap('#hero .btn.go');
  await m.waitForSelector('#sheetS');
  await shot(m, 'm-sheet', false);
  await m.tap('#sheetS .mode.alt');
  await m.waitForURL(/\/play\//);
  await m.waitForSelector('#cdn.on', { timeout: 20000 });
  await m.waitForTimeout(3000);
  await shot(m, 'm-ingame', false);
  if (!(await m.$('body.touch .pad button'))) bad('touch pad missing on a touch device');
  await overflow(m, 'm-ingame');
  const t0 = Date.now();
  while (!(await m.$('#panel.on')) && Date.now() - t0 < 120000) await m.waitForTimeout(400);
  await m.waitForTimeout(1200);
  await shot(m, 'm-result', false);

  // ---- a fresh phone visitor sees the welcome sheet
  const fctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const f = await fctx.newPage();
  await f.goto(BASE + '/', { waitUntil: 'networkidle' });
  await shot(f, 'm-welcome', false);

  await browser.close();
  console.log(problems.length ? `\n${problems.length} problem(s)` : '\nno problems');
  process.exit(problems.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
