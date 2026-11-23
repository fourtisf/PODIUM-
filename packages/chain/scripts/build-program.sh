#!/usr/bin/env bash
# Builds programs/podium into programs/podium/target/deploy/podium.so with `cargo build-sbf`.
#
#   pnpm --filter @podium/chain build:program                              # local test id (tests, localnet)
#   PODIUM_PROGRAM_ID=<pubkey> pnpm --filter @podium/chain build:program   # your own id (devnet)
#
# Toolchain (versions this was built and tested with):
#   Rust (host, any recent stable; 1.97.0 used) with rustup on PATH
#   Agave CLI 2.1.21, which brings cargo-build-sbf and platform-tools v1.43 (rustc 1.79):
#     mkdir -p ~/solana && cd ~/solana
#     curl -sSfL -o solana.tar.bz2 https://release.anza.xyz/v2.1.21/solana-release-x86_64-unknown-linux-gnu.tar.bz2
#     tar xjf solana.tar.bz2 && export PATH="$PWD/solana-release/bin:$PATH"
#   The first build downloads platform-tools from GitHub releases into ~/.cache/solana.
#   Anchor 0.31.1 is used as a library only (anchor-lang / anchor-spl); the Anchor CLI is not needed.
#
# programs/podium/Cargo.lock is committed and the build is --locked: the pinned versions are the
# ones that compile with rustc 1.79. If you must regenerate it, use
#   CARGO_RESOLVER_INCOMPATIBLE_RUST_VERSIONS=fallback cargo generate-lockfile
#   cargo update -p blake3 --precise 1.5.5      # newer blake3 needs rustc 1.85
# and pin every anchor-* crate to 0.31.1.
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
program_dir="$(cd "$here/../../../programs/podium" && pwd)"

if ! command -v cargo-build-sbf >/dev/null 2>&1; then
  echo "cargo-build-sbf not found. Install the Agave CLI (see the header of this script) and add it to PATH." >&2
  exit 1
fi

LOCAL_TEST_PROGRAM_ID="Eo3NPwtAjr8iDSUEctJuLLhoHBho4Zm1iZKaVoWALyTz"
id="${PODIUM_PROGRAM_ID:-$LOCAL_TEST_PROGRAM_ID}"
export PODIUM_PROGRAM_ID="$id"

cd "$program_dir"
cargo build-sbf --manifest-path "$program_dir/Cargo.toml" --sbf-out-dir "$program_dir/target/deploy" "$@" -- --locked
# cargo-build-sbf drops a random keypair next to the .so; it is not this program's id. Remove it
# so nobody deploys with it by mistake.
rm -f "$program_dir/target/deploy/podium-keypair.json"
printf '%s\n' "$id" > "$program_dir/target/deploy/podium.program-id"
echo "built $program_dir/target/deploy/podium.so  (program id $id)"
if [ "$id" = "$LOCAL_TEST_PROGRAM_ID" ]; then
  echo "NOTE: this is the LOCAL TEST id (public keypair). Do not deploy this build to devnet."
fi
