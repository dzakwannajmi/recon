use super::setup::*;
use crate::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger as _},
    Address, BytesN, Env, Vec,
};
use std::vec::Vec as StdVec;

#[test]
fn t13_empty_batch() {
    let fx = Fx::new();
    fx.assert_publish_fails(&[], FeedError::EmptyBatch, &[]);
}

#[test]
fn t13_batch_too_large() {
    let fx = Fx::new();
    let keys: StdVec<Address> = (0..MAX_BATCH + 1).map(|_| fx.addr()).collect();
    let ups: StdVec<Update> = keys.iter().map(|k| fx.upd(k, 1, NOW)).collect();
    assert_eq!(ups.len(), 26);
    fx.assert_publish_fails(&ups, FeedError::BatchTooLarge, &keys);
}

#[test]
fn t13_duplicate_asset() {
    let fx = Fx::new();
    let a = fx.addr();
    let b = fx.addr();
    let ups = [fx.upd(&a, 1, NOW), fx.upd(&b, 2, NOW), fx.upd(&a, 3, NOW)];
    fx.assert_publish_fails(&ups, FeedError::DuplicateAsset, &[a, b]);
}

#[test]
fn t13_invalid_status() {
    let fx = Fx::new();
    let a = fx.addr();
    let u = Update {
        status: 3,
        ..fx.upd(&a, 1, NOW)
    };
    fx.assert_publish_fails(&[u], FeedError::InvalidStatus, &[a]);
}

#[test]
fn t13_unknown_flag_bits() {
    let fx = Fx::new();
    let a = fx.addr();
    for flags in [1u32 << 9, 1 << 31, 0x1FF | (1 << 12)] {
        let u = Update {
            flags,
            ..fx.upd(&a, 1, NOW)
        };
        fx.assert_publish_fails(&[u], FeedError::UnknownFlagBits, core::slice::from_ref(&a));
    }
}

#[test]
fn t13_status_flags_mismatch() {
    let fx = Fx::new();
    let a = fx.addr();
    for (status, flags) in [(0u32, 1u32), (1, 0), (2, 0)] {
        let u = Update {
            status,
            flags,
            ..fx.upd(&a, 1, NOW)
        };
        fx.assert_publish_fails(
            &[u],
            FeedError::StatusFlagsMismatch,
            core::slice::from_ref(&a),
        );
    }
    // The two consistent shapes pass.
    let ok = Update {
        status: 0,
        flags: 0,
        ..fx.upd(&a, 1, NOW)
    };
    assert_eq!(fx.publish(&[ok]), 1);
}

#[test]
fn t13_missing_change_time() {
    let fx = Fx::new();
    let a = fx.addr();
    for flags in [1u32 << 3, 1 << 4, (1 << 3) | (1 << 4) | 1] {
        let u = Update {
            flags,
            issuer_change_seen_at: 0,
            ..fx.upd(&a, 1, NOW)
        };
        fx.assert_publish_fails(
            &[u],
            FeedError::MissingChangeTime,
            core::slice::from_ref(&a),
        );
    }
}

#[test]
fn t13_zero_evidence_hash() {
    let fx = Fx::new();
    let a = fx.addr();
    let u = Update {
        evidence_hash: BytesN::from_array(&fx.env, &[0u8; 32]),
        ..fx.upd(&a, 1, NOW)
    };
    fx.assert_publish_fails(&[u], FeedError::ZeroEvidenceHash, &[a]);
}

#[test]
fn t13_invalid_as_of() {
    let fx = Fx::new();
    let a = fx.addr();
    let u = fx.upd(&a, 1, 0);
    fx.assert_publish_fails(&[u], FeedError::InvalidAsOf, &[a]);
}

#[test]
fn t13_as_of_in_future() {
    let fx = Fx::new();
    let a = fx.addr();
    assert_eq!(MAX_CLOCK_SKEW, 300);
    let too_far = fx.upd(&a, 1, NOW + 301);
    fx.assert_publish_fails(
        &[too_far],
        FeedError::AsOfInFuture,
        core::slice::from_ref(&a),
    );
    let edge = fx.upd(&a, 1, NOW + 300);
    assert_eq!(fx.publish(&[edge]), 1);
    assert_eq!(fx.entry(&a).unwrap().as_of, NOW + 300);
}

#[test]
fn t13_as_of_far_future_does_not_overflow() {
    let fx = Fx::new();
    let a = fx.addr();
    fx.env.ledger().set_timestamp(u64::MAX - 10);
    let u = Update {
        issuer_change_seen_at: 0,
        ..fx.upd(&a, 1, u64::MAX)
    };
    // now + 300 saturates at u64::MAX, so u64::MAX is not "in the future" here.
    assert_eq!(fx.publish(&[u]), 1);
}

