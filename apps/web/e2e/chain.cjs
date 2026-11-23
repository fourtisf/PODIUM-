// Chain mode end to end on a LOCAL validator, with Playwright (installed globally) and a fake
// Solana wallet injected as window.solana (backed by a Keypair that lives in this script).
//   wallet sign-in → faucet → deposit → ranked run → shop purchase → withdraw
// then the ledger balance is compared with the wallet's on-chain balance.
//
//   BASE=http://localhost:3100 API=http://127.0.0.1:4100 RPC=http://127.0.0.1:8899 SHOTS=/path node e2e/chain.cjs
// Needs: solana-test-validator with the program, apps/api/scripts/localnet-setup.ts, the API with
// CHAIN_MODE=localnet and a faucet key, and the web app built with NEXT_PUBLIC_CHAIN_MODE=localnet.
// It refuses to run against anything but 127.0.0.1 / localhost.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { chromium } = require('playwright');
const web3 = require(require.resolve('@solana/web3.js', { paths: [__dirname + '/..'] }));
const spl = require(require.resolve('@solana/spl-token', { paths: [__dirname + '/..'] }));

const BASE = process.env.BASE || 'http://localhost:3100';
const API = process.env.API || 'http://127.0.0.1:4100';
const RPC = process.env.RPC || 'http://127.0.0.1:8899';
const SHOTS = process.env.SHOTS || path.join(__dirname, 'shots');
for (const u of [BASE, API, RPC]) if (!['127.0.0.1', 'localhost'].includes(new URL(u).hostname)) throw new Error('local only: ' + u);

const problems = [];
const note = (m) => console.log(m);
const bad = (m) => { problems.push(m); console.log('PROBLEM: ' + m); };
const num = (s) => Number(String(s || '').replace(/[^\d-]/g, ''));
const shot = (page, name) => page.screenshot({ path: path.join(SHOTS, `chain-${name}.png`), fullPage: false });

const kp = web3.Keypair.generate();
const PKCS8 = Buffer.from('302e020100300506032b657004220420', 'hex');
const edKey = crypto.createPrivateKey({ key: Buffer.concat([PKCS8, Buffer.from(kp.secretKey.subarray(0, 32))]), format: 'der', type: 'pkcs8' });
const signed = { messages: 0, transactions: 0 };

async function toastText(page, re, timeout = 60000) {
  await page.waitForFunction((src) => new RegExp(src).test(document.querySelector('#toast')?.textContent || ''), re.source, { timeout });
  return page.textContent('#toast');
}

