use soroban_sdk::{contract, contractimpl, Address, BytesN, ContractExecutable, Env, Vec};

use crate::constants::{MAX_ASSETS, MAX_BATCH, SCHEMA};
use crate::errors::FeedError;
use crate::events::{
    AdminChanged, AdminProposed, EntryUpdated, Initialized, PublisherChanged, Upgraded,
};
use crate::storage::{
    bump_instance, bump_persistent, load_admin, load_entry, load_index, load_publisher,
};
use crate::types::{DataKey, Entry, Update};
use crate::validate::{check_against_stored, check_update};

#[contract]
pub struct Feed;

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
        let mut index: Vec<Address> = load_index(&env);
        let mut index_changed = false;

        for (i, u) in updates.iter().enumerate() {
            check_update(&updates, i, &u, now, &zero)?;

            let key = DataKey::Entry(u.asset.clone());
            let existing: Option<Entry> = env.storage().persistent().get(&key);
            match existing {
                Some(e) => check_against_stored(&u, &e)?,
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
        load_entry(&env, asset)
    }

    /// Same order as the input; `None` for an unknown key; duplicates allowed.
    pub fn get_many(env: Env, assets: Vec<Address>) -> Result<Vec<Option<Entry>>, FeedError> {
        if assets.len() > MAX_BATCH {
            return Err(FeedError::BatchTooLarge);
        }
        let mut out: Vec<Option<Entry>> = Vec::new(&env);
        for asset in assets.iter() {
            out.push_back(load_entry(&env, asset));
        }
        Ok(out)
    }

    /// The index of published keys, in first-publish order.
    pub fn assets(env: Env) -> Vec<Address> {
        load_index(&env)
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
