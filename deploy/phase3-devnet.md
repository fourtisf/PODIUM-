# Phase 3 on devnet

Solana **devnet only**, with a **test token that has no value**. Mainnet stays locked until the
owner has the written legal opinion and a contract audit: `CHAIN_MODE` accepts `off`, `localnet`
and `devnet`, and the API refuses to start on a mainnet URL or a mainnet node.

With `CHAIN_MODE=off` (the default) nothing here applies and the site behaves as in Phase 1/2.

## What changes when it is on

- New accounts start at 0 tChips. There is no refill. Practice is free.
- Ranked, the Cup, duels, the shop, reward claims, deposits and withdrawals need a linked Solana wallet.
- The Postgres ledger stays the authority for gameplay; every movement is mirrored on-chain by one
  outbox worker inside the API process (keep `instances: 1` in `deploy/ecosystem.config.js`).
- Start on a **fresh database**. Balances from before chain mode (the free 2,000 tChips) have
  nothing behind them on-chain, and the API refuses to start in chain mode while such balances exist.

## Order

Run on a machine with the Agave CLI (`solana`, `cargo-build-sbf`) and the owner's keypairs. Keep
every keypair file outside the repository.

1. **Keys.** A program keypair, an admin keypair (pays, becomes admin and mint authority) and an
   operator keypair (the game server's key). Fund the admin with about 4 devnet SOL and the
   operator with about 1 devnet SOL (it pays transaction fees and the rent of player accounts).

   ```
   solana-keygen new -o ~/podium/program-keypair.json
   solana-keygen new -o ~/podium/admin.json
   solana-keygen new -o ~/podium/operator.json
   ```

2. **Build the program with the owner's program id.**

   ```
   PODIUM_PROGRAM_ID=$(solana-keygen pubkey ~/podium/program-keypair.json) \
     pnpm --filter @podium/chain build:program
   ```

3. **Deploy to devnet.**

   ```
   PODIUM_PROGRAM_KEYPAIR=~/podium/program-keypair.json \
   PODIUM_DEPLOYER_KEYPAIR=~/podium/admin.json \
     bash packages/chain/scripts/deploy-devnet.sh
   ```

4. **Create the test mint, initialize the program, fund the rewards pot.**

   ```
   PODIUM_PROGRAM_ID=$(solana-keygen pubkey ~/podium/program-keypair.json) \
   PODIUM_ADMIN_KEYPAIR=~/podium/admin.json \
   PODIUM_OPERATOR_PUBKEY=$(solana-keygen pubkey ~/podium/operator.json) \
     pnpm --filter @podium/chain setup:devnet
   ```

   Optional: `PODIUM_VEST_SECONDS` (reward vesting delay, default 7 days) and
   `PODIUM_REWARDS_CHIPS` (default 1,000,000). Rewards can never exceed what is in the pot.

5. **Put the printed lines in `.env`** on the VPS, and add the rest (see `.env.example`):

   ```
   PODIUM_PROGRAM_ID=<printed>
   PODIUM_MINT=<printed>
   NEXT_PUBLIC_PODIUM_PROGRAM_ID=<printed>
   NEXT_PUBLIC_PODIUM_MINT=<the same mint>
   CHAIN_OPERATOR_KEYPAIR=/home/podium/keys/operator.json     # chmod 600, outside the repo
   # Optional test-token faucet: the admin key is the test mint's authority.
   CHAIN_FAUCET_KEYPAIR=/home/podium/keys/admin.json
   BLOCKED_COUNTRIES=...          # or ALLOWED_COUNTRIES=...
   GEO_HEADER=cf-ipcountry
   ```

   The API needs only the program id, the mint and the operator key; the other lines the script
   prints (`PODIUM_CONFIG`, `PODIUM_VAULT`, ...) are for reference.

6. **Set `CHAIN_MODE=devnet` and `NEXT_PUBLIC_CHAIN_MODE=devnet`.**

7. **Rebuild the web app.** `NEXT_PUBLIC_*` values are fixed at build time, so a change needs a
   new build: run `deploy/phase1.sh` (it applies the new database migration, builds and reloads).

8. **Restart** (`deploy/phase1.sh` does it) and check:

   ```
   curl -s https://<DOMAIN>/api/chain/config      # mode "devnet", your program id and mint
   pm2 logs podium-api --lines 50                 # "chain mode is on: TEST token, no value"
   ```

   If a setting is wrong (operator key is not the program's operator, mint mismatch, RPC not on
   devnet) the API stops at boot and the log says which one.

## Country blocking

The API reads the visitor's country from the `GEO_HEADER` request header and answers HTTP 451
(`country_blocked`) on value features. **Something in front of the API must set that header, and
must overwrite a value sent by the visitor**, or the block can be bypassed:

- Behind Cloudflare: it sets `CF-IPCountry`. Allow only Cloudflare's addresses to reach Nginx.
- Nginx alone: use the GeoIP2 module and set the header in both proxied locations (`/api/` and `/`,
  because the web server forwards it to the API for the first paint):

  ```
  proxy_set_header CF-IPCountry $geoip2_data_country_code;
  ```

With `ALLOWED_COUNTRIES` a request without a country is refused; with `BLOCKED_COUNTRIES` it is let
through. Until the header is in place, prefer `ALLOWED_COUNTRIES`.

## Operating notes

- The outbox (`ChainOp` table) should be empty or short. An operation the program rejects is
  marked `failed`, the player's `chainHold` is set (no withdrawals) and the log has a line starting
  `CHAIN OP REJECTED BY THE PROGRAM`. Review it before clearing `chainHold` by hand.
- If the admin pauses the program, the RPC is down, or the operator has run out of SOL, the queue waits
  and retries; nothing is skipped. Keep an eye on the operator's SOL balance (`solana balance <operator>`).
- The rewards pot is finite. When it runs low, rewards are scaled down and then pay 0. Refill it
  with `fund_rewards` (admin) or `treasury_to_rewards`.
- The operator key must never be used by a second process: sequence numbers come from one worker.
- Back to plain test chips: set `CHAIN_MODE=off` and `NEXT_PUBLIC_CHAIN_MODE=off`, rebuild, and
  start from a fresh database again (on-chain balances do not exist in the off mode).

## Local validator instead of devnet

```
pnpm --filter @podium/chain build:program          # without PODIUM_PROGRAM_ID: the public local test id
solana-test-validator --reset --ledger /tmp/podium-test-ledger \
  --bpf-program Eo3NPwtAjr8iDSUEctJuLLhoHBho4Zm1iZKaVoWALyTz programs/podium/target/deploy/podium.so
PODIUM_CLUSTER=localnet PODIUM_PROGRAM_ID=Eo3NPwtAjr8iDSUEctJuLLhoHBho4Zm1iZKaVoWALyTz \
  PODIUM_ADMIN_KEYPAIR=... PODIUM_OPERATOR_PUBKEY=... pnpm --filter @podium/chain setup:devnet -- --yes
# (fund the admin and the operator first: solana airdrop 10 <pubkey> --url localhost)
```

Then `CHAIN_MODE=localnet` and `NEXT_PUBLIC_CHAIN_MODE=localnet`. The local test program id is
public and is refused on devnet.
