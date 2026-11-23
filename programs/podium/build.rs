// The program id is a build-time parameter so that no program keypair has to live in the repo.
//   PODIUM_PROGRAM_ID=<base58 pubkey> cargo build-sbf
// Without the variable the well-known LOCAL TEST id is compiled in. Its keypair is derived from a
// public seed (see packages/chain/src/constants.ts), so it must never be used on a public cluster.
use std::{env, fs, path::Path};

const LOCAL_TEST_PROGRAM_ID: &str = "Eo3NPwtAjr8iDSUEctJuLLhoHBho4Zm1iZKaVoWALyTz";

fn main() {
    println!("cargo:rerun-if-env-changed=PODIUM_PROGRAM_ID");
    println!("cargo:rerun-if-changed=build.rs");
    let id = env::var("PODIUM_PROGRAM_ID").ok().filter(|s| !s.trim().is_empty()).unwrap_or_else(|| LOCAL_TEST_PROGRAM_ID.to_string());
    let id = id.trim();
    let ok = (32..=44).contains(&id.len())
        && id.chars().all(|c| c.is_ascii_alphanumeric() && !matches!(c, '0' | 'O' | 'I' | 'l'));
    assert!(ok, "PODIUM_PROGRAM_ID is not a base58 public key: {id:?}");
    let out = Path::new(&env::var("OUT_DIR").unwrap()).join("program_id.rs");
    fs::write(out, format!("anchor_lang::declare_id!(\"{id}\");\n")).unwrap();
}
