//! L3 to L8: `sync` and the decision, against the real feed Wasm and a stub.

use super::setup::*;
use super::stub::*;
use crate::feed;
use crate::*;
use soroban_sdk::{
    testutils::{Address as _, Events as _, Ledger as _},
    Address, Env,
};
use std::vec;

fn zero_fields(fx: &Fx, reason: u32) -> Decision {
    Decision {
        reason,
        status: 0,
        flags: 0,
        as_of: 0,
        evidence_hash: fx.hash(0),
        published_ledger: 0,
    }
}

fn decision_of(e: &feed::Entry, reason: u32) -> Decision {
    Decision {
        reason,
        status: e.status,
        flags: e.flags,
        as_of: e.as_of,
        evidence_hash: e.evidence_hash.clone(),
        published_ledger: e.published_ledger,
    }
}

#[test]
fn l3_sync_needs_no_auth() {
    let fx = Fx::bare();
    let a = fx.addr();
    fx.open_market(&a);
    fx.publish(&a, 2, NOW - 50, 2);

    // A pausing sync with no auth mocked at all.
    fx.env.mock_auths(&[]);
    let d = fx.client().sync(&a);
    assert_eq!(d.reason, REASON_STATUS);
    assert_eq!(fx.env.auths().len(), 0, "sync records no authorization");
    assert!(!fx.state(&a).borrow_enabled);

    // A no-op sync on the paused market: still no auth.
    fx.client().sync(&a);
    assert_eq!(fx.env.auths().len(), 0);
}

#[test]
fn l3_sync_on_an_unlisted_asset_fails() {
    let fx = Fx::bare();
    let a = fx.addr();
    fx.publish(&a, 2, NOW - 50, 2);
    let before = fx.snapshot(&[a.clone()], &[]);
    assert_eq!(err(fx.client().try_sync(&a)), MarketError::NotListed);
    fx.assert_unchanged(&before, &[a], &[]);
}

#[test]
fn l4_critical_entry_pauses_and_the_event_equals_the_entry() {
    let fx = Fx::bare();
    let a = fx.addr();
    fx.open_market(&a);
    fx.publish(&a, 2, NOW - 50, 9);
    fx.advance(7);

    let entry = fx.feed_client().get(&a).expect("published");
    let want = decision_of(&entry, REASON_STATUS);
    assert_eq!(want.status, 2);
    assert_eq!(want.as_of, NOW - 50);

    assert_eq!(fx.client().check(&a), want);
    let before_total = fx.state(&a).total_borrowed;
    let got = fx.client().sync(&a);
    assert_eq!(got, want);
    assert_eq!(
        fx.env.events().all(),
        vec![fx.paused_event(&a, REASON_STATUS, &want)]
    );
    assert_eq!(
        fx.state(&a),
        MarketState {
            borrow_enabled: false,
            reason: REASON_STATUS,
            changed_ledger: SEQ + 7,
            total_borrowed: before_total,
        }
    );
}

#[test]
fn l4_warning_stays_open_when_pause_at_is_2() {
    let fx = Fx::with_policy(2, EIGHT_DAYS);
    let a = fx.addr();
    fx.open_market(&a);
    fx.publish(&a, 1, NOW - 50, 2);
    let before = fx.snapshot(&[a.clone()], &[]);
    let d = fx.client().sync(&a);
    assert_eq!(d.reason, REASON_CLEAR);
    assert_eq!(d.status, 1);
    fx.assert_unchanged(&before, &[a.clone()], &[]);
    assert!(fx.state(&a).borrow_enabled);
}

#[test]
fn l4_warning_pauses_when_pause_at_is_1() {
    let fx = Fx::with_policy(1, EIGHT_DAYS);
    let a = fx.addr();
    fx.open_market(&a);
    fx.publish(&a, 1, NOW - 50, 2);
    let entry = fx.feed_client().get(&a).expect("published");
    let want = decision_of(&entry, REASON_STATUS);
    let d = fx.client().sync(&a);
    assert_eq!(d, want);
    assert_eq!(
        fx.env.events().all(),
        vec![fx.paused_event(&a, REASON_STATUS, &want)]
    );
    assert!(!fx.state(&a).borrow_enabled);
    assert_eq!(fx.state(&a).reason, REASON_STATUS);
}

