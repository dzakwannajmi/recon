//! L1 (constructor), L2 (add_market), L11 (pause_borrows, set_policy).

use super::setup::*;
use crate::*;
use soroban_sdk::{
    testutils::{Address as _, Events as _, Ledger as _},
    Address, Env, Event as _,
};
use std::{panic, vec};

fn register_panics(pause_at: u32, max_age: u64) -> bool {
    let env = Env::default();
    env.ledger().set_timestamp(NOW);
    let admin = Address::generate(&env);
    let feed_id = Address::generate(&env);
    let result = panic::catch_unwind(panic::AssertUnwindSafe(|| {
        env.register(LendingMock, (admin, feed_id, pause_at, max_age))
    }));
    match result {
        Ok(_) => false,
        Err(payload) => {
            let msg = payload
                .downcast_ref::<std::string::String>()
                .cloned()
                .or_else(|| payload.downcast_ref::<&str>().map(|s| (*s).into()))
                .unwrap_or_default();
            // Error(Contract, #10) is InvalidPolicy.
            assert!(msg.contains("#10"), "unexpected panic: {msg}");
            true
        }
    }
}

#[test]
fn l1_constructor_stores_everything_and_emits_initialized() {
    let env = Env::default();
    env.ledger().set_timestamp(NOW);
    env.ledger().set_sequence_number(SEQ);
    let admin = Address::generate(&env);
    let feed_id = Address::generate(&env);
    let id = env.register(
        LendingMock,
        (admin.clone(), feed_id.clone(), 2u32, EIGHT_DAYS),
    );

    // The constructor ran in the last invocation.
    let expected = Initialized {
        admin: admin.clone(),
        feed: feed_id.clone(),
        pause_at: 2,
        max_age: EIGHT_DAYS,
    }
    .to_xdr(&env, &id);
    assert_eq!(env.events().all(), vec![expected]);

    let c = LendingMockClient::new(&env, &id);
    assert_eq!(c.admin(), admin);
    assert_eq!(c.feed(), feed_id);
    assert_eq!(
        c.policy(),
        Policy {
            pause_at: 2,
            max_age: EIGHT_DAYS
        }
    );
    assert_eq!(c.markets().len(), 0);
    assert_eq!(c.market(&Address::generate(&env)), None);
    assert_eq!(
        c.debt(&Address::generate(&env), &Address::generate(&env)),
        0
    );
}

#[test]
fn l1_policy_bounds_are_accepted_at_the_edges() {
    for (pause_at, max_age) in [(1, MIN_MAX_AGE), (2, MAX_MAX_AGE), (1, MAX_MAX_AGE)] {
        let fx = Fx::with_policy(pause_at, max_age);
        assert_eq!(fx.client().policy(), Policy { pause_at, max_age });
    }
}

#[test]
fn l1_invalid_policy_is_refused_by_the_constructor() {
    for pause_at in [0u32, 3, u32::MAX] {
        assert!(register_panics(pause_at, EIGHT_DAYS), "pause_at {pause_at}");
    }
    for max_age in [0u64, 59, MAX_MAX_AGE + 1, u64::MAX] {
        assert!(register_panics(2, max_age), "max_age {max_age}");
    }
    assert!(!register_panics(2, EIGHT_DAYS));
}

