//! L14: every error leaves storage and events as they were. Most error tests
//! assert this inline (`assert_unchanged`); this file covers the rest in one
//! table over a populated market, including the getters' `NotInitialized`-free
//! behavior on an unlisted asset.

use super::setup::*;
use crate::*;
use soroban_sdk::{testutils::Address as _, Address, Env};

#[test]
fn l14_each_failing_call_changes_nothing() {
    let fx = Fx::bare();
    let a = fx.addr();
    let b = fx.addr();
    let unlisted = fx.addr();
    fx.open_market(&a);
    fx.mock(&b, "open_borrow", args3(&fx.env, b.clone(), a.clone(), 4i128));
    fx.client().open_borrow(&b, &a, &4);
    fx.publish(&a, 2, NOW - 50, 2); // CRITICAL, not synced yet

    let assets = [a.clone(), unlisted.clone()];
    let borrowers = [b.clone()];
    let before = fx.snapshot(&assets, &borrowers);

    // Auth is mocked per call, with the right arguments, so only the contract
    // error can fail the call.
    fx.mock(&fx.admin, "add_market", args1(&fx.env, a.clone()));
    assert_eq!(
        err(fx.client().try_add_market(&a)),
        MarketError::AlreadyListed
    );
    fx.assert_unchanged(&before, &assets, &borrowers);

    fx.mock(&fx.admin, "resume_borrows", args1(&fx.env, unlisted.clone()));
    assert_eq!(
        err(fx.client().try_resume_borrows(&unlisted)),
        MarketError::NotListed
    );
    fx.assert_unchanged(&before, &assets, &borrowers);

    fx.mock(&fx.admin, "resume_borrows", args1(&fx.env, a.clone()));
    assert_eq!(
        err(fx.client().try_resume_borrows(&a)),
        MarketError::PolicyBlocks
    );
    fx.assert_unchanged(&before, &assets, &borrowers);

    fx.mock(&fx.admin, "set_policy", args2(&fx.env, 9u32, EIGHT_DAYS));
    assert_eq!(
        err(fx.client().try_set_policy(&9, &EIGHT_DAYS)),
        MarketError::InvalidPolicy
    );
    fx.assert_unchanged(&before, &assets, &borrowers);

    assert_eq!(
        err(fx.client().try_sync(&unlisted)),
        MarketError::NotListed
    );
    fx.assert_unchanged(&before, &assets, &borrowers);

    fx.mock(&b, "open_borrow", args3(&fx.env, b.clone(), unlisted.clone(), 1i128));
    assert_eq!(
        err(fx.client().try_open_borrow(&b, &unlisted, &1)),
        MarketError::NotListed
    );
    fx.assert_unchanged(&before, &assets, &borrowers);

    fx.mock(&b, "open_borrow", args3(&fx.env, b.clone(), a.clone(), 0i128));
    assert_eq!(
        err(fx.client().try_open_borrow(&b, &a, &0)),
        MarketError::InvalidAmount
    );
    fx.assert_unchanged(&before, &assets, &borrowers);
}

#[test]
fn l14_an_uninitialized_contract_reports_not_initialized() {
    // Not reachable through `register` (the constructor always runs); the
    // storage helpers still return an error instead of trapping.
    let env = Env::default();
    let id = env.register(LendingMock, (Address::generate(&env), Address::generate(&env), 2u32, 3_600u64));
    env.as_contract(&id, || {
        env.storage().instance().remove(&DataKey::Policy);
    });
    let c = LendingMockClient::new(&env, &id);
    assert_eq!(err(c.try_policy()), MarketError::NotInitialized);
    assert_eq!(
        err(c.try_check(&Address::generate(&env))),
        MarketError::NotInitialized
    );
    assert_eq!(
        err(c.try_sync(&Address::generate(&env))),
        MarketError::NotListed
    );
}
