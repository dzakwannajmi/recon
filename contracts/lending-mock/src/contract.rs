use soroban_sdk::{contract, contractimpl, Address, Env, Vec};

use crate::errors::MarketError;
use crate::events::{
    BorrowOpened, BorrowsPaused, BorrowsResumed, Initialized, MarketListed, PolicySet,
};
use crate::policy::decide;
use crate::storage::{
    bump_instance, bump_persistent, load_admin, load_debt, load_feed, load_market, load_markets,
    load_policy, save_debt, save_market,
};
use crate::types::{
    DataKey, Decision, MarketState, Policy, MAX_MARKETS, MAX_MAX_AGE, MIN_MAX_AGE, REASON_CLEAR,
    REASON_LISTED, REASON_MANUAL,
};

#[contract]
pub struct LendingMock;

fn validate_policy(pause_at: u32, max_age: u64) -> Result<Policy, MarketError> {
    if !(1..=2).contains(&pause_at) || !(MIN_MAX_AGE..=MAX_MAX_AGE).contains(&max_age) {
        return Err(MarketError::InvalidPolicy);
    }
    Ok(Policy { pause_at, max_age })
}

/// Writes a paused state and emits `BorrowsPaused` with the entry fields of
/// `d`. `reason` is the state reason (the decision's, or MANUAL).
fn pause(env: &Env, asset: &Address, state: &mut MarketState, reason: u32, d: &Decision) {
    state.borrow_enabled = false;
    state.reason = reason;
    state.changed_ledger = env.ledger().sequence();
    save_market(env, asset, state);
    bump_instance(env);
    BorrowsPaused {
        asset: asset.clone(),
        reason,
        status: d.status,
        flags: d.flags,
        as_of: d.as_of,
        evidence_hash: d.evidence_hash.clone(),
        published_ledger: d.published_ledger,
    }
    .publish(env);
}

