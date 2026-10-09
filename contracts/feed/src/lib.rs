#![no_std]

//! Feed of verified facts and flags for tokenized real-world assets.
//!
//! The contract stores and guards; it never decides. Status, flags, and hold
//! windows are computed off chain by deterministic code and arrive here as
//! plain numbers and hashes. No free text is stored.

use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contracttype, Address, BytesN,
    ContractExecutable, Env, Vec,
};

/// Entry layout, bit table, status codes, and evidence-hash formula in force.
pub const SCHEMA: u32 = 1;
/// Status codes 0 (OK), 1 (WARNING), 2 (CRITICAL).
pub const STATUS_MAX: u32 = 2;
/// Bits 0 to 8 (D-035). Widened only by a contract upgrade.
pub const KNOWN_FLAGS: u32 = 0x1FF;
/// FLAG_CHANGE (bit 3) and SIGNER_CHANGE (bit 4).
pub const CHANGE_FLAGS: u32 = 0x018;
/// Cap for `publish` and `get_many`.
pub const MAX_BATCH: u32 = 25;
/// Cap for the `Assets` index.
pub const MAX_ASSETS: u32 = 100;
/// Seconds `as_of` may exceed the ledger timestamp (operator clock skew).
pub const MAX_CLOCK_SKEW: u64 = 300;
/// Ledgers per day at 5 s per ledger.
pub const DAY_IN_LEDGERS: u32 = 17_280;
/// Extend only when the remaining TTL is below this.
pub const TTL_THRESHOLD: u32 = 60 * DAY_IN_LEDGERS;
/// Extend to this many ledgers (below the 180-day maximum).
pub const TTL_EXTEND_TO: u32 = 120 * DAY_IN_LEDGERS;

/// Public ABI: numbers are never renumbered.
#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum FeedError {
    NotInitialized = 1,
    NoPendingAdmin = 2,
    EmptyBatch = 10,
    BatchTooLarge = 11,
    DuplicateAsset = 12,
    InvalidStatus = 13,
    UnknownFlagBits = 14,
    StatusFlagsMismatch = 15,
    MissingChangeTime = 16,
    ZeroEvidenceHash = 17,
    InvalidAsOf = 18,
    AsOfInFuture = 19,
    ChangeAfterAsOf = 20,
    StaleAsOf = 30,
    AlreadyPublished = 31,
    ChangeTimeWentBack = 32,
    TooManyAssets = 40,
}

/// Publisher input, one per asset. `asset` is the mainnet token contract address.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Update {
    pub asset: Address,
    pub status: u32,
    pub flags: u32,
    pub evidence_hash: BytesN<32>,
    pub as_of: u64,
    pub issuer_change_seen_at: u64,
}

