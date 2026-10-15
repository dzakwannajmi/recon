//! L9: `resume_borrows`.

use super::setup::*;
use super::stub::*;
use crate::*;
use soroban_sdk::testutils::Events as _;
use std::vec;

#[test]
fn l9_resume_needs_exactly_the_admin_auth() {
    let fx = Fx::bare();
    let a = fx.addr();
    fx.publish(&a, 0, NOW - 100, 1);
    fx.list(&a);

    let before = fx.snapshot(&[a.clone()], &[]);
    assert_auth_error(fx.client().try_resume_borrows(&a));
    fx.assert_unchanged(&before, &[a.clone()], &[]);

    let random = fx.addr();
    fx.mock(&random, "resume_borrows", args1(&fx.env, a.clone()));
    assert_auth_error(fx.client().try_resume_borrows(&a));
    fx.assert_unchanged(&before, &[a.clone()], &[]);

    // The admin's auth for another asset does not cover this call.
    let other = fx.addr();
    fx.mock(&fx.admin, "resume_borrows", args1(&fx.env, other));
    assert_auth_error(fx.client().try_resume_borrows(&a));
    fx.assert_unchanged(&before, &[a.clone()], &[]);
}

#[test]
fn l9_clear_resumes_and_emits_borrows_resumed() {
    let fx = Fx::bare();
    let a = fx.addr();
    fx.publish(&a, 0, NOW - 100, 1);
    fx.list(&a);
    fx.advance(3);

    let d = fx.client().check(&a);
    assert_eq!(d.reason, REASON_CLEAR);
    fx.mock(&fx.admin, "resume_borrows", args1(&fx.env, a.clone()));
    fx.client().resume_borrows(&a);
    fx.assert_auth(&fx.admin, "resume_borrows", args1(&fx.env, a.clone()));
    assert_eq!(fx.env.events().all(), vec![fx.resumed_event(&a, &d)]);
    assert_eq!(
        fx.state(&a),
        MarketState {
            borrow_enabled: true,
            reason: REASON_CLEAR,
            changed_ledger: SEQ + 3,
            total_borrowed: 0,
        }
    );
}

#[test]
fn l9_already_open_is_a_no_op_without_events() {
    let fx = Fx::bare();
    let a = fx.addr();
    fx.open_market(&a);
    fx.advance(10);
    let before = fx.snapshot(&[a.clone()], &[]);
    fx.mock(&fx.admin, "resume_borrows", args1(&fx.env, a.clone()));
    fx.client().resume_borrows(&a);
    fx.assert_unchanged(&before, &[a.clone()], &[]);
}

#[test]
fn l9_unlisted_market_fails() {
    let fx = Fx::bare();
    let a = fx.addr();
    fx.publish(&a, 0, NOW - 100, 1);
    let before = fx.snapshot(&[a.clone()], &[]);
    fx.mock(&fx.admin, "resume_borrows", args1(&fx.env, a.clone()));
    assert_eq!(
        err(fx.client().try_resume_borrows(&a)),
        MarketError::NotListed
    );
    fx.assert_unchanged(&before, &[a], &[]);
}

fn blocked(fx: &Fx, a: &soroban_sdk::Address, want_reason: u32) {
    assert_eq!(fx.client().check(a).reason, want_reason);
    let before = fx.snapshot(&[a.clone()], &[]);
    fx.mock(&fx.admin, "resume_borrows", args1(&fx.env, a.clone()));
    assert_eq!(
        err(fx.client().try_resume_borrows(a)),
        MarketError::PolicyBlocks,
        "reason {want_reason}"
    );
    fx.assert_unchanged(&before, &[a.clone()], &[]);
}

#[test]
fn l9_every_non_clear_reason_blocks_the_resume() {
    // NOT_COVERED, STATUS (CRITICAL and, with pause_at 1, WARNING), STALE.
    let fx = Fx::bare();
    let none = fx.addr();
    fx.list(&none);
    blocked(&fx, &none, REASON_NOT_COVERED);

    let crit = fx.addr();
    fx.publish(&crit, 2, NOW - 100, 1);
    fx.list(&crit);
    blocked(&fx, &crit, REASON_STATUS);

    let stale = fx.addr();
    fx.publish(&stale, 0, NOW - EIGHT_DAYS, 1);
    fx.list(&stale);
    fx.advance_time(1);
    blocked(&fx, &stale, REASON_STALE);

    let fx1 = Fx::with_policy(1, EIGHT_DAYS);
    let warn = fx1.addr();
    fx1.publish(&warn, 1, NOW - 100, 1);
    fx1.list(&warn);
    blocked(&fx1, &warn, REASON_STATUS);

    // FEED_UNAVAILABLE and UNKNOWN_SCHEMA through the stub.
    for (mode, reason) in [
        (MODE_PANIC, REASON_FEED_UNAVAILABLE),
        (MODE_VERSION_2, REASON_UNKNOWN_SCHEMA),
        (MODE_STATUS_3, REASON_UNKNOWN_SCHEMA),
        (MODE_NONE, REASON_NOT_COVERED),
    ] {
        let fx = Fx::with_stub(MODE_CLEAN);
        let a = fx.addr();
        fx.list(&a);
        fx.stub_mode(mode);
        blocked(&fx, &a, reason);
    }
}

#[test]
fn l9_an_open_market_with_a_blocking_check_is_still_refused() {
    // The check is read before the state: a resume call never succeeds, not
    // even as a no-op, while the check is not CLEAR.
    let fx = Fx::bare();
    let a = fx.addr();
    fx.open_market(&a);
    fx.publish(&a, 2, NOW - 50, 2);
    assert!(fx.state(&a).borrow_enabled, "no sync yet");
    blocked(&fx, &a, REASON_STATUS);
}

#[test]
fn l9_a_paused_market_resumes_after_the_entry_turns_clean() {
    let fx = Fx::bare();
    let a = fx.addr();
    fx.open_market(&a);
    fx.publish(&a, 2, NOW - 50, 2);
    fx.client().sync(&a);
    blocked(&fx, &a, REASON_STATUS);

    fx.publish(&a, 0, NOW - 10, 3);
    let d = fx.client().check(&a);
    assert_eq!(d.reason, REASON_CLEAR);
    fx.mock(&fx.admin, "resume_borrows", args1(&fx.env, a.clone()));
    fx.client().resume_borrows(&a);
    assert_eq!(fx.env.events().all(), vec![fx.resumed_event(&a, &d)]);
    assert!(fx.state(&a).borrow_enabled);
}
