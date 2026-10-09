use soroban_sdk::{Address, Env, Vec};

use crate::constants::{TTL_EXTEND_TO, TTL_THRESHOLD};
use crate::errors::FeedError;
use crate::types::{DataKey, Entry};

pub(crate) fn load_admin(env: &Env) -> Result<Address, FeedError> {
    env.storage()
        .instance()
        .get(&DataKey::Admin)
        .ok_or(FeedError::NotInitialized)
}

pub(crate) fn load_publisher(env: &Env) -> Result<Address, FeedError> {
    env.storage()
        .instance()
        .get(&DataKey::Publisher)
        .ok_or(FeedError::NotInitialized)
}

pub(crate) fn load_index(env: &Env) -> Vec<Address> {
    env.storage()
        .persistent()
        .get(&DataKey::Assets)
        .unwrap_or_else(|| Vec::new(env))
}

pub(crate) fn load_entry(env: &Env, asset: Address) -> Option<Entry> {
    env.storage().persistent().get(&DataKey::Entry(asset))
}

pub(crate) fn bump_instance(env: &Env) {
    env.storage()
        .instance()
        .extend_ttl(TTL_THRESHOLD, TTL_EXTEND_TO);
}

pub(crate) fn bump_persistent(env: &Env, key: &DataKey) {
    env.storage()
        .persistent()
        .extend_ttl(key, TTL_THRESHOLD, TTL_EXTEND_TO);
}
