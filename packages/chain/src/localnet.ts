// The well-known keypair of LOCAL_TEST_PROGRAM_ID, for deploying to a local validator.
// It is public by construction. Never deploy with it anywhere but a local validator.
import { sha256 } from '@noble/hashes/sha256';
import { Keypair } from '@solana/web3.js';
import { LOCAL_TEST_PROGRAM_ID } from './constants';

export const LOCAL_TEST_PROGRAM_SEED = 'podium-localnet-test-program-id-v1';

export function localTestProgramKeypair(): Keypair {
  const kp = Keypair.fromSeed(sha256(new TextEncoder().encode(LOCAL_TEST_PROGRAM_SEED)));
  if (!kp.publicKey.equals(LOCAL_TEST_PROGRAM_ID)) throw new Error('local test program id mismatch');
  return kp;
}
