//! A test-only feed that misbehaves on demand. It has the same `get` signature
//! as the real feed, so the market's imported client can call it. The mode is
//! changeable without auth because it exists only in tests.

use crate::feed::Entry;
use soroban_sdk::{contract, contractimpl, contracttype, Address, Bytes, BytesN, Env};

/// Returns an entry with `version` 2.
pub const MODE_VERSION_2: u32 = 0;
/// Returns an entry with `status` 3.
pub const MODE_STATUS_3: u32 = 1;
/// Traps inside `get`.
pub const MODE_PANIC: u32 = 2;
/// Returns a valid OK entry stamped with the ledger time.
pub const MODE_CLEAN: u32 = 3;
/// Returns `None`.
pub const MODE_NONE: u32 = 4;

/// Burns the whole budget inside `get`. The host cannot recover from this
/// kind of failure, so no `try_` call returns.
pub const MODE_BURN: u32 = 5;

/// A clean entry whose `as_of` is 300 s ahead of the ledger time.
pub const MODE_AHEAD_300: u32 = 6;
/// The same, 301 s ahead.
pub const MODE_AHEAD_301: u32 = 7;

#[contract]
pub struct StubFeed;

#[contractimpl]
impl StubFeed {
    pub fn __constructor(env: Env, mode: u32) {
        env.storage().instance().set(&0u32, &mode);
    }

    pub fn set_mode(env: Env, mode: u32) {
        env.storage().instance().set(&0u32, &mode);
    }

    pub fn get(env: Env, _asset: Address) -> Option<Entry> {
        let mode: u32 = env.storage().instance().get(&0u32).unwrap_or(MODE_PANIC);
        let (version, status, flags) = match mode {
            MODE_VERSION_2 => (2, 0, 0),
            MODE_STATUS_3 => (1, 3, 1),
            MODE_CLEAN => (1, 0, 0),
            MODE_NONE => return None,
            MODE_AHEAD_300 | MODE_AHEAD_301 => {
                let ahead = if mode == MODE_AHEAD_300 { 300 } else { 301 };
                return Some(Entry {
                    version: 1,
                    status: 0,
                    flags: 0,
                    evidence_hash: BytesN::from_array(&env, &[7u8; 32]),
                    as_of: env.ledger().timestamp() + ahead,
                    issuer_change_seen_at: 0,
                    published_ledger: 5,
                });
            }
            MODE_BURN => {
                env.cost_estimate().budget().reset_default();
                loop {
                    let _ = env.crypto().sha256(&Bytes::from_array(&env, &[1u8; 32]));
                }
            }
            _ => panic!("stub feed failure"),
        };
        Some(Entry {
            version,
            status,
            flags,
            evidence_hash: BytesN::from_array(&env, &[7u8; 32]),
            as_of: env.ledger().timestamp(),
            issuer_change_seen_at: 0,
            published_ledger: 5,
        })
    }
}

/// A `get` that returns a `u32` instead of `Option<Entry>`.
#[contract]
pub struct StubWrongType;

#[contractimpl]
impl StubWrongType {
    pub fn get(_env: Env, _asset: Address) -> u32 {
        7
    }
}

/// An entry with only some of the fields of the real one.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Partial {
    pub version: u32,
    pub status: u32,
}

/// A `get` that returns a struct with missing fields.
#[contract]
pub struct StubMissingFields;

#[contractimpl]
impl StubMissingFields {
    pub fn get(_env: Env, _asset: Address) -> Option<Partial> {
        Some(Partial {
            version: 1,
            status: 0,
        })
    }
}