#[test]
fn l5_missing_entry_is_not_covered() {
    let fx = Fx::bare();
    let a = fx.addr();
    // `check` works for any asset, listed or not.
    assert_eq!(
        fx.client().check(&a),
        zero_fields(&fx, REASON_NOT_COVERED)
    );
    fx.list(&a);
    assert_eq!(
        fx.client().check(&a),
        zero_fields(&fx, REASON_NOT_COVERED)
    );
}

#[test]
fn l5_missing_entry_pauses_an_open_market() {
    let fx = Fx::with_stub(MODE_CLEAN);
    let a = fx.addr();
    fx.list_open(&a);
    fx.stub_mode(MODE_NONE);
    let want = zero_fields(&fx, REASON_NOT_COVERED);
    assert_eq!(fx.client().sync(&a), want);
    assert_eq!(
        fx.env.events().all(),
        vec![fx.paused_event(&a, REASON_NOT_COVERED, &want)]
    );
    assert_eq!(fx.state(&a).reason, REASON_NOT_COVERED);
    assert!(!fx.state(&a).borrow_enabled);
}

#[test]
fn l5_age_equal_to_max_age_passes_and_one_second_more_is_stale() {
    let fx = Fx::bare();
    let a = fx.addr();
    fx.publish(&a, 0, NOW - EIGHT_DAYS, 1);
    fx.list_open(&a);
    assert_eq!(fx.client().check(&a).reason, REASON_CLEAR);
    assert!(fx.state(&a).borrow_enabled);

    fx.advance_time(1);
    let entry = fx.feed_client().get(&a).expect("published");
    let want = decision_of(&entry, REASON_STALE);
    assert_eq!(fx.client().check(&a), want);

    assert_eq!(fx.client().sync(&a), want);
    assert_eq!(
        fx.env.events().all(),
        vec![fx.paused_event(&a, REASON_STALE, &want)]
    );
    assert_eq!(fx.state(&a).reason, REASON_STALE);
}

#[test]
fn l5_a_stale_critical_reports_status() {
    let fx = Fx::bare();
    let a = fx.addr();
    fx.publish(&a, 2, NOW - EIGHT_DAYS - 10, 1);
    let d = fx.client().check(&a);
    assert_eq!(d.reason, REASON_STATUS);
    assert_eq!(d.status, 2);
}

#[test]
fn l5_an_entry_ahead_of_the_ledger_clock_is_not_stale() {
    let fx = Fx::bare();
    let a = fx.addr();
    // The feed allows `as_of` up to 300 s ahead of the ledger time.
    fx.publish(&a, 0, NOW + 300, 1);
    assert_eq!(fx.client().check(&a).reason, REASON_CLEAR);
}

#[test]
fn l6_unknown_schema_pauses() {
    for mode in [MODE_VERSION_2, MODE_STATUS_3] {
        let fx = Fx::with_stub(MODE_CLEAN);
        let a = fx.addr();
        fx.list_open(&a);
        fx.stub_mode(mode);
        let d = fx.client().sync(&a);
        assert_eq!(d.reason, REASON_UNKNOWN_SCHEMA, "mode {mode}");
        // The decision still copies what the feed returned.
        assert_eq!(d.flags, if mode == MODE_STATUS_3 { 1 } else { 0 });
        assert_eq!(d.status, if mode == MODE_STATUS_3 { 3 } else { 0 });
        assert_eq!(d.published_ledger, 5);
        assert_eq!(
            fx.env.events().all(),
            vec![fx.paused_event(&a, REASON_UNKNOWN_SCHEMA, &d)]
        );
        assert_eq!(fx.state(&a).reason, REASON_UNKNOWN_SCHEMA);
        assert!(!fx.state(&a).borrow_enabled);
    }
}

