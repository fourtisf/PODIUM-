// Second account: takes the first account's challenge link, then creates or joins a Duck Dash duel.
//   BASE=... SHOTS=... API_LOG=... CODE=<challenge code> node e2e/versus.cjs   (run after flow.cjs)
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const BASE = process.env.BASE || 'http://localhost:3000';
const SHOTS = process.env.SHOTS || path.join(__dirname, 'shots');
const API_LOG = process.env.API_LOG;
const CODE = process.env.CODE;
const problems = [];
const bad = (m) => { problems.push(m); console.log('PROBLEM: ' + m); };
const shot = (page, name, full = false) => page.screenshot({ path: path.join(SHOTS, `web-${name}.png`), fullPage: full });
const lastCode = (email) => {
  for (const l of fs.readFileSync(API_LOG, 'utf8').trim().split('\n').reverse()) {
    try { const j = JSON.parse(l); if (j.email === email && j.code) return j.code; } catch { /* not json */ }
  }
  return null;
};
async function play(page, keys) {
  const t0 = Date.now();
  while (!(await page.$('#panel.on')) && Date.now() - t0 < 180000) {
    await page.keyboard.press(keys[Math.floor(Math.random() * keys.length)]);
    await page.waitForTimeout(200 + Math.random() * 250);
  }
  await page.waitForTimeout(1500);
  return page.evaluate(() => ({
    title: document.querySelector('#rTitle')?.textContent, score: document.querySelector('#rScore')?.textContent,
    badges: [...document.querySelectorAll('#rBadges span')].map((s) => s.textContent), info: document.querySelector('#rInfo')?.textContent,
    rows: [...document.querySelectorAll('#rBoard tr')].map((r) => r.textContent),
  }));
}

(async () => {
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  page.on('console', (m) => { if (m.type() === 'error') bad('console: ' + m.text().slice(0, 300)); });
  page.on('pageerror', (e) => bad('pageerror: ' + String(e).slice(0, 300)));

  // ---- challenge landing: sheet over the home page, sign-in needed to take it
  await page.goto(`${BASE}/c/${CODE}`, { waitUntil: 'networkidle' });
  await page.waitForSelector('#chal');
  await shot(page, 'd-challenge');
  console.log('challenge sheet: ' + (await page.textContent('#chal h3')) + ' / ' + (await page.textContent('#chal p')));
  console.log('og:image: ' + (await page.getAttribute('meta[property="og:image"]', 'content')));
  console.log('twitter:card: ' + (await page.getAttribute('meta[name="twitter:card"]', 'content')));
  await page.click('#chal .btn.go');
  await page.waitForSelector('#signin');
  const email = `e2e-b-${Date.now()}@example.com`;
  await page.fill('#signin input[type=email]', email);
  await page.click('#signin .field .sbtn');
  await page.waitForSelector('#signin input[inputmode=numeric]');
  await page.waitForTimeout(500);
  await page.fill('#signin input[inputmode=numeric]', lastCode(email) || '000000');
  await page.check('#signin .agree input');
  await page.click('#signin form:has(input[inputmode=numeric]) .sbtn');
  await page.waitForSelector('#signin', { state: 'detached', timeout: 10000 });
  await page.waitForSelector('#chal');
  await page.click('#chal .btn.go');
  await page.waitForURL(/mode=challenge/);
  await page.waitForSelector('#cdn.on', { timeout: 15000 });
  await page.waitForTimeout(2500);
  console.log('challenge HUD: ' + (await page.textContent('#oPlace')) + ' | ' + (await page.textContent('#oTarget')));
  const ch = await play(page, ['ArrowLeft', 'ArrowRight']);
  console.log('challenge result: ' + JSON.stringify(ch));
  await shot(page, 'd-challenge-result');
  if (!/^Challenge from /.test(ch.title || '')) bad('challenge title: ' + ch.title);
  await page.keyboard.press('Escape');
  await page.waitForURL(BASE + '/');

  // ---- join the waiting duel (Duck Dash, 100)
  await page.goto(BASE + '/duels', { waitUntil: 'networkidle' });
  await page.click('#duelL .chips button:has-text("Duck Dash")');
  await page.click('#dFind');
  await page.waitForSelector('#dPlay', { timeout: 10000 });
  await page.waitForTimeout(4500);
  await shot(page, 'd-duel-vs', true);
  console.log('vs panel: ' + (await page.textContent('.vs')));
  // Joins when the first account left a duel waiting at this game and stake; otherwise it creates one.
  await page.click('#dPlay');
  await page.waitForURL(/mode=duel/);
  await page.waitForSelector('#cdn.on', { timeout: 15000 });
  await page.waitForTimeout(2500);
  console.log('duel HUD: ' + (await page.textContent('#oPlace')) + ' | ' + (await page.textContent('#oTarget')));
  const d = await play(page, ['ArrowLeft', 'ArrowRight']);
  console.log('duel result: ' + JSON.stringify(d));
  await shot(page, 'd-duel-result');
  if (!d.badges.some((b) => b === 'Duel won' || b === 'Duel lost' || b === 'Waiting for an opponent')) bad('unexpected duel badges: ' + JSON.stringify(d.badges));
  await page.keyboard.press('Escape');
  await page.waitForURL(BASE + '/duels');
  await page.waitForTimeout(1000);
  await shot(page, 'd-duel-history', true);
  console.log('history: ' + (await page.textContent('#duelR')));
  console.log('balance: ' + (await page.textContent('#bal')));
  await browser.close();
  console.log(problems.length ? `\n${problems.length} problem(s)` : '\nno problems');
  process.exit(problems.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