#[test]
fn l2_add_market_needs_exactly_the_admin_auth() {
    let fx = Fx::bare();
    let a = fx.addr();

    // No auth at all.
    let before = fx.snapshot(&[a.clone()], &[]);
    assert_auth_error(fx.client().try_add_market(&a));
    fx.assert_unchanged(&before, &[a.clone()], &[]);

    // A random address's auth.
    let random = fx.addr();
    fx.mock(&random, "add_market", args1(&fx.env, a.clone()));
    assert_auth_error(fx.client().try_add_market(&a));
    fx.assert_unchanged(&before, &[a.clone()], &[]);

    // The admin's auth, for another asset's arguments.
    let other = fx.addr();
    fx.mock(&fx.admin, "add_market", args1(&fx.env, other));
    assert_auth_error(fx.client().try_add_market(&a));
    fx.assert_unchanged(&before, &[a.clone()], &[]);

    fx.mock(&fx.admin, "add_market", args1(&fx.env, a.clone()));
    fx.client().add_market(&a);
    fx.assert_auth(&fx.admin, "add_market", args1(&fx.env, a.clone()));
    assert_eq!(
        fx.env.events().all(),
        vec![MarketListed { asset: a.clone() }.to_xdr(&fx.env, &fx.id)]
    );
}

#[test]
fn l2_a_new_market_starts_paused_as_listed() {
    let fx = Fx::bare();
    let a = fx.addr();
    fx.list(&a);
    assert_eq!(
        fx.state(&a),
        MarketState {
            borrow_enabled: false,
            reason: REASON_LISTED,
            changed_ledger: SEQ,
            total_borrowed: 0,
        }
    );
    assert_eq!(fx.client().markets().len(), 1);
    assert_eq!(fx.client().markets().get(0), Some(a));
}

#[test]
fn l2_duplicate_and_eleventh_market_are_refused() {
    let fx = Fx::bare();
    let first = fx.addr();
    fx.list(&first);

    let before = fx.snapshot(&[first.clone()], &[]);
    fx.mock(&fx.admin, "add_market", args1(&fx.env, first.clone()));
    assert_eq!(
        err(fx.client().try_add_market(&first)),
        MarketError::AlreadyListed
    );
    fx.assert_unchanged(&before, &[first.clone()], &[]);

    let mut all = vec![first];
    for _ in 1..MAX_MARKETS {
        let a = fx.addr();
        fx.list(&a);
        all.push(a);
    }
    assert_eq!(fx.client().markets().len(), MAX_MARKETS);

    let eleventh = fx.addr();
    let before = fx.snapshot(&all, &[]);
    fx.mock(&fx.admin, "add_market", args1(&fx.env, eleventh.clone()));
    assert_eq!(
        err(fx.client().try_add_market(&eleventh)),
        MarketError::TooManyMarkets
    );
    fx.assert_unchanged(&before, &all, &[]);
    assert_eq!(fx.client().market(&eleventh), None);
}

#[test]
fn l11_pause_borrows_is_admin_only_and_records_manual() {
    let fx = Fx::bare();
    let a = fx.addr();
    fx.open_market(&a);
    assert!(fx.state(&a).borrow_enabled);
    fx.advance(5);

    // Not the admin.
    let random = fx.addr();
    let before = fx.snapshot(&[a.clone()], &[]);
    assert_auth_error(fx.client().try_pause_borrows(&a));
    fx.assert_unchanged(&before, &[a.clone()], &[]);
    fx.mock(&random, "pause_borrows", args1(&fx.env, a.clone()));
    assert_auth_error(fx.client().try_pause_borrows(&a));
    fx.assert_unchanged(&before, &[a.clone()], &[]);

    // The admin: reason 11, and the event carries the current decision.
    let d = fx.client().check(&a);
    assert_eq!(d.reason, REASON_CLEAR);
    fx.mock(&fx.admin, "pause_borrows", args1(&fx.env, a.clone()));
    fx.client().pause_borrows(&a);
    fx.assert_auth(&fx.admin, "pause_borrows", args1(&fx.env, a.clone()));
    assert_eq!(
        fx.env.events().all(),
        vec![fx.paused_event(&a, REASON_MANUAL, &d)]
    );
    assert_eq!(
        fx.state(&a),
        MarketState {
            borrow_enabled: false,
            reason: REASON_MANUAL,
            changed_ledger: SEQ + 5,
            total_borrowed: 0,
        }
    );

    // Already paused: a no-op without events.
    let before = fx.snapshot(&[a.clone()], &[]);
    fx.mock(&fx.admin, "pause_borrows", args1(&fx.env, a.clone()));
    fx.client().pause_borrows(&a);
    fx.assert_unchanged(&before, &[a.clone()], &[]);
}