async function playToDeath(page, keys) {
  await page.waitForSelector('#cdn.on', { timeout: 20000 });
  await page.waitForFunction(() => !document.querySelector('#cdn').classList.contains('on'), null, { timeout: 8000 });
  const t0 = Date.now();
  while (!(await page.$('#panel.on'))) {
    await page.keyboard.press(keys[Math.floor(Math.random() * keys.length)]);
    await page.waitForTimeout(180 + Math.random() * 240);
    if (Date.now() - t0 > 180000) { bad('run did not end in 3 minutes'); break; }
  }
  await page.waitForTimeout(1500);
  return page.evaluate(() => ({
    title: document.querySelector('#rTitle')?.textContent,
    score: document.querySelector('#rScore')?.textContent,
    badges: [...document.querySelectorAll('#rBadges span')].map((s) => s.textContent),
    info: document.querySelector('#rInfo')?.textContent,
  }));
}

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const connection = new web3.Connection(RPC, 'confirmed');
  const cfg = await (await fetch(API + '/api/chain/config')).json();
  if (cfg.mode !== 'localnet' || !cfg.faucet) throw new Error('the API is not in localnet mode with a faucet: ' + JSON.stringify(cfg));
  const mint = new web3.PublicKey(cfg.mint);
  const programId = new web3.PublicKey(cfg.programId);
  // SOL for the wallet's own transaction fees, from the LOCAL validator.
  const drop = await connection.requestAirdrop(kp.publicKey, 2 * web3.LAMPORTS_PER_SOL);
  await connection.confirmTransaction({ signature: drop, ...(await connection.getLatestBlockhash()) }, 'confirmed');
  note('wallet ' + kp.publicKey.toBase58());

  const walletTokens = async () => {
    try {
      return Number(BigInt((await connection.getTokenAccountBalance(spl.getAssociatedTokenAddressSync(mint, kp.publicKey))).value.amount) / BigInt(cfg.unit));
    } catch { return 0; }
  };
  const onChain = async () => {
    const [pda] = web3.PublicKey.findProgramAddressSync([Buffer.from('player'), kp.publicKey.toBytes()], programId);
    const info = await connection.getAccountInfo(pda);
    if (!info) return null;
    const d = info.data; // 8 discriminator, 32 wallet, u64 available, u64 locked, i64 unlock_at, bool frozen, u8 bump
    return { available: d.readBigUInt64LE(40), locked: d.readBigUInt64LE(48), frozen: d[64] === 1 };
  };
  const mintSupply = async () => BigInt((await connection.getTokenSupply(mint)).value.amount);

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') bad('console: ' + m.text().slice(0, 300)); });
  page.on('pageerror', (e) => bad('pageerror: ' + String(e).slice(0, 300)));
  const requested = [];
  page.on('request', (r) => requested.push(r.url()));

  // ---- the fake wallet: window.solana, signing in this process
  await page.exposeFunction('__walletSignMessage', (bytes) => {
    signed.messages++;
    return [...crypto.sign(null, Buffer.from(bytes), edKey)];
  });
  await page.exposeFunction('__walletSignTx', (b64) => {
    signed.transactions++;
    const tx = web3.Transaction.from(Buffer.from(b64, 'base64'));
    tx.partialSign(kp);
    return tx.serialize({ requireAllSignatures: false }).toString('base64');
  });
  await page.addInitScript((address) => {
    const b64 = (u8) => btoa(String.fromCharCode(...u8));
    window.solana = {
      isPhantom: true,
      connect: async () => ({ publicKey: { toBase58: () => address } }),
      signMessage: async (msg) => ({ signature: new Uint8Array(await window.__walletSignMessage([...msg])) }),
      signTransaction: async (tx) => {
        const out = await window.__walletSignTx(b64(tx.serialize({ requireAllSignatures: false, verifySignatures: false })));
        return tx.constructor.from(Uint8Array.from(atob(out), (c) => c.charCodeAt(0)));
      },
    };
  }, kp.publicKey.toBase58());

  // ---- welcome → guest, then Ranked → the sign-in sheet leads with the wallet
  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  await page.waitForSelector('#welcome');
  await page.click('#welcome .btn.go');
  await page.waitForSelector('#welcome', { state: 'detached', timeout: 10000 });
  if (requested.some((u) => /\/_next\/static\/chunks\//.test(u) && false)) bad('unreachable');
  const before = new Set(requested);
  if ((await page.textContent('.wallet button')).trim() !== 'Wallet') bad('the header button is not "Wallet"');
  if (num(await page.textContent('#bal')) !== 0) bad('a guest does not start at 0 in chain mode');
  await page.click('#cards .gc >> nth=0 >> .btn.go');
  await page.waitForSelector('#signin');
  await shot(page, '1-signin');
  const firstButton = await page.textContent('#signin .btn >> nth=0');
  if (!/wallet/i.test(firstButton)) bad('sign-in does not lead with the wallet: ' + firstButton);
  await page.check('#signin .agree input');
  await page.click('#signin .btn.go');
  await page.waitForSelector('#signin', { state: 'detached', timeout: 15000 });
  await page.waitForTimeout(800);
  note(`signed in as ${await page.textContent('.mechip span:not(.avw)')}, balance ${await page.textContent('#bal')}`);
  if (signed.messages !== 1 || signed.transactions !== 0) bad('sign-in should sign exactly one message and no transaction');
  if (num(await page.textContent('#bal')) !== 0) bad('a new wallet account does not start at 0');

  // ---- wallet sheet: faucet
  await page.click('.wallet button');
  await page.waitForSelector('#walletS');
  await page.waitForSelector('#walletS .kv');
  await page.waitForTimeout(1500);
  await shot(page, '2-wallet');
  const sheetText = await page.textContent('#walletS');
  if (!/no value/i.test(sheetText)) bad('the wallet sheet does not say the token has no value');
  await page.click('#walletS .btn.alt');
  note('faucet: ' + (await toastText(page, /test tokens were sent/)));
  if ((await walletTokens()) !== cfg.faucetAmount) bad(`the wallet holds ${await walletTokens()} test tokens after the faucet`);

  // ---- deposit 1,000
  const solanaChunks = () => requested.filter((u) => /chunks\//.test(u) && !before.has(u)).length;
  await page.fill('#walletS input[aria-label="Deposit amount"]', '1000');
  await page.click('#walletS form:has(input[aria-label="Deposit amount"]) .sbtn');
  note('deposit: ' + (await toastText(page, /Deposited 1,000 tChips/)));
  await page.waitForFunction(() => document.querySelector('#bal')?.textContent?.replace(/\D/g, '') === '1000', null, { timeout: 15000 });
  if ((await walletTokens()) !== cfg.faucetAmount - 1000) bad('the wallet did not pay 1,000 test tokens');
  note(`chunks fetched only after the sheet opened: ${solanaChunks()}`);
  await shot(page, '3-deposited');
  await page.click('#walletS .x');

  // ---- ranked run (entry mirrored with enter_pool)
  await page.waitForTimeout(4500);
  await page.click('#classics .mc:has-text("Duck Dash") .sbtn:not(.lt)');
  await page.waitForURL(/\/play\/duck\?mode=ranked/);
  const ranked = await playToDeath(page, ['ArrowLeft', 'ArrowRight']);
  note('ranked result: ' + JSON.stringify(ranked));
  if (ranked.title !== 'Ranked run') bad('ranked result title: ' + ranked.title);
  if (ranked.badges.includes('Not recorded')) bad('the ranked run was not recorded: ' + ranked.info);
  await page.keyboard.press('Escape');
  await page.waitForURL(BASE + '/');
  await page.waitForFunction(() => document.querySelector('#bal')?.textContent?.replace(/\D/g, '') === '900', null, { timeout: 15000 });

  // ---- shop: a mystery box (10% burned on-chain)
  const supplyBefore = await mintSupply();
  await page.goto(BASE + '/shop', { waitUntil: 'networkidle' });
  await page.click('#shopG .item >> nth=0 >> .sbtn');
  await page.waitForFunction(() => document.querySelector('#bal')?.textContent?.replace(/\D/g, '') === '600', null, { timeout: 15000 });
  await shot(page, '4-shop');

  // ---- wait for the outbox, then withdraw 200
  await page.click('.wallet button');
  await page.waitForSelector('#walletS .kv');
  await page.waitForFunction(() => {
    const rows = [...document.querySelectorAll('#walletS .kv')].map((r) => r.textContent || '');
    return rows.some((t) => /Withdrawable now/.test(t) && t.replace(/\D/g, '') === '600');
  }, null, { timeout: 30000 });
  const burned = supplyBefore - (await mintSupply());
  note(`burned on-chain by the purchase: ${burned / BigInt(cfg.unit)} tChips`);
  if (burned !== 30n * BigInt(cfg.unit)) bad(`expected 30 tChips burned, got ${burned}`);
  const txBefore = signed.transactions;
  await page.fill('#walletS input[aria-label="Withdraw amount"]', '200');
  await page.click('#walletS form:has(input[aria-label="Withdraw amount"]) .sbtn');
  note('withdraw: ' + (await toastText(page, /Withdrew 200 tChips/)));
  if (signed.transactions !== txBefore + 1) bad('the withdrawal should need exactly one wallet signature');
  await page.waitForFunction(() => document.querySelector('#bal')?.textContent?.replace(/\D/g, '') === '400', null, { timeout: 15000 });
  await page.waitForTimeout(1500);
  await shot(page, '5-withdrawn');

  // ---- ledger vs chain
  const me = await page.evaluate(async () => (await (await fetch('/api/me')).json()));
  const st = await page.evaluate(async () => (await (await fetch('/api/chain/status')).json()));
  const p = await onChain();
  const chainChips = p ? Number((p.available + p.locked) / BigInt(cfg.unit)) : -1;
  const tokens = await walletTokens();
  note(`ledger balance ${me.user.balance}; on-chain available+locked ${chainChips}; wallet token account ${tokens}; status ${JSON.stringify(st)}`);
  if (me.user.balance !== 400) bad('ledger balance is not 400');
  if (chainChips !== me.user.balance) bad(`ledger ${me.user.balance} != chain ${chainChips}`);
  if (tokens !== cfg.faucetAmount - 1000 + 200) bad(`wallet token account holds ${tokens}`);
  if (st.pendingOps !== 0 || st.openWithdrawal) bad('something is still open: ' + JSON.stringify(st));

  // ---- rules page has the test-token block
  await page.goto(BASE + '/rules', { waitUntil: 'networkidle' });
  const rules = await page.textContent('#v-about');
  if (!/Devnet test token/.test(rules) || !/no value/.test(rules)) bad('the rules page has no test-token block');
  await shot(page, '6-rules');

  await browser.close();
  console.log(problems.length ? `\n${problems.length} problem(s)` : '\nchain e2e passed');
  process.exit(problems.length ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