/// Stored and returned by reads. New fields are added as `Option` (CAP-86).
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Entry {
    pub version: u32,
    pub status: u32,
    pub flags: u32,
    pub evidence_hash: BytesN<32>,
    pub as_of: u64,
    pub issuer_change_seen_at: u64,
    pub published_ledger: u32,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DataKey {
    /// Instance: `Address`.
    Admin,
    /// Instance: `Address`, present only between `propose_admin` and `accept_admin`.
    PendingAdmin,
    /// Instance: `Address`, the only writer of entries.
    Publisher,
    /// Persistent: `Vec<Address>`, first-publish order, at most `MAX_ASSETS`.
    Assets,
    /// Persistent: `Entry`, one per asset key.
    Entry(Address),
}

#[contractevent]
pub struct Initialized {
    pub admin: Address,
    pub publisher: Address,
}

#[contractevent]
pub struct EntryUpdated {
    #[topic]
    pub asset: Address,
    #[topic]
    pub status: u32,
    pub flags: u32,
    pub evidence_hash: BytesN<32>,
    pub as_of: u64,
    pub issuer_change_seen_at: u64,
}

#[contractevent]
pub struct PublisherChanged {
    #[topic]
    pub publisher: Address,
    pub previous: Address,
}

#[contractevent]
pub struct AdminProposed {
    #[topic]
    pub proposed: Address,
    pub admin: Address,
}

#[contractevent]
pub struct AdminChanged {
    #[topic]
    pub admin: Address,
    pub previous: Address,
}

#[contractevent]
pub struct Upgraded {
    pub wasm_hash: BytesN<32>,
}

#[contract]
pub struct Feed;

fn load_admin(env: &Env) -> Result<Address, FeedError> {
    env.storage()
        .instance()
        .get(&DataKey::Admin)
        .ok_or(FeedError::NotInitialized)
}

fn load_publisher(env: &Env) -> Result<Address, FeedError> {
    env.storage()
        .instance()
        .get(&DataKey::Publisher)
        .ok_or(FeedError::NotInitialized)
}

fn bump_instance(env: &Env) {
    env.storage()
        .instance()
        .extend_ttl(TTL_THRESHOLD, TTL_EXTEND_TO);
}

fn bump_persistent(env: &Env, key: &DataKey) {
    env.storage()
        .persistent()
        .extend_ttl(key, TTL_THRESHOLD, TTL_EXTEND_TO);
}

fn zero_hash(env: &Env) -> BytesN<32> {
    BytesN::from_array(env, &[0u8; 32])
}

#[contractimpl]
impl Feed {
    /// Runs once at deploy time and not on upgrade. `admin == publisher` is allowed.
    pub fn __constructor(env: Env, admin: Address, publisher: Address) {
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage()
            .instance()
            .set(&DataKey::Publisher, &publisher);
        bump_instance(&env);
        Initialized { admin, publisher }.publish(&env);
    }

    /// Writes a batch of entries, all or nothing. Only the stored publisher may call.
    /// The order of the checks fixes which error wins.
    pub fn publish(env: Env, updates: Vec<Update>) -> Result<u32, FeedError> {
        let publisher = load_publisher(&env)?;
        publisher.require_auth();

        let count = updates.len();
        if count == 0 {
            return Err(FeedError::EmptyBatch);
        }
        if count > MAX_BATCH {
            return Err(FeedError::BatchTooLarge);
        }

        let now = env.ledger().timestamp();
        let zero = zero_hash(&env);
        let mut index: Vec<Address> = env
            .storage()
            .persistent()
            .get(&DataKey::Assets)
            .unwrap_or_else(|| Vec::new(&env));
        let mut index_changed = false;

        for (i, u) in updates.iter().enumerate() {
            if updates
                .iter()
                .take(i)
                .any(|earlier| earlier.asset == u.asset)
            {
                return Err(FeedError::DuplicateAsset);
            }
            if u.status > STATUS_MAX {
                return Err(FeedError::InvalidStatus);
            }
            if u.flags & !KNOWN_FLAGS != 0 {
                return Err(FeedError::UnknownFlagBits);
            }
            if (u.status == 0) != (u.flags == 0) {
                return Err(FeedError::StatusFlagsMismatch);
            }
            if u.flags & CHANGE_FLAGS != 0 && u.issuer_change_seen_at == 0 {
                return Err(FeedError::MissingChangeTime);
            }
            if u.evidence_hash == zero {
                return Err(FeedError::ZeroEvidenceHash);
            }
            if u.as_of == 0 {
                return Err(FeedError::InvalidAsOf);
            }
            if u.as_of > now.saturating_add(MAX_CLOCK_SKEW) {
                return Err(FeedError::AsOfInFuture);
            }
            if u.issuer_change_seen_at > u.as_of {
                return Err(FeedError::ChangeAfterAsOf);
            }

            let key = DataKey::Entry(u.asset.clone());
            let existing: Option<Entry> = env.storage().persistent().get(&key);
            match existing {
                Some(e) => {
                    if u.as_of < e.as_of {
                        return Err(FeedError::StaleAsOf);
                    }
                    if u.as_of == e.as_of && u.evidence_hash == e.evidence_hash {
                        return Err(FeedError::AlreadyPublished);
                    }
                    if u.issuer_change_seen_at < e.issuer_change_seen_at {
                        return Err(FeedError::ChangeTimeWentBack);
                    }
                }
                None => {
                    if index.len() >= MAX_ASSETS {
                        return Err(FeedError::TooManyAssets);
                    }
                    index.push_back(u.asset.clone());
                    index_changed = true;
                }
            }

            let entry = Entry {
                version: SCHEMA,
                status: u.status,
                flags: u.flags,
                evidence_hash: u.evidence_hash.clone(),
                as_of: u.as_of,
                issuer_change_seen_at: u.issuer_change_seen_at,
                published_ledger: env.ledger().sequence(),
            };
            env.storage().persistent().set(&key, &entry);
            bump_persistent(&env, &key);
            EntryUpdated {
                asset: u.asset,
                status: u.status,
                flags: u.flags,
                evidence_hash: u.evidence_hash,
                as_of: u.as_of,
                issuer_change_seen_at: u.issuer_change_seen_at,
            }
            .publish(&env);
        }

        if index_changed {
            env.storage().persistent().set(&DataKey::Assets, &index);
        }
        if env.storage().persistent().has(&DataKey::Assets) {
            bump_persistent(&env, &DataKey::Assets);
        }
        bump_instance(&env);
        Ok(count)
    }

    /// Read only: no TTL bump, no events.
    pub fn get(env: Env, asset: Address) -> Option<Entry> {
        env.storage().persistent().get(&DataKey::Entry(asset))
    }

    /// Same order as the input; `None` for an unknown key; duplicates allowed.
    pub fn get_many(env: Env, assets: Vec<Address>) -> Result<Vec<Option<Entry>>, FeedError> {
        if assets.len() > MAX_BATCH {
            return Err(FeedError::BatchTooLarge);
        }
        let mut out: Vec<Option<Entry>> = Vec::new(&env);
        for asset in assets.iter() {
            out.push_back(env.storage().persistent().get(&DataKey::Entry(asset)));
        }
        Ok(out)
    }

    /// The index of published keys, in first-publish order.
    pub fn assets(env: Env) -> Vec<Address> {
        env.storage()
            .persistent()
            .get(&DataKey::Assets)
            .unwrap_or_else(|| Vec::new(&env))
    }

    pub fn admin(env: Env) -> Result<Address, FeedError> {
        load_admin(&env)
    }

    pub fn publisher(env: Env) -> Result<Address, FeedError> {
        load_publisher(&env)
    }

    pub fn pending_admin(env: Env) -> Option<Address> {
        env.storage().instance().get(&DataKey::PendingAdmin)
    }

    pub fn schema(_env: Env) -> u32 {
        SCHEMA
    }

    /// Replaces the writer. Rotating to a key nobody uses stops all writes.
    pub fn set_publisher(env: Env, new_publisher: Address) -> Result<(), FeedError> {
        let admin = load_admin(&env)?;
        admin.require_auth();
        let previous = load_publisher(&env)?;
        env.storage()
            .instance()
            .set(&DataKey::Publisher, &new_publisher);
        bump_instance(&env);
        PublisherChanged {
            publisher: new_publisher,
            previous,
        }
        .publish(&env);
        Ok(())
    }

    /// Step one of two. Overwrites an earlier proposal.
    pub fn propose_admin(env: Env, new_admin: Address) -> Result<(), FeedError> {
        let admin = load_admin(&env)?;
        admin.require_auth();
        env.storage()
            .instance()
            .set(&DataKey::PendingAdmin, &new_admin);
        bump_instance(&env);
        AdminProposed {
            proposed: new_admin,
            admin,
        }
        .publish(&env);
        Ok(())
    }

    /// Step two of two. Needs the auth of the pending admin.
    pub fn accept_admin(env: Env) -> Result<(), FeedError> {
        let pending: Address = env
            .storage()
            .instance()
            .get(&DataKey::PendingAdmin)
            .ok_or(FeedError::NoPendingAdmin)?;
        pending.require_auth();
        let previous = load_admin(&env)?;
        env.storage().instance().set(&DataKey::Admin, &pending);
        env.storage().instance().remove(&DataKey::PendingAdmin);
        bump_instance(&env);
        AdminChanged {
            admin: pending,
            previous,
        }
        .publish(&env);
        Ok(())
    }

    /// Wasm-hash executables only; never the external-reference variant, whose
    /// owner would control the contract's code. Storage stays; the constructor
    /// does not re-run.
    pub fn upgrade(env: Env, new_wasm_hash: BytesN<32>) -> Result<(), FeedError> {
        let admin = load_admin(&env)?;
        admin.require_auth();
        env.deployer()
            .update_current_contract(ContractExecutable::Wasm(new_wasm_hash.clone()));
        bump_instance(&env);
        Upgraded {
            wasm_hash: new_wasm_hash,
        }
        .publish(&env);
        Ok(())
    }
}

#[cfg(test)]
mod test;
