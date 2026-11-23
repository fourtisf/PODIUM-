// Country blocking of value features (chain mode only) and the test-token faucet.
import { CHAIN_ECONOMY, type ChainConfigResponse, type FaucetResponse } from '@podium/shared';
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import { CHAIN_READY, assertParity, chainApp, deposit, walletUser, type ChainTest } from './chain-helpers';
import { GAME, errCode, guest, playRun, signUp, visitor, type Res } from './helpers';

const from = (country: string) => ({ headers: { 'cf-ipcountry': country } });
const blocked = (r: Res): void => {
  expect(r.status).toBe(451);
  expect(errCode(r)).toBe('country_blocked');
};

describe.skipIf(!CHAIN_READY)('BLOCKED_COUNTRIES', () => {
  let t: ChainTest;
  beforeAll(async () => void (t = await chainApp({ settings: { blockedCountries: ['KP', 'IR'] }, faucet: true })));
  afterEach(() => assertParity(t));
  afterAll(() => t.close());

  test('value features answer 451 in a blocked country; practice, boards and browsing stay open', async () => {
    const a = await walletUser(t, { deposit: 1000, unlocked: true });
    const kp = from('kp'); // the header is not case-sensitive
    expect((await a.get<ChainConfigResponse>('/chain/config', kp)).body.blocked).toBe(true);
    expect((await a.get<ChainConfigResponse>('/chain/config', from('DE'))).body.blocked).toBe(false);
    expect((await a.get<ChainConfigResponse>('/chain/config')).body.blocked).toBe(false);
    for (const mode of ['ranked', 'cup', 'duel']) blocked(await a.post('/runs', { game: GAME, mode, duelId: 'x' }, kp));
    blocked(await a.post('/duels', { game: GAME, stake: 50 }, kp));
    blocked(await a.post('/shop/buy', { kind: 'box' }, kp));
    blocked(await a.post('/streak/claim', {}, kp));
    blocked(await a.post('/boxes/open', {}, kp));
    blocked(await a.post('/chain/withdraw/prepare', { amount: 10 }, kp));
    blocked(await a.post('/chain/withdraw/submit', { withdrawId: 'x', signedTx: 'AAAA' }, kp));
    blocked(await a.post('/chain/faucet', {}, kp));
    blocked(await a.post('/chain/deposit/confirm', { signature: '1'.repeat(88) }, kp));
    expect(await a.balance()).toBe(1000);
    expect(await t.ctx.db.chainOp.count({ where: { userId: a.id } })).toBe(0);
    // Open everywhere.
    expect((await a.post('/runs', { game: GAME, mode: 'practice' }, kp)).status).toBe(200);
    expect((await (await guest(t)).post('/runs', { game: GAME, mode: 'practice' }, kp)).status).toBe(200);
    for (const url of ['/games', '/leaderboard/' + GAME, '/cup', '/shop', '/activity', '/me', '/chain/status']) expect((await a.get(url, kp)).status, url).toBe(200);
    // The same account from an allowed country (or without the header) can play.
    expect((await a.post('/runs', { game: GAME, mode: 'ranked' }, from('DE'))).status).toBe(200);
    expect((await a.post('/runs', { game: GAME, mode: 'ranked' })).status).toBe(200);
    expect((await playRun(a, GAME, 'practice')).finish.status).toBe(200);
  });

  test('a deposit made from a blocked country is not credited, not even by the status reconcile', async () => {
    const a = await walletUser(t, { tokens: 300 });
    const d = await deposit(t, a, 100, from('IR'));
    blocked(d);
    expect((await a.get<{ credited: number }>('/chain/status', from('IR'))).body.credited).toBe(0);
    expect(await a.balance()).toBe(0);
    // From an allowed country the same deposit is found and credited once.
    expect((await a.get<{ credited: number }>('/chain/status')).body.credited).toBe(100);
    expect((await a.post('/chain/deposit/confirm', { signature: d.signature })).body).toMatchObject({ credited: 0, balance: 100 });
  });

  test('the faucet needs a signed-in account with a wallet', async () => {
    expect((await (await visitor(t)).post('/chain/faucet')).status).toBe(401);
    expect(errCode(await (await signUp(t)).post('/chain/faucet'))).toBe('wallet_required');
    expect(errCode(await (await guest(t)).post('/chain/faucet'))).toBe('guest_not_allowed');
  });
});

describe.skipIf(!CHAIN_READY)('ALLOWED_COUNTRIES and the faucet', () => {
  let t: ChainTest;
  beforeAll(async () => void (t = await chainApp({ settings: { allowedCountries: ['DE', 'ID'] }, faucet: true })));
  afterEach(() => assertParity(t));
  afterAll(() => t.close());

  test('with an allow list a request without a country is refused (fail closed)', async () => {
    const a = await walletUser(t);
    blocked(await a.post('/runs', { game: GAME, mode: 'ranked' }));
    blocked(await a.post('/runs', { game: GAME, mode: 'ranked' }, from('US')));
    blocked(await a.post('/chain/faucet'));
    expect((await a.get<ChainConfigResponse>('/chain/config')).body.blocked).toBe(true);
    expect(errCode(await a.post('/runs', { game: GAME, mode: 'ranked' }, from('ID')))).toBe('not_enough_chips');
    expect((await a.post('/runs', { game: GAME, mode: 'practice' })).status).toBe(200);
  });

  test('the faucet mints the test token to the wallet once per 24 hours', async () => {
    const de = from('DE');
    expect((await (await visitor(t)).get<ChainConfigResponse>('/chain/config', de)).body).toMatchObject({ faucet: true, faucetAmount: CHAIN_ECONOMY.faucetAmount, blocked: false });
    const a = await walletUser(t);
    const supply = await t.world.supply();
    const r = await a.post<FaucetResponse>('/chain/faucet', {}, de);
    expect(r.status).toBe(200);
    expect(r.body.amount).toBe(CHAIN_ECONOMY.faucetAmount);
    expect(await t.world.tokenBalance(a.kp.publicKey)).toBe(t.ctx.chain!.toBase(CHAIN_ECONOMY.faucetAmount));
    expect((await t.world.supply()) - supply).toBe(t.ctx.chain!.toBase(CHAIN_ECONOMY.faucetAmount));
    // Test tokens in the wallet are not a game balance until they are deposited.
    expect(await a.balance()).toBe(0);
    const again = await a.post('/chain/faucet', {}, de);
    expect(again.status).toBe(429);
    expect(errCode(again)).toBe('rate_limited');
    expect(await t.world.tokenBalance(a.kp.publicKey)).toBe(t.ctx.chain!.toBase(CHAIN_ECONOMY.faucetAmount));
    // Faucet → deposit → play.
    const d = await deposit(t, a, 500, de);
    expect(d.body).toMatchObject({ credited: 500, balance: 500 });
    expect((await a.post('/runs', { game: GAME, mode: 'ranked' }, de)).status).toBe(200);
  });
});
