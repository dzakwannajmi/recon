use soroban_sdk::{Address, Env, Vec};

use crate::errors::MarketError;
use crate::types::{DataKey, MarketState, Policy, TTL_EXTEND_TO, TTL_THRESHOLD};

pub(crate) fn load_admin(env: &Env) -> Result<Address, MarketError> {
    env.storage()
        .instance()
        .get(&DataKey::Admin)
        .ok_or(MarketError::NotInitialized)
}

pub(crate) fn load_feed(env: &Env) -> Result<Address, MarketError> {
    env.storage()
        .instance()
        .get(&DataKey::Feed)
        .ok_or(MarketError::NotInitialized)
}

pub(crate) fn load_policy(env: &Env) -> Result<Policy, MarketError> {
    env.storage()
        .instance()
        .get(&DataKey::Policy)
        .ok_or(MarketError::NotInitialized)
}

pub(crate) fn load_markets(env: &Env) -> Vec<Address> {
    env.storage()
        .persistent()
        .get(&DataKey::Markets)
        .unwrap_or_else(|| Vec::new(env))
}

pub(crate) fn load_market(env: &Env, asset: &Address) -> Option<MarketState> {
    env.storage()
        .persistent()
        .get(&DataKey::Market(asset.clone()))
}

pub(crate) fn save_market(env: &Env, asset: &Address, state: &MarketState) {
    let key = DataKey::Market(asset.clone());
    env.storage().persistent().set(&key, state);
    bump_persistent(env, &key);
}

pub(crate) fn load_debt(env: &Env, borrower: &Address, asset: &Address) -> i128 {
    env.storage()
        .persistent()
        .get(&DataKey::Debt(borrower.clone(), asset.clone()))
        .unwrap_or(0)
}

pub(crate) fn save_debt(env: &Env, borrower: &Address, asset: &Address, debt: i128) {
    let key = DataKey::Debt(borrower.clone(), asset.clone());
    env.storage().persistent().set(&key, &debt);
    bump_persistent(env, &key);
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
