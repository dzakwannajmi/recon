//! L10: `open_borrow`.

use super::setup::*;
use crate::*;
use soroban_sdk::{testutils::Events as _, Event as _};
use std::vec;

#[test]
fn l10_borrower_auth_is_exact() {
    let fx = Fx::bare();
    let a = fx.addr();
    fx.open_market(&a);
    let b = fx.addr();
    let args = args3(&fx.env, b.clone(), a.clone(), 5i128);

    let before = fx.snapshot(&[a.clone()], &[b.clone()]);
    assert_auth_error(fx.client().try_open_borrow(&b, &a, &5));
    fx.assert_unchanged(&before, &[a.clone()], &[b.clone()]);

    // Another address's auth, and the admin's.
    for who in [fx.addr(), fx.admin.clone()] {
        fx.mock(&who, "open_borrow", args.clone());
        assert_auth_error(fx.client().try_open_borrow(&b, &a, &5));
        fx.assert_unchanged(&before, &[a.clone()], &[b.clone()]);
    }

    // The borrower's auth for a different amount does not cover this call.
    fx.mock(
        &b,
        "open_borrow",
        args3(&fx.env, b.clone(), a.clone(), 6i128),
    );
    assert_auth_error(fx.client().try_open_borrow(&b, &a, &5));
    fx.assert_unchanged(&before, &[a.clone()], &[b.clone()]);

    fx.mock(&b, "open_borrow", args.clone());
    fx.client().open_borrow(&b, &a, &5);
    fx.assert_auth(&b, "open_borrow", args);
    assert_eq!(
        fx.env.events().all(),
        vec![BorrowOpened {
            asset: a.clone(),
            borrower: b.clone(),
            amount: 5
        }
        .to_xdr(&fx.env, &fx.id)]
    );
}

fn borrow(fx: &Fx, b: &soroban_sdk::Address, a: &soroban_sdk::Address, amount: i128) {
    fx.mock(
        b,
        "open_borrow",
        args3(&fx.env, b.clone(), a.clone(), amount),
    );
    fx.client().open_borrow(b, a, &amount);
}

fn try_borrow(
    fx: &Fx,
    b: &soroban_sdk::Address,
    a: &soroban_sdk::Address,
    amount: i128,
) -> MarketError {
    fx.mock(
        b,
        "open_borrow",
        args3(&fx.env, b.clone(), a.clone(), amount),
    );
    err(fx.client().try_open_borrow(b, a, &amount))
}

#[test]
fn l10_invalid_amounts_are_refused() {
    let fx = Fx::bare();
    let a = fx.addr();
    fx.open_market(&a);
    let b = fx.addr();
    let before = fx.snapshot(&[a.clone()], &[b.clone()]);
    for amount in [0i128, -1, i128::MIN] {
        assert_eq!(try_borrow(&fx, &b, &a, amount), MarketError::InvalidAmount);
        fx.assert_unchanged(&before, &[a.clone()], &[b.clone()]);
    }
}

#[test]
fn l10_unlisted_and_paused_markets_refuse() {
    let fx = Fx::bare();
    let a = fx.addr();
    let b = fx.addr();
    let before = fx.snapshot(&[a.clone()], &[b.clone()]);
    assert_eq!(try_borrow(&fx, &b, &a, 1), MarketError::NotListed);
    fx.assert_unchanged(&before, &[a.clone()], &[b.clone()]);

    // Listed but paused (LISTED).
    fx.publish(&a, 0, NOW - 100, 1);
    fx.list(&a);
    let before = fx.snapshot(&[a.clone()], &[b.clone()]);
    assert_eq!(try_borrow(&fx, &b, &a, 1), MarketError::BorrowsPaused);
    fx.assert_unchanged(&before, &[a.clone()], &[b.clone()]);

    // The amount check comes before the paused check.
    assert_eq!(try_borrow(&fx, &b, &a, 0), MarketError::InvalidAmount);
    fx.assert_unchanged(&before, &[a.clone()], &[b.clone()]);
}

#[test]
fn l10_a_market_paused_by_sync_refuses_new_borrows() {
    let fx = Fx::bare();
    let a = fx.addr();
    let b = fx.addr();
    fx.open_market(&a);
    borrow(&fx, &b, &a, 1);
    fx.publish(&a, 2, NOW - 50, 2);
    // Between the publish and the next sync the stored state is still open.
    borrow(&fx, &b, &a, 1);
    fx.client().sync(&a);
    let before = fx.snapshot(&[a.clone()], &[b.clone()]);
    assert_eq!(try_borrow(&fx, &b, &a, 1), MarketError::BorrowsPaused);
    fx.assert_unchanged(&before, &[a.clone()], &[b.clone()]);
    assert_eq!(fx.client().debt(&b, &a), 2);
}

#[test]
fn l10_overflow_is_refused_and_changes_nothing() {
    let fx = Fx::bare();
    let a = fx.addr();
    let b = fx.addr();
    fx.open_market(&a);
    borrow(&fx, &b, &a, i128::MAX);
    assert_eq!(fx.state(&a).total_borrowed, i128::MAX);
    let before = fx.snapshot(&[a.clone()], &[b.clone()]);
    assert_eq!(try_borrow(&fx, &b, &a, 1), MarketError::Overflow);
    fx.assert_unchanged(&before, &[a.clone()], &[b.clone()]);

    // Another borrower overflows the market total, not their own debt.
    let c = fx.addr();
    let before = fx.snapshot(&[a.clone()], &[b.clone(), c.clone()]);
    assert_eq!(try_borrow(&fx, &c, &a, 1), MarketError::Overflow);
    fx.assert_unchanged(&before, &[a.clone()], &[b.clone(), c.clone()]);
    assert_eq!(fx.client().debt(&c, &a), 0);
}

#[test]
fn l10_debt_and_total_accumulate_per_borrower_and_market() {
    let fx = Fx::bare();
    let a1 = fx.addr();
    let a2 = fx.addr();
    let b1 = fx.addr();
    let b2 = fx.addr();
    fx.open_market(&a1);
    fx.open_market(&a2);
    borrow(&fx, &b1, &a1, 10);
    borrow(&fx, &b1, &a1, 5);
    borrow(&fx, &b2, &a1, 7);
    borrow(&fx, &b1, &a2, 100);
    assert_eq!(fx.client().debt(&b1, &a1), 15);
    assert_eq!(fx.client().debt(&b2, &a1), 7);
    assert_eq!(fx.client().debt(&b1, &a2), 100);
    assert_eq!(fx.client().debt(&b2, &a2), 0);
    assert_eq!(fx.state(&a1).total_borrowed, 22);
    assert_eq!(fx.state(&a2).total_borrowed, 100);
}