#[test]
fn t13_change_after_as_of() {
    let fx = Fx::new();
    let a = fx.addr();
    let u = Update {
        status: 0,
        flags: 0,
        issuer_change_seen_at: NOW + 1,
        ..fx.upd(&a, 1, NOW)
    };
    fx.assert_publish_fails(&[u], FeedError::ChangeAfterAsOf, core::slice::from_ref(&a));
    // Equal is fine.
    let eq = Update {
        status: 0,
        flags: 0,
        issuer_change_seen_at: NOW,
        ..fx.upd(&a, 1, NOW)
    };
    assert_eq!(fx.publish(&[eq]), 1);
}

#[test]
fn t13_checks_run_in_the_documented_order() {
    let fx = Fx::new();
    let a = fx.addr();
    // Everything wrong at once: the earliest check in 4.5 wins.
    let all_wrong = Update {
        asset: a.clone(),
        status: 3,
        flags: 1 << 9,
        evidence_hash: BytesN::from_array(&fx.env, &[0u8; 32]),
        as_of: 0,
        issuer_change_seen_at: 5,
    };
    fx.assert_publish_fails(
        core::slice::from_ref(&all_wrong),
        FeedError::InvalidStatus,
        core::slice::from_ref(&a),
    );
    let u = Update {
        status: 1,
        ..all_wrong.clone()
    };
    fx.assert_publish_fails(
        core::slice::from_ref(&u),
        FeedError::UnknownFlagBits,
        core::slice::from_ref(&a),
    );
    let u = Update { flags: 0, ..u };
    fx.assert_publish_fails(
        core::slice::from_ref(&u),
        FeedError::StatusFlagsMismatch,
        core::slice::from_ref(&a),
    );
}

#[test]
fn t18_bit_table_guard() {
    assert_eq!(KNOWN_FLAGS, 0x1FF);
    assert_eq!(CHANGE_FLAGS, (1 << 3) | (1 << 4));
    assert_eq!(STATUS_MAX, 2);
    assert_eq!(SCHEMA, 1);
    assert_eq!(TTL_THRESHOLD, 1_036_800);
    assert_eq!(TTL_EXTEND_TO, 2_073_600);

    // The Etherfuse case: WARNING, flags 24, a change time.
    let fx = Fx::new();
    let a = fx.addr();
    let u = Update {
        status: 1,
        flags: 24,
        issuer_change_seen_at: NOW - 10,
        ..fx.upd(&a, 1, NOW)
    };
    assert_eq!(fx.publish(&[u]), 1);
    assert_eq!(fx.entry(&a).unwrap().flags, 24);
}

#[test]
fn t18_error_codes_are_fixed() {
    let codes = [
        (FeedError::NotInitialized, 1),
        (FeedError::NoPendingAdmin, 2),
        (FeedError::EmptyBatch, 10),
        (FeedError::BatchTooLarge, 11),
        (FeedError::DuplicateAsset, 12),
        (FeedError::InvalidStatus, 13),
        (FeedError::UnknownFlagBits, 14),
        (FeedError::StatusFlagsMismatch, 15),
        (FeedError::MissingChangeTime, 16),
        (FeedError::ZeroEvidenceHash, 17),
        (FeedError::InvalidAsOf, 18),
        (FeedError::AsOfInFuture, 19),
        (FeedError::ChangeAfterAsOf, 20),
        (FeedError::StaleAsOf, 30),
        (FeedError::AlreadyPublished, 31),
        (FeedError::ChangeTimeWentBack, 32),
        (FeedError::TooManyAssets, 40),
    ];
    for (e, n) in codes {
        assert_eq!(e as u32, n);
    }
}

#[test]
fn t18_not_initialized_is_typed() {
    // An address with no constructor run: the typed error, not a panic.
    let env = Env::default();
    let id = env.register(Feed, (Address::generate(&env), Address::generate(&env)));
    env.as_contract(&id, || {
        env.storage().instance().remove(&DataKey::Admin);
        env.storage().instance().remove(&DataKey::Publisher);
    });
    let c = FeedClient::new(&env, &id);
    assert_eq!(err(c.try_admin()), FeedError::NotInitialized);
    assert_eq!(err(c.try_publisher()), FeedError::NotInitialized);
    let ups: Vec<Update> = Vec::new(&env);
    assert_eq!(err(c.try_publish(&ups)), FeedError::NotInitialized);
    assert_eq!(
        err(c.try_set_publisher(&Address::generate(&env))),
        FeedError::NotInitialized
    );
}