#[test]
fn l11_pause_borrows_on_an_unlisted_market_fails() {
    let fx = Fx::bare();
    let a = fx.addr();
    let before = fx.snapshot(&[a.clone()], &[]);
    fx.mock(&fx.admin, "pause_borrows", args1(&fx.env, a.clone()));
    assert_eq!(
        err(fx.client().try_pause_borrows(&a)),
        MarketError::NotListed
    );
    fx.assert_unchanged(&before, &[a], &[]);
}

#[test]
fn l11_manual_pause_survives_sync_and_can_be_resumed_when_clear() {
    let fx = Fx::bare();
    let a = fx.addr();
    fx.open_market(&a);
    fx.mock(&fx.admin, "pause_borrows", args1(&fx.env, a.clone()));
    fx.client().pause_borrows(&a);

    // Sync never enables, and the reason stays MANUAL.
    let d = fx.client().sync(&a);
    assert_eq!(d.reason, REASON_CLEAR);
    assert_eq!(fx.state(&a).reason, REASON_MANUAL);
    assert!(!fx.state(&a).borrow_enabled);

    fx.mock(&fx.admin, "resume_borrows", args1(&fx.env, a.clone()));
    fx.client().resume_borrows(&a);
    assert!(fx.state(&a).borrow_enabled);
    assert_eq!(fx.state(&a).reason, REASON_CLEAR);
}

#[test]
fn l11_set_policy_is_admin_only_validated_and_emits() {
    let fx = Fx::bare();
    let args = args2(&fx.env, 1u32, 3_600u64);

    let before = fx.snapshot(&[], &[]);
    assert_auth_error(fx.client().try_set_policy(&1, &3_600));
    fx.assert_unchanged(&before, &[], &[]);
    let random = fx.addr();
    fx.mock(&random, "set_policy", args.clone());
    assert_auth_error(fx.client().try_set_policy(&1, &3_600));
    fx.assert_unchanged(&before, &[], &[]);

    // Validated with the admin's auth in place.
    for (p, m) in [
        (0u32, 3_600u64),
        (3, 3_600),
        (1, MIN_MAX_AGE - 1),
        (1, MAX_MAX_AGE + 1),
    ] {
        fx.mock(&fx.admin, "set_policy", args2(&fx.env, p, m));
        assert_eq!(
            err(fx.client().try_set_policy(&p, &m)),
            MarketError::InvalidPolicy
        );
        fx.assert_unchanged(&before, &[], &[]);
    }

    fx.mock(&fx.admin, "set_policy", args.clone());
    fx.client().set_policy(&1, &3_600);
    fx.assert_auth(&fx.admin, "set_policy", args);
    assert_eq!(
        fx.env.events().all(),
        vec![PolicySet {
            pause_at: 1,
            max_age: 3_600
        }
        .to_xdr(&fx.env, &fx.id)]
    );
    assert_eq!(
        fx.client().policy(),
        Policy {
            pause_at: 1,
            max_age: 3_600
        }
    );
}

#[test]
fn l11_set_policy_does_not_re_evaluate_markets_but_sync_does() {
    let fx = Fx::bare();
    let a = fx.addr();
    fx.open_market(&a);
    fx.publish(&a, 1, NOW - 50, 2); // WARNING: open under pause_at = 2

    fx.mock(&fx.admin, "set_policy", args2(&fx.env, 1u32, EIGHT_DAYS));
    fx.client().set_policy(&1, &EIGHT_DAYS);
    assert!(fx.state(&a).borrow_enabled, "set_policy changes no market");

    let d = fx.client().sync(&a);
    assert_eq!(d.reason, REASON_STATUS);
    assert!(!fx.state(&a).borrow_enabled);
}