#[test]
fn l6_a_feed_that_panics_is_unavailable() {
    let fx = Fx::with_stub(MODE_CLEAN);
    let a = fx.addr();
    fx.list_open(&a);
    fx.stub_mode(MODE_PANIC);
    let want = zero_fields(&fx, REASON_FEED_UNAVAILABLE);
    assert_eq!(fx.client().check(&a), want);
    assert_eq!(fx.client().sync(&a), want);
    assert_eq!(
        fx.env.events().all(),
        vec![fx.paused_event(&a, REASON_FEED_UNAVAILABLE, &want)]
    );
    assert_eq!(fx.state(&a).reason, REASON_FEED_UNAVAILABLE);
    assert!(!fx.state(&a).borrow_enabled);
}

/// L7. The host does not trap on a missing contract: `try_get` returns an
/// error, so `sync` pauses with FEED_UNAVAILABLE.
#[test]
fn l7_a_feed_address_with_no_contract_pauses_as_unavailable() {
    let env = Env::default();
    env.ledger().set_timestamp(NOW);
    env.ledger().set_sequence_number(SEQ);
    let nothing = Address::generate(&env);
    let fx = Fx::on_feed(env, nothing.clone(), nothing.clone(), nothing, 2, EIGHT_DAYS);
    let a = fx.addr();
    fx.list(&a);

    let want = zero_fields(&fx, REASON_FEED_UNAVAILABLE);
    assert_eq!(fx.client().check(&a), want);

    // Force the market open (it could never be resumed with this feed).
    fx.env.as_contract(&fx.id, || {
        fx.env.storage().persistent().set(
            &DataKey::Market(a.clone()),
            &MarketState {
                borrow_enabled: true,
                reason: REASON_CLEAR,
                changed_ledger: SEQ,
                total_borrowed: 0,
            },
        );
    });
    assert_eq!(fx.client().sync(&a), want);
    assert_eq!(
        fx.env.events().all(),
        vec![fx.paused_event(&a, REASON_FEED_UNAVAILABLE, &want)]
    );
    assert!(!fx.state(&a).borrow_enabled);
    assert_eq!(fx.state(&a).reason, REASON_FEED_UNAVAILABLE);
}

#[test]
fn l8_sync_never_enables() {
    let fx = Fx::bare();
    let a = fx.addr();
    fx.publish(&a, 0, NOW - 100, 1);
    fx.list(&a); // paused as LISTED, with a clean entry waiting

    let before = fx.snapshot(&[a.clone()], &[]);
    let d = fx.client().sync(&a);
    assert_eq!(d.reason, REASON_CLEAR);
    fx.assert_unchanged(&before, &[a.clone()], &[]);
    assert!(!fx.state(&a).borrow_enabled);
    assert_eq!(fx.state(&a).reason, REASON_LISTED);
}

#[test]
fn l8_a_critical_pause_is_not_lifted_by_a_clean_entry() {
    let fx = Fx::bare();
    let a = fx.addr();
    fx.open_market(&a);
    fx.publish(&a, 2, NOW - 50, 2);
    fx.client().sync(&a);
    assert!(!fx.state(&a).borrow_enabled);

    // A second sync on a paused market emits nothing.
    let before = fx.snapshot(&[a.clone()], &[]);
    fx.client().sync(&a);
    fx.assert_unchanged(&before, &[a.clone()], &[]);

    // The entry turns clean: sync still does not enable.
    fx.publish(&a, 0, NOW - 10, 3);
    let before = fx.snapshot(&[a.clone()], &[]);
    assert_eq!(fx.client().sync(&a).reason, REASON_CLEAR);
    fx.assert_unchanged(&before, &[a.clone()], &[]);
    assert_eq!(fx.state(&a).reason, REASON_STATUS);
}

#[test]
fn l8_a_paused_market_keeps_its_first_reason() {
    let fx = Fx::bare();
    let a = fx.addr();
    fx.publish(&a, 2, NOW - 50, 2);
    fx.list(&a); // LISTED, while the entry is CRITICAL
    let before = fx.snapshot(&[a.clone()], &[]);
    assert_eq!(fx.client().sync(&a).reason, REASON_STATUS);
    fx.assert_unchanged(&before, &[a.clone()], &[]);
    assert_eq!(fx.state(&a).reason, REASON_LISTED);
}
