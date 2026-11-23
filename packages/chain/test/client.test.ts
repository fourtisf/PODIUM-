// Pure client checks: these run on any machine, with or without the built program.
import { Keypair, PublicKey } from '@solana/web3.js';
import { describe, expect, it } from 'vitest';
import {
  CLUSTERS,
  LOCAL_TEST_PROGRAM_ID,
  MAINNET_GENESIS_HASH,
  Operator,
  PODIUM_ERRORS,
  assertCluster,
  assertNotMainnetGenesis,
  assertRpcUrl,
  configPda,
  duelIdBytes,
  duelPda,
  errorCode,
  errorName,
  gameBytes,
  gameFromBytes,
  localTestProgramKeypair,
  matured,
  parsePodiumLogs,
  playerPda,
  poolPda,
  splitToBps,
  toBase,
  toChips,
} from '../src/index';

describe('assertCluster', () => {
  it('allows localnet and devnet', () => {
    expect(assertCluster('localnet')).toBe(CLUSTERS.localnet);
    expect(assertCluster('devnet').rpcUrl).toBe('https://api.devnet.solana.com');
  });

  it('refuses mainnet in every spelling', () => {
    for (const name of ['mainnet-beta', 'mainnet', 'MAINNET-BETA', ' mainnet-beta ', 'https://api.mainnet-beta.solana.com', 'https://mainnet.helius-rpc.com/?api-key=x']) {
      expect(() => assertCluster(name), name).toThrow(/mainnet is locked until the owner has a written legal opinion and a contract audit/);
    }
  });

  it('refuses anything it does not know', () => {
    expect(() => assertCluster('testnet')).toThrow(/unknown cluster/);
    expect(() => assertCluster('')).toThrow();
  });

  it('assertRpcUrl refuses mainnet URLs and non-URLs', () => {
    expect(assertRpcUrl('http://127.0.0.1:8899')).toBe('http://127.0.0.1:8899');
    expect(() => assertRpcUrl('https://api.mainnet-beta.solana.com')).toThrow(/mainnet is locked/);
    expect(() => assertRpcUrl('solana-mainnet.g.alchemy.com')).toThrow(/mainnet is locked/);
    expect(() => assertRpcUrl('not a url')).toThrow(/not an RPC URL/);
  });

  it('refuses a mainnet node behind a neutral URL by its genesis hash', async () => {
    await expect(assertNotMainnetGenesis({ getGenesisHash: async () => MAINNET_GENESIS_HASH })).rejects.toThrow(/mainnet is locked/);
    await expect(assertNotMainnetGenesis({ getGenesisHash: async () => 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG' })).resolves.toBeUndefined();
  });

  it('the Operator refuses a mainnet connection', async () => {
    const kp = Keypair.generate();
    const base = {
      getAccountInfo: async () => null,
      getLatestBlockhash: async () => ({ blockhash: '', lastValidBlockHeight: 0 }),
      sendRawTransaction: async () => '',
      confirmTransaction: async () => ({ value: { err: null } }),
    };
    expect(() => new Operator({ ...base, rpcEndpoint: 'https://api.mainnet-beta.solana.com' }, kp)).toThrow(/mainnet is locked/);
    const op = new Operator({ ...base, rpcEndpoint: 'https://rpc.example.com', getGenesisHash: async () => MAINNET_GENESIS_HASH }, kp);
    await expect(op.opSeq()).rejects.toThrow(/mainnet is locked/);
    await expect(op.creditReward(1, kp.publicKey, 1)).rejects.toThrow(/mainnet is locked/);
  });
});

describe('units', () => {
  it('converts chips to base units and back', () => {
    expect(toBase(100, 1_000_000)).toBe(100_000_000n);
    expect(toBase(0)).toBe(0n);
    expect(toChips(188_000_000n, 1_000_000n)).toBe(188);
    expect(toChips(1_999_999n)).toBe(1);
  });
  it('rejects fractions and negatives', () => {
    expect(() => toBase(1.5)).toThrow(RangeError);
    expect(() => toBase(-1)).toThrow(RangeError);
    expect(() => toChips(-1n)).toThrow(RangeError);
  });
});

describe('addresses', () => {
  const pid = LOCAL_TEST_PROGRAM_ID;
  it('the local test program keypair matches the id compiled into local builds', () => {
    expect(localTestProgramKeypair().publicKey.equals(LOCAL_TEST_PROGRAM_ID)).toBe(true);
  });
  it('derives stable, distinct PDAs', () => {
    const a = Keypair.generate().publicKey;
    expect(configPda(pid).equals(configPda(pid))).toBe(true);
    expect(playerPda(a, pid).equals(playerPda(Keypair.generate().publicKey, pid))).toBe(false);
    expect(poolPda(0, 'blaster', 1000, pid).equals(poolPda(1, 'blaster', 1000, pid))).toBe(false);
    expect(poolPda(0, 'blaster', 1000, pid).equals(poolPda(0, 'hopper', 1000, pid))).toBe(false);
    expect(poolPda(0, 'blaster', 1000, pid).equals(poolPda(0, 'blaster', 1001n, pid))).toBe(false);
    expect(PublicKey.isOnCurve(configPda(pid).toBytes())).toBe(false);
  });
  it('pads game keys and parses duel ids', () => {
    expect(gameBytes('cube')).toHaveLength(16);
    expect(gameFromBytes(gameBytes('traffic'))).toBe('traffic');
    expect(() => gameBytes('a-game-key-that-is-too-long')).toThrow(RangeError);
    const uuid = '3f2b8c1e-9d4a-4b7e-8f01-23456789abcd';
    expect(duelIdBytes(uuid)).toHaveLength(16);
    expect(duelPda(uuid, pid).equals(duelPda(uuid.replace(/-/g, ''), pid))).toBe(true);
    expect(() => duelIdBytes('nope')).toThrow(RangeError);
  });
  it('splitToBps', () => {
    expect(splitToBps([0.5, 0.3, 0.2])).toEqual([5000, 3000, 2000, 0, 0]);
    expect(splitToBps([0.4, 0.25, 0.15, 0.12, 0.08])).toEqual([4000, 2500, 1500, 1200, 800]);
  });
});

describe('helpers', () => {
  it('matured() adds locked only once unlock_at has passed', () => {
    const p = { available: 10n, locked: 5n, unlockAt: 1000n };
    expect(matured(p, 999)).toBe(10n);
    expect(matured(p, 1000)).toBe(15n);
    expect(matured({ ...p, locked: 0n }, 5000n)).toBe(10n);
  });
  it('error codes follow the program order', () => {
    expect(errorCode('Unauthorized')).toBe(6000);
    expect(errorCode('BadSequence')).toBe(6003);
    expect(errorName(6009)).toBe('PayoutTooHigh');
    expect(new Set(PODIUM_ERRORS).size).toBe(PODIUM_ERRORS.length);
  });
  it('parses the program log lines', () => {
    const logs = ['Program X invoke [1]', 'Program log: Instruction: Deposit', 'Program log: podium:deposit wallet=abc amount=5 available=5 locked=0', 'Program X success'];
    expect(parsePodiumLogs(logs)).toEqual([{ event: 'deposit', fields: { wallet: 'abc', amount: '5', available: '5', locked: '0' } }]);
  });
});
