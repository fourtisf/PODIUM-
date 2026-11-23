// Test-token faucet. It mints the valueless TEST mint to a player's own wallet on devnet or a
// local validator, and only when CHAIN_FAUCET_KEYPAIR (the test mint's authority) is configured.
// ChainService only exists for localnet / devnet, so this cannot run anywhere else.
import { CHAIN_ECONOMY } from '@podium/shared';
import { createAssociatedTokenAccountIdempotentInstruction, createMintToInstruction, getAssociatedTokenAddressSync } from '@solana/spl-token';
import { PublicKey } from '@solana/web3.js';
import type { Ctx } from '../ctx';
import { AppError, notFound } from '../errors';

export async function faucet(ctx: Ctx, user: { id: string; wallet: string }): Promise<{ amount: number; signature: string }> {
  const chain = ctx.chain;
  if (!chain || !chain.faucetKeypair || (chain.mode !== 'devnet' && chain.mode !== 'localnet')) throw notFound('Not found.');
  const key = 'faucet:' + user.id;
  const seconds = CHAIN_ECONOMY.faucetEveryHours * 3600;
  if ((await ctx.redis.set(key, '1', 'EX', seconds, 'NX')) !== 'OK') {
    const retryAfter = Math.max(1, await ctx.redis.ttl(key));
    throw new AppError(429, 'rate_limited', `Test tokens can be requested once every ${CHAIN_ECONOMY.faucetEveryHours} hours.`, { retryAfter });
  }
  try {
    const owner = new PublicKey(user.wallet);
    const ata = getAssociatedTokenAddressSync(chain.mint, owner, true);
    const payer = chain.faucetKeypair;
    const signature = await chain.sendAs(payer, [
      createAssociatedTokenAccountIdempotentInstruction(payer.publicKey, ata, owner, chain.mint),
      createMintToInstruction(chain.mint, ata, payer.publicKey, chain.toBase(chain.faucetAmount)),
    ]);
    return { amount: chain.faucetAmount, signature };
  } catch (e) {
    await ctx.redis.del(key);
    ctx.log.warn(e, 'faucet failed');
    throw new AppError(503, 'unavailable', 'The test-token faucet is not available right now.');
  }
}
