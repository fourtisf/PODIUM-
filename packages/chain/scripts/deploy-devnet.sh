#!/usr/bin/env bash
# Deploys the built program to DEVNET. For the owner to run; it asks before doing anything.
# Mainnet is locked until the legal opinion and the contract audit: this script only ever talks
# to https://api.devnet.solana.com.
#
#   solana-keygen new -o ~/podium/program-keypair.json      # once; keep it out of the repo
#   PODIUM_PROGRAM_ID=$(solana-keygen pubkey ~/podium/program-keypair.json) \
#     pnpm --filter @podium/chain build:program
#   PODIUM_PROGRAM_KEYPAIR=~/podium/program-keypair.json \
#   PODIUM_DEPLOYER_KEYPAIR=~/podium/admin.json \
#     bash packages/chain/scripts/deploy-devnet.sh
#
# The deployer pays (about 3.5 devnet SOL of rent for a ~490 KB program) and becomes the upgrade
# authority. Get devnet SOL yourself beforehand; this script does not request airdrops.
set -euo pipefail
readonly DEVNET_URL="https://api.devnet.solana.com"
readonly LOCAL_TEST_PROGRAM_ID="Eo3NPwtAjr8iDSUEctJuLLhoHBho4Zm1iZKaVoWALyTz"

if [ "$#" -gt 0 ]; then
  echo "This script takes no arguments (the cluster is fixed to devnet)." >&2
  exit 1
fi
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
deploy_dir="$(cd "$here/../../../programs/podium" && pwd)/target/deploy"
so="$deploy_dir/podium.so"

: "${PODIUM_PROGRAM_KEYPAIR:?set PODIUM_PROGRAM_KEYPAIR to the program-id keypair file}"
: "${PODIUM_DEPLOYER_KEYPAIR:?set PODIUM_DEPLOYER_KEYPAIR to the paying keypair file}"
command -v solana >/dev/null || { echo "solana CLI not found on PATH" >&2; exit 1; }
[ -f "$so" ] || { echo "$so is missing: run pnpm --filter @podium/chain build:program first" >&2; exit 1; }

program_id="$(solana-keygen pubkey "$PODIUM_PROGRAM_KEYPAIR")"
built_id="$(cat "$deploy_dir/podium.program-id" 2>/dev/null || true)"
if [ "$program_id" = "$LOCAL_TEST_PROGRAM_ID" ] || [ "$built_id" = "$LOCAL_TEST_PROGRAM_ID" ]; then
  echo "Refusing: this is the public LOCAL TEST program id. Rebuild with PODIUM_PROGRAM_ID set to your own keypair's pubkey." >&2
  exit 1
fi
if [ "$program_id" != "$built_id" ]; then
  echo "Refusing: the .so was built for program id '$built_id' but the keypair is '$program_id'." >&2
  echo "Rebuild: PODIUM_PROGRAM_ID=$program_id pnpm --filter @podium/chain build:program" >&2
  exit 1
fi

genesis="$(solana genesis-hash --url "$DEVNET_URL")"
if [ "$genesis" = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d" ]; then
  echo "Refusing: that RPC is mainnet-beta. Mainnet is locked." >&2
  exit 1
fi

echo "About to deploy to DEVNET ($DEVNET_URL)"
echo "  program id : $program_id"
echo "  binary     : $so ($(wc -c < "$so") bytes)"
echo "  deployer   : $(solana-keygen pubkey "$PODIUM_DEPLOYER_KEYPAIR") (pays, becomes upgrade authority)"
echo "  balance    : $(solana balance --url "$DEVNET_URL" --keypair "$PODIUM_DEPLOYER_KEYPAIR")"
read -r -p 'Type "deploy to devnet" to continue: ' answer
[ "$answer" = "deploy to devnet" ] || { echo "Cancelled."; exit 1; }

solana program deploy "$so" \
  --url "$DEVNET_URL" \
  --keypair "$PODIUM_DEPLOYER_KEYPAIR" \
  --program-id "$PODIUM_PROGRAM_KEYPAIR"

echo "Deployed. Next: run setup-devnet.ts straight away with PODIUM_PROGRAM_ID=$program_id"
echo "(initialize is first come, first served: do not leave the program uninitialized)."
