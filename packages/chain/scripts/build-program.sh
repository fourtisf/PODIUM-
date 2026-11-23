#!/usr/bin/env bash
# Builds programs/podium into programs/podium/target/deploy/podium.so with `cargo build-sbf`.
#
#   pnpm --filter @podium/chain build:program                      # local test id (tests, localnet)
#   PODIUM_PROGRAM_ID=<pubkey> pnpm --filter @podium/chain build:program   # your own id (devnet)
#
# Needs the Agave CLI (cargo-build-sbf) on PATH; see packages/chain/README.md.
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
program_dir="$(cd "$here/../../../programs/podium" && pwd)"

if ! command -v cargo-build-sbf >/dev/null 2>&1; then
  echo "cargo-build-sbf not found. Install the Agave CLI (see packages/chain/README.md) and add it to PATH." >&2
  exit 1
fi

LOCAL_TEST_PROGRAM_ID="Eo3NPwtAjr8iDSUEctJuLLhoHBho4Zm1iZKaVoWALyTz"
id="${PODIUM_PROGRAM_ID:-$LOCAL_TEST_PROGRAM_ID}"
export PODIUM_PROGRAM_ID="$id"

cd "$program_dir"
cargo build-sbf --manifest-path "$program_dir/Cargo.toml" --sbf-out-dir "$program_dir/target/deploy" "$@"
# cargo-build-sbf drops a random keypair next to the .so; it is not this program's id. Remove it
# so nobody deploys with it by mistake.
rm -f "$program_dir/target/deploy/podium-keypair.json"
printf '%s\n' "$id" > "$program_dir/target/deploy/podium.program-id"
echo "built $program_dir/target/deploy/podium.so  (program id $id)"
if [ "$id" = "$LOCAL_TEST_PROGRAM_ID" ]; then
  echo "NOTE: this is the LOCAL TEST id (public keypair). Do not deploy this build to devnet."
fi
