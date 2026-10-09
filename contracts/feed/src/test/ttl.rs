use super::setup::*;
use crate::*;
use soroban_sdk::vec as svec;

#[test]
fn t19_publish_extends_entry_index_and_instance() {
    let fx = Fx::new();
    let a = fx.addr();
    fx.publish(&[fx.upd(&a, 1, NOW)]);
    assert_eq!(fx.entry_ttl(&a), TTL_EXTEND_TO);
    assert_eq!(fx.index_ttl(), TTL_EXTEND_TO);
    assert_eq!(fx.instance_ttl(), TTL_EXTEND_TO);
}

#[test]
fn t19_role_changes_extend_the_instance() {
    let fx = Fx::new();
    fx.advance(TTL_EXTEND_TO - TTL_THRESHOLD + 10);
    assert!(fx.instance_ttl() < TTL_THRESHOLD);
    fx.client().propose_admin(&fx.addr());
    assert_eq!(fx.instance_ttl(), TTL_EXTEND_TO);

    fx.advance(TTL_EXTEND_TO - TTL_THRESHOLD + 10);
    fx.client().set_publisher(&fx.addr());
    assert_eq!(fx.instance_ttl(), TTL_EXTEND_TO);
}

#[test]
fn t20_extension_only_below_the_threshold() {
    let fx = Fx::new();
    let a = fx.addr();
    fx.publish(&[fx.upd(&a, 1, NOW - 1_000)]);

    // Above the threshold: a new publish leaves every TTL as it is.
    let step = 100_000;
    fx.advance(step);
    let want = TTL_EXTEND_TO - step;
    assert!(want > TTL_THRESHOLD);
    fx.publish(&[fx.upd(&a, 2, NOW - 900)]);
    assert_eq!(fx.entry_ttl(&a), want);
    assert_eq!(fx.index_ttl(), want);
    assert_eq!(fx.instance_ttl(), want);

    // Below the threshold: back to TTL_EXTEND_TO.
    fx.advance(TTL_EXTEND_TO - TTL_THRESHOLD);
    assert!(fx.entry_ttl(&a) < TTL_THRESHOLD);
    assert!(fx.index_ttl() < TTL_THRESHOLD);
    assert!(fx.instance_ttl() < TTL_THRESHOLD);
    fx.publish(&[fx.upd(&a, 3, NOW - 800)]);
    assert_eq!(fx.entry_ttl(&a), TTL_EXTEND_TO);
    assert_eq!(fx.index_ttl(), TTL_EXTEND_TO);
    assert_eq!(fx.instance_ttl(), TTL_EXTEND_TO);
}

#[test]
fn t20_an_untouched_entry_is_extended_only_when_published_again() {
    let fx = Fx::new();
    let a = fx.addr();
    let b = fx.addr();
    fx.publish(&[fx.upd(&a, 1, NOW), fx.upd(&b, 1, NOW)]);
    fx.advance(TTL_EXTEND_TO - TTL_THRESHOLD + 1);
    fx.publish(&[fx.upd(&a, 2, NOW + 1)]);
    assert_eq!(fx.entry_ttl(&a), TTL_EXTEND_TO);
    // b was not part of the batch, so its own TTL keeps running.
    assert_eq!(fx.entry_ttl(&b), TTL_THRESHOLD - 1);
    // Anyone can extend it without auth; the contract is not involved.
    fx.env.as_contract(&fx.id, || {
        fx.env.storage().persistent().extend_ttl(
            &DataKey::Entry(b.clone()),
            TTL_THRESHOLD,
            TTL_EXTEND_TO,
        );
    });
    assert_eq!(fx.entry_ttl(&b), TTL_EXTEND_TO);
}

#[test]
fn t21_reads_never_change_a_ttl() {
    let fx = Fx::new();
    let a = fx.addr();
    fx.publish(&[fx.upd(&a, 1, NOW)]);
    fx.advance(TTL_EXTEND_TO - TTL_THRESHOLD + 5);
    let before = (fx.entry_ttl(&a), fx.index_ttl(), fx.instance_ttl());
    assert!(before.0 < TTL_THRESHOLD);

    let c = fx.client();
    c.get(&a);
    c.get_many(&svec![&fx.env, a.clone()]);
    c.assets();
    c.admin();
    c.publisher();
    c.pending_admin();
    c.schema();
    assert_eq!(
        (fx.entry_ttl(&a), fx.index_ttl(), fx.instance_ttl()),
        before
    );
}

/// Documentation of archival (optional test in the spec). The test environment does
/// not fail a read after the TTL has passed: it restores the entry on access with
/// the environment's minimum persistent TTL (4,095 ledgers left). On a real
/// network a read of an archived entry fails until a restore, and since protocol 23
/// a transaction whose read-write footprint includes the entry restores it
/// automatically (the SDKs and the CLI build that footprint during simulation).
/// This test pins what the environment does, so an SDK change shows up here.
#[test]
fn t22_documentation_archival_is_not_enforced_in_the_test_env() {
    let fx = Fx::new();
    let a = fx.addr();
    fx.publish(&[fx.upd(&a, 1, NOW)]);

    // On the last live ledger the remaining TTL is 0.
    fx.advance(TTL_EXTEND_TO);
    assert_eq!(fx.entry_ttl(&a), 0);
    assert!(fx.entry(&a).is_some());

    // One ledger later the entry is past its TTL. The environment restores it with
    // a short TTL instead of failing; a publish then extends it as usual.
    fx.advance(1);
    assert!(fx.entry(&a).is_some());
    assert!(fx.entry_ttl(&a) < TTL_THRESHOLD);
    fx.publish(&[fx.upd(&a, 2, NOW + 1)]);
    assert_eq!(fx.entry_ttl(&a), TTL_EXTEND_TO);
}