#[contractimpl]
impl LendingMock {
    /// Runs once at deploy time. The feed is fixed here and never changes.
    pub fn __constructor(
        env: Env,
        admin: Address,
        feed: Address,
        pause_at: u32,
        max_age: u64,
    ) -> Result<(), MarketError> {
        let policy = validate_policy(pause_at, max_age)?;
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Feed, &feed);
        env.storage().instance().set(&DataKey::Policy, &policy);
        bump_instance(&env);
        Initialized {
            admin,
            feed,
            pause_at,
            max_age,
        }
        .publish(&env);
        Ok(())
    }

    /// Lists a market. A new market starts paused: the admin resumes it once
    /// the check is CLEAR.
    pub fn add_market(env: Env, asset: Address) -> Result<(), MarketError> {
        let admin = load_admin(&env)?;
        admin.require_auth();
        let mut markets = load_markets(&env);
        if markets.contains(&asset) {
            return Err(MarketError::AlreadyListed);
        }
        if markets.len() >= MAX_MARKETS {
            return Err(MarketError::TooManyMarkets);
        }
        markets.push_back(asset.clone());
        env.storage().persistent().set(&DataKey::Markets, &markets);
        bump_persistent(&env, &DataKey::Markets);
        save_market(
            &env,
            &asset,
            &MarketState {
                borrow_enabled: false,
                reason: REASON_LISTED,
                changed_ledger: env.ledger().sequence(),
                total_borrowed: 0,
            },
        );
        bump_instance(&env);
        MarketListed { asset }.publish(&env);
        Ok(())
    }

    /// Read only, for any asset. No writes, no events, no TTL bumps.
    pub fn check(env: Env, asset: Address) -> Result<Decision, MarketError> {
        let feed = load_feed(&env)?;
        let policy = load_policy(&env)?;
        Ok(decide(&env, &feed, &policy, &asset))
    }

    /// Open to anyone. Reads the feed and can only pause an open market; it
    /// never enables one. Returns the decision either way.
    pub fn sync(env: Env, asset: Address) -> Result<Decision, MarketError> {
        let mut state = load_market(&env, &asset).ok_or(MarketError::NotListed)?;
        let feed = load_feed(&env)?;
        let policy = load_policy(&env)?;
        let d = decide(&env, &feed, &policy, &asset);
        if d.reason != REASON_CLEAR && state.borrow_enabled {
            pause(&env, &asset, &mut state, d.reason, &d);
        }
        Ok(d)
    }

    /// Admin brake. A no-op when the market is already paused.
    pub fn pause_borrows(env: Env, asset: Address) -> Result<(), MarketError> {
        let admin = load_admin(&env)?;
        admin.require_auth();
        let mut state = load_market(&env, &asset).ok_or(MarketError::NotListed)?;
        if state.borrow_enabled {
            let feed = load_feed(&env)?;
            let policy = load_policy(&env)?;
            let d = decide(&env, &feed, &policy, &asset);
            pause(&env, &asset, &mut state, REASON_MANUAL, &d);
        }
        Ok(())
    }

    /// Admin only, and only while the check is CLEAR. No-op when already open.
    pub fn resume_borrows(env: Env, asset: Address) -> Result<(), MarketError> {
        let admin = load_admin(&env)?;
        admin.require_auth();
        let mut state = load_market(&env, &asset).ok_or(MarketError::NotListed)?;
        let feed = load_feed(&env)?;
        let policy = load_policy(&env)?;
        let d = decide(&env, &feed, &policy, &asset);
        if d.reason != REASON_CLEAR {
            return Err(MarketError::PolicyBlocks);
        }
        if !state.borrow_enabled {
            state.borrow_enabled = true;
            state.reason = REASON_CLEAR;
            state.changed_ledger = env.ledger().sequence();
            save_market(&env, &asset, &state);
            bump_instance(&env);
            BorrowsResumed {
                asset,
                status: d.status,
                as_of: d.as_of,
                evidence_hash: d.evidence_hash,
                published_ledger: d.published_ledger,
            }
            .publish(&env);
        }
        Ok(())
    }

    /// Records a borrow in the mock ledger. No token moves. It checks the
    /// stored state only, so it stays open until the next `sync`.
    pub fn open_borrow(
        env: Env,
        borrower: Address,
        asset: Address,
        amount: i128,
    ) -> Result<(), MarketError> {
        borrower.require_auth();
        let mut state = load_market(&env, &asset).ok_or(MarketError::NotListed)?;
        if amount <= 0 {
            return Err(MarketError::InvalidAmount);
        }
        if !state.borrow_enabled {
            return Err(MarketError::BorrowsPaused);
        }
        let total = state
            .total_borrowed
            .checked_add(amount)
            .ok_or(MarketError::Overflow)?;
        let debt = load_debt(&env, &borrower, &asset)
            .checked_add(amount)
            .ok_or(MarketError::Overflow)?;
        state.total_borrowed = total;
        save_market(&env, &asset, &state);
        save_debt(&env, &borrower, &asset, debt);
        bump_instance(&env);
        BorrowOpened {
            asset,
            borrower,
            amount,
        }
        .publish(&env);
        Ok(())
    }

    /// Replaces the policy. It does not re-evaluate markets; `sync` does.
    pub fn set_policy(env: Env, pause_at: u32, max_age: u64) -> Result<(), MarketError> {
        let admin = load_admin(&env)?;
        admin.require_auth();
        let policy = validate_policy(pause_at, max_age)?;
        env.storage().instance().set(&DataKey::Policy, &policy);
        bump_instance(&env);
        PolicySet { pause_at, max_age }.publish(&env);
        Ok(())
    }

    pub fn admin(env: Env) -> Result<Address, MarketError> {
        load_admin(&env)
    }

    pub fn feed(env: Env) -> Result<Address, MarketError> {
        load_feed(&env)
    }

    pub fn policy(env: Env) -> Result<Policy, MarketError> {
        load_policy(&env)
    }

    pub fn markets(env: Env) -> Vec<Address> {
        load_markets(&env)
    }

    pub fn market(env: Env, asset: Address) -> Option<MarketState> {
        load_market(&env, &asset)
    }

    pub fn debt(env: Env, borrower: Address, asset: Address) -> i128 {
        load_debt(&env, &borrower, &asset)
    }
}
