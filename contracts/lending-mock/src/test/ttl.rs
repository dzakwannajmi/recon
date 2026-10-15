//! L12: reads change nothing; every write reaches the full TTL.

use super::setup::*;
use crate::*;
use soroban_sdk::testutils::Events as _;

#[test]
fn l12_writes_extend_every_touched_key_to_120_days() {
    let fx = Fx::bare();
    let a = fx.addr();
    let b = fx.addr();
    assert_eq!(fx.instance_ttl(), TTL_EXTEND_TO, "constructor");

    fx.publish(&a, 0, NOW - 100, 1);
    fx.list(&a);
    assert_eq!(fx.market_ttl(&a), TTL_EXTEND_TO, "add_market");
    assert_eq!(fx.markets_ttl(), TTL_EXTEND_TO, "add_market index");

    fx.mock(&fx.admin, "resume_borrows", args1(&fx.env, a.clone()));
    fx.client().resume_borrows(&a);
    assert_eq!(fx.market_ttl(&a), TTL_EXTEND_TO, "resume");

    fx.mock(&b, "open_borrow", args3(&fx.env, b.clone(), a.clone(), 1i128));
    fx.client().open_borrow(&b, &a, &1);
    assert_eq!(fx.market_ttl(&a), TTL_EXTEND_TO, "open_borrow market");
    assert_eq!(fx.debt_ttl(&b, &a), TTL_EXTEND_TO, "open_borrow debt");
    assert_eq!(fx.instance_ttl(), TTL_EXTEND_TO, "open_borrow instance");
}

#[test]
fn l12_a_sync_pause_extends_the_market_and_instance() {
    let fx = Fx::bare();
    let a = fx.addr();
    fx.open_market(&a);
    fx.advance(TTL_EXTEND_TO - TTL_THRESHOLD + 10);
    assert!(fx.market_ttl(&a) < TTL_THRESHOLD);
    assert!(fx.instance_ttl() < TTL_THRESHOLD);
    fx.publish(&a, 2, NOW - 50, 2);
    fx.client().sync(&a);
    assert_eq!(fx.market_ttl(&a), TTL_EXTEND_TO);
    assert_eq!(fx.instance_ttl(), TTL_EXTEND_TO);
}

#[test]
fn l12_a_manual_pause_extends_the_market_and_instance() {
    let fx = Fx::bare();
    let a = fx.addr();
    fx.open_market(&a);
    fx.advance(TTL_EXTEND_TO - TTL_THRESHOLD + 10);
    assert!(fx.market_ttl(&a) < TTL_THRESHOLD);
    fx.mock(&fx.admin, "pause_borrows", args1(&fx.env, a.clone()));
    fx.client().pause_borrows(&a);
    assert_eq!(fx.market_ttl(&a), TTL_EXTEND_TO);
    assert_eq!(fx.instance_ttl(), TTL_EXTEND_TO);
}

#[test]
fn l12_set_policy_extends_the_instance() {
    let fx = Fx::bare();
    fx.advance(TTL_EXTEND_TO - TTL_THRESHOLD + 10);
    assert!(fx.instance_ttl() < TTL_THRESHOLD);
    fx.mock(&fx.admin, "set_policy", args2(&fx.env, 1u32, EIGHT_DAYS));
    fx.client().set_policy(&1, &EIGHT_DAYS);
    assert_eq!(fx.instance_ttl(), TTL_EXTEND_TO);
}

#[test]
fn l12_reads_change_no_storage_event_or_ttl() {
    let fx = Fx::bare();
    let a = fx.addr();
    let b = fx.addr();
    fx.open_market(&a);
    fx.mock(&b, "open_borrow", args3(&fx.env, b.clone(), a.clone(), 3i128));
    fx.client().open_borrow(&b, &a, &3);
    // Past the threshold, so any bump would show.
    fx.advance(TTL_EXTEND_TO - TTL_THRESHOLD + 5);
    // A CRITICAL entry would make `sync` write; reads must still not.
    fx.publish(&a, 2, NOW - 50, 2);

    let ttls = |fx: &Fx| {
        (
            fx.market_ttl(&a),
            fx.markets_ttl(),
            fx.debt_ttl(&b, &a),
            fx.instance_ttl(),
        )
    };
    let ttl_before = ttls(&fx);
    assert!(ttl_before.0 < TTL_THRESHOLD);
    let snap = fx.snapshot(&[a.clone()], &[b.clone()]);

    let c = fx.client();
    let d = c.check(&a);
    assert_eq!(d.reason, REASON_STATUS);
    assert_eq!(fx.env.events().all().events().len(), 0, "check: no events");
    c.check(&fx.addr());
    c.admin();
    c.feed();
    c.policy();
    c.markets();
    c.market(&a);
    c.debt(&b, &a);
    assert_eq!(fx.env.events().all().events().len(), 0, "getters: no events");

    assert_eq!(ttls(&fx), ttl_before, "no TTL change");
    assert_eq!(fx.snapshot(&[a.clone()], &[b.clone()]), snap);
    assert!(fx.state(&a).borrow_enabled, "check did not pause");
}
