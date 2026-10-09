use super::setup::*;
use crate::*;
use soroban_sdk::BytesN;

#[test]
fn t14_ordering_guards() {
    let fx = Fx::new();
    let a = fx.addr();
    let k = core::slice::from_ref(&a);
    let first = Update {
        flags: 1 | (1 << 3),
        issuer_change_seen_at: NOW - 1_000,
        ..fx.upd(&a, 1, NOW - 500)
    };
    fx.publish(core::slice::from_ref(&first));

    // as_of one second before the stored one.
    let stale = Update {
        evidence_hash: fx.hash(2),
        as_of: NOW - 501,
        ..first.clone()
    };
    fx.assert_publish_fails(core::slice::from_ref(&stale), FeedError::StaleAsOf, k);

    // The change time moves back.
    let back = Update {
        evidence_hash: fx.hash(3),
        as_of: NOW - 400,
        issuer_change_seen_at: NOW - 1_001,
        ..first.clone()
    };
    fx.assert_publish_fails(
        core::slice::from_ref(&back),
        FeedError::ChangeTimeWentBack,
        k,
    );

    // Stale wins over a change time that went back (checked first).
    let both = Update {
        as_of: NOW - 501,
        ..back
    };
    fx.assert_publish_fails(&[both], FeedError::StaleAsOf, k);

    // The same change time is fine, and so is a later one.
    let same = Update {
        evidence_hash: fx.hash(4),
        as_of: NOW - 400,
        ..first.clone()
    };
    assert_eq!(fx.publish(&[same]), 1);
    let later = Update {
        evidence_hash: fx.hash(5),
        as_of: NOW - 300,
        issuer_change_seen_at: NOW - 300,
        ..first
    };
    assert_eq!(fx.publish(&[later]), 1);
    assert_eq!(fx.entry(&a).unwrap().issuer_change_seen_at, NOW - 300);
}

#[test]
fn t14_change_time_zero_to_t_ok_and_t_to_zero_rejected() {
    let fx = Fx::new();
    let a = fx.addr();
    let k = core::slice::from_ref(&a);
    // No change seen.
    fx.publish(&[fx.upd(&a, 1, NOW - 100)]);
    assert_eq!(fx.entry(&a).unwrap().issuer_change_seen_at, 0);

    // 0 -> t is accepted.
    let t = NOW - 60;
    let seen = Update {
        flags: 1 << 3,
        issuer_change_seen_at: t,
        ..fx.upd(&a, 2, NOW - 50)
    };
    assert_eq!(fx.publish(&[seen]), 1);
    assert_eq!(fx.entry(&a).unwrap().issuer_change_seen_at, t);

    // t -> 0 is rejected, even with no change flag raised.
    let cleared = Update {
        status: 0,
        flags: 0,
        issuer_change_seen_at: 0,
        ..fx.upd(&a, 3, NOW - 40)
    };
    fx.assert_publish_fails(&[cleared], FeedError::ChangeTimeWentBack, k);

    // The hold has ended: bits clear, the time is kept.
    let kept = Update {
        status: 0,
        flags: 0,
        issuer_change_seen_at: t,
        ..fx.upd(&a, 3, NOW - 40)
    };
    assert_eq!(fx.publish(&[kept]), 1);
    let e = fx.entry(&a).unwrap();
    assert_eq!((e.status, e.flags, e.issuer_change_seen_at), (0, 0, t));
}

// A deterministic stand-in for a property test: over many pseudo-random
// sequences, the stored as_of and issuer_change_seen_at never decrease.
#[test]
fn t25_stored_times_never_decrease() {
    let fx = Fx::new();
    let a = fx.addr();
    let mut seed: u64 = 0x9E37_79B9_7F4A_7C15;
    let mut next = move || {
        seed = seed
            .wrapping_mul(6_364_136_223_846_793_005)
            .wrapping_add(1_442_695_040_888_963_407);
        seed >> 33
    };
    let (mut last_as_of, mut last_change) = (0u64, 0u64);
    let mut accepted = 0;
    for i in 0..200u64 {
        // Mostly moving forward with some jitter, so some updates are stale.
        let as_of = NOW - 1_000 + i * 4 + next() % 9;
        let change = if next() % 3 == 0 {
            0
        } else {
            as_of - next() % 300
        };
        let flags = if change != 0 && next() % 2 == 0 {
            1 << 3
        } else {
            0
        };
        let u = Update {
            asset: a.clone(),
            status: if flags == 0 { 0 } else { 1 },
            flags,
            evidence_hash: BytesN::from_array(&fx.env, &[(i % 250) as u8 + 1; 32]),
            as_of,
            issuer_change_seen_at: change,
        };
        if fx.try_publish(core::slice::from_ref(&u)).is_ok() {
            accepted += 1;
        }
        if let Some(e) = fx.entry(&a) {
            assert!(e.as_of >= last_as_of, "as_of went back");
            assert!(
                e.issuer_change_seen_at >= last_change,
                "change time went back"
            );
            (last_as_of, last_change) = (e.as_of, e.issuer_change_seen_at);
        }
    }
    assert!(accepted > 3, "the sequence should accept some updates");
}
