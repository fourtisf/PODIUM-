// Chain mode can only be off, localnet or devnet. Everything else stops the server at boot.
import { MAINNET_GENESIS_HASH, MAINNET_LOCKED_MESSAGE } from '@podium/chain';
import { TestChain } from '@podium/chain/testing';
import type { ChainConfigResponse } from '@podium/shared';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { buildApp } from '../src/app';
import type { ChainRpc } from '../src/chain/rpc';
import { loadConfig, parseChainMode, type ChainSettings } from '../src/config';
import { CHAIN_READY, chainApp, chainSettings, keyJson, walletUser, type ChainTest } from './chain-helpers';
import { errCode, freshApp, signUp, visitor, type TestApp } from './helpers';

describe('CHAIN_MODE off (the default)', () => {
  let t: TestApp;
  beforeAll(async () => void (t = await freshApp()));
  afterAll(() => t.close());

  test('nothing of the chain is reachable and /me says so', async () => {
    expect(t.ctx.cfg.chain.mode).toBe('off');
    expect(t.ctx.chain).toBeNull();
    const v = await visitor(t);
    const cfg = await v.get<ChainConfigResponse>('/chain/config');
    expect(cfg.status).toBe(200);
    expect(cfg.body).toMatchObject({ mode: 'off', cluster: null, programId: null, mint: null, faucet: false, blocked: false });
    const c = await signUp(t);
    expect((await c.me()).chain).toBeNull();
    expect((await c.get('/chain/status')).status).toBe(404);
    for (const [url, body] of [['/chain/faucet', {}], ['/chain/deposit/confirm', { signature: 'x'.repeat(88) }], ['/chain/withdraw/prepare', { amount: 1 }], ['/chain/withdraw/submit', { withdrawId: 'a', signedTx: 'AA==' }]] as const) {
      expect((await c.post(url, body)).status, url).toBe(404);
    }
  });
});

describe('boot refuses mainnet and anything unknown', () => {
  test('CHAIN_MODE accepts off, localnet and devnet only', () => {
    expect(parseChainMode(undefined)).toBe('off');
    expect(parseChainMode('')).toBe('off');
    expect(parseChainMode(' Devnet ')).toBe('devnet');
    expect(parseChainMode('localnet')).toBe('localnet');
    for (const bad of ['mainnet', 'mainnet-beta', 'MAINNET-BETA', 'testnet', 'on', 'true', '1', 'https://api.mainnet-beta.solana.com']) {
      expect(() => parseChainMode(bad), bad).toThrow(MAINNET_LOCKED_MESSAGE);
    }
  });

  test('the environment variable and a config override are both held to it', async () => {
    const before = process.env.CHAIN_MODE;
    process.env.CHAIN_MODE = 'mainnet-beta';
    try {
      expect(() => loadConfig()).toThrow(MAINNET_LOCKED_MESSAGE);
      await expect(buildApp({ logger: false })).rejects.toThrow(MAINNET_LOCKED_MESSAGE);
    } finally {
      if (before === undefined) delete process.env.CHAIN_MODE;
      else process.env.CHAIN_MODE = before;
    }
    await expect(buildApp({ logger: false, config: { chain: { ...loadConfig().chain, mode: 'mainnet-beta' as ChainSettings['mode'] } } })).rejects.toThrow(MAINNET_LOCKED_MESSAGE);
  });

  test.skipIf(!CHAIN_READY)('a mainnet RPC URL, a mainnet genesis hash and a non-devnet node in devnet mode all stop the server', async () => {
    await (await freshApp()).close();
    const world = await TestChain.create();
    const boot = (settings: Partial<ChainSettings>, rpc?: ChainRpc) => buildApp({ logger: false, chainRpc: rpc, config: { chain: chainSettings(world, settings) } });
    // By URL: refused before any connection is made.
    await expect(boot({ mode: 'devnet', rpcUrl: 'https://api.mainnet-beta.solana.com' })).rejects.toThrow(MAINNET_LOCKED_MESSAGE);
    await expect(boot({ mode: 'localnet', rpcUrl: 'https://solana-mainnet.example.com/key' })).rejects.toThrow(MAINNET_LOCKED_MESSAGE);
    // localnet means a validator on this machine.
    await expect(boot({ mode: 'localnet', rpcUrl: 'https://rpc.example.com' })).rejects.toThrow(MAINNET_LOCKED_MESSAGE);
    // By genesis hash, whatever the URL says.
    const mainnetBehind = Object.assign(Object.create(world.rpc) as ChainRpc, { getGenesisHash: async () => MAINNET_GENESIS_HASH });
    await expect(boot({}, mainnetBehind)).rejects.toThrow(MAINNET_LOCKED_MESSAGE);
    // devnet mode accepts the public devnet only.
    await expect(boot({ mode: 'devnet' }, world.rpc)).rejects.toThrow(MAINNET_LOCKED_MESSAGE);
    // A half-configured chain does not start either.
    await expect(boot({ operatorKeypair: '' }, world.rpc)).rejects.toThrow('CHAIN_OPERATOR_KEYPAIR');
    await expect(boot({ operatorKeypair: keyJson(world.admin) }, world.rpc)).rejects.toThrow("not the program's operator");
    await expect(boot({ mint: world.admin.publicKey.toBase58() }, world.rpc)).rejects.toThrow('PODIUM_MINT');
    await expect(boot({ programId: '' }, world.rpc)).rejects.toThrow('PODIUM_PROGRAM_ID');
    await world.close();
  });

  test.skipIf(!CHAIN_READY)('chain mode does not start on a database that already holds unbacked tChips', async () => {
    const off = await freshApp();
    await signUp(off); // 2,000 free tChips from the off mode
    await off.close();
    const world = await TestChain.create();
    await expect(buildApp({ logger: false, chainRpc: world.rpc, config: { chain: chainSettings(world) } })).rejects.toThrow('not backed on-chain');
    await world.close();
  });
});

describe.skipIf(!CHAIN_READY)('chain mode on', () => {
  let t: ChainTest;
  beforeAll(async () => void (t = await chainApp()));
  afterAll(() => t.close());

  test('GET /chain/config is public and describes the test token', async () => {
    const r = await (await visitor(t)).get<ChainConfigResponse>('/chain/config');
    expect(r.status).toBe(200);
    expect(r.body).toEqual({
      mode: 'localnet', cluster: 'localnet', programId: t.world.programId.toBase58(), mint: t.world.mint.toBase58(), unit: 1_000_000, decimals: 6, tokenLabel: 'tChips',
      faucet: false, faucetAmount: 0, vestSeconds: 7 * 86_400, feeBps: 600, burnBps: 1000, blocked: false,
    });
  });

  test('the faucet is off unless a faucet key is configured', async () => {
    const c = await walletUser(t);
    const r = await c.post('/chain/faucet');
    expect(r.status).toBe(404);
    expect(errCode(r)).toBe('not_found');
    expect(await t.world.tokenBalance(c.kp.publicKey)).toBe(0n);
  });
});
