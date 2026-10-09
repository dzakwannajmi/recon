use super::setup::*;
use crate::*;
use soroban_sdk::{testutils::Ledger as _, vec as svec, Address, Vec};
use std::{vec, vec::Vec as StdVec};

#[test]
fn t3_publish_one_and_get() {
    let fx = Fx::new();
    fx.env.ledger().set_sequence_number(4_242);
    let a = fx.addr();
    let u = Update {
        asset: a.clone(),
        status: 1,
        flags: 24,
        evidence_hash: fx.hash(7),
        as_of: NOW - 60,
        issuer_change_seen_at: NOW - 100,
    };
    assert_eq!(fx.publish(core::slice::from_ref(&u)), 1);
    assert_eq!(
        fx.entry(&a),
        Some(Entry {
            version: 1,
            status: 1,
            flags: 24,
            evidence_hash: fx.hash(7),
            as_of: NOW - 60,
            issuer_change_seen_at: NOW - 100,
            published_ledger: 4_242,
        })
    );
    assert_eq!(fx.entry(&fx.addr()), None);
    assert_eq!(fx.client().assets(), svec![&fx.env, a]);
}

/// The example in spec 3.2: USTRY on 2026-10-08 (WARNING, FLAG_CHANGE and SIGNER_CHANGE
/// held, change seen at the check time). The key is the mainnet SAC contract ID.
#[test]
fn t3_spec_example_ustry() {
    let fx = Fx::new();
    let ustry = Address::from_str(
        &fx.env,
        "CBLV4ATSIWU67CFSQU2NVRKINQIKUZ2ODSZBUJTJ43VJVRSBTZYOPNUR",
    );
    let as_of = 1_791_423_259u64;
    fx.env.ledger().set_timestamp(as_of + 5);
    let u = Update {
        asset: ustry.clone(),
        status: 1,
        flags: 24,
        evidence_hash: fx.hash(0xab),
        as_of,
        issuer_change_seen_at: as_of,
    };
    assert_eq!(fx.publish(core::slice::from_ref(&u)), 1);
    let e = fx.entry(&ustry).unwrap();
    assert_eq!((e.status, e.flags, e.as_of), (1, 24, as_of));
    assert_eq!(e.issuer_change_seen_at, as_of);
    // BB1-style (256) and BENJI-style (128) masks are accepted shapes too.
    let other = fx.addr();
    for (i, flags) in [256u32, 128].into_iter().enumerate() {
        let v = Update {
            flags,
            ..fx.upd(&other, 2, as_of + i as u64 + 1)
        };
        assert_eq!(fx.publish(&[v]), 1);
    }
}

#[test]
fn t4_publish_max_batch() {
    let fx = Fx::new();
    let keys: StdVec<Address> = (0..MAX_BATCH).map(|_| fx.addr()).collect();
    let ups: StdVec<Update> = keys
        .iter()
        .enumerate()
        .map(|(i, k)| fx.upd(k, i as u8 + 1, NOW))
        .collect();
    assert_eq!(MAX_BATCH, 25);
    assert_eq!(fx.publish(&ups), 25);
    for (k, u) in keys.iter().zip(&ups) {
        let e = fx.entry(k).unwrap();
        assert_eq!(e.evidence_hash, u.evidence_hash);
        assert_eq!(e.version, SCHEMA);
    }
    let listed: StdVec<Address> = fx.client().assets().iter().collect();
    assert_eq!(listed, keys);
}

#[test]
fn t5_republish_overwrites_without_duplicate_index() {
    let fx = Fx::new();
    let a = fx.addr();
    let b = fx.addr();
    fx.publish(&[fx.upd(&a, 1, NOW - 100), fx.upd(&b, 2, NOW - 100)]);
    fx.env.ledger().set_sequence_number(SEQ + 50);

    let mut next = fx.upd(&a, 3, NOW - 50);
    next.status = 2;
    next.flags = 3;
    assert_eq!(fx.publish(&[next]), 1);

    let e = fx.entry(&a).unwrap();
    assert_eq!((e.status, e.flags, e.as_of), (2, 3, NOW - 50));
    assert_eq!(e.evidence_hash, fx.hash(3));
    assert_eq!(e.published_ledger, SEQ + 50);
    // The other key is untouched.
    assert_eq!(fx.entry(&b).unwrap().evidence_hash, fx.hash(2));
    let listed: StdVec<Address> = fx.client().assets().iter().collect();
    assert_eq!(listed, vec![a, b]);
}

#[test]
fn t6_equal_as_of_needs_a_different_hash() {
    let fx = Fx::new();
    let a = fx.addr();
    fx.publish(&[fx.upd(&a, 1, NOW)]);

    // Same as_of, different hash: a re-evaluation of the same chain read.
    assert_eq!(fx.publish(&[fx.upd(&a, 2, NOW)]), 1);
    assert_eq!(fx.entry(&a).unwrap().evidence_hash, fx.hash(2));

    // Same as_of, same hash.
    fx.assert_publish_fails(
        &[fx.upd(&a, 2, NOW)],
        FeedError::AlreadyPublished,
        core::slice::from_ref(&a),
    );
}

#[test]
fn t15_atomic_batches() {
    let fx = Fx::new();
    let keys: StdVec<Address> = (0..MAX_BATCH).map(|_| fx.addr()).collect();

    // 24 valid + 1 invalid on a fresh feed: nothing is written.
    let mut ups: StdVec<Update> = keys
        .iter()
        .enumerate()
        .map(|(i, k)| fx.upd(k, i as u8 + 1, NOW))
        .collect();
    ups[24].status = 3;
    fx.assert_publish_fails(&ups, FeedError::InvalidStatus, &keys);
    assert_eq!(fx.client().assets().len(), 0);
    for k in &keys {
        assert_eq!(fx.entry(k), None);
    }

    // The same over existing entries: none of the 24 updates lands.
    let seed: StdVec<Update> = keys
        .iter()
        .enumerate()
        .map(|(i, k)| fx.upd(k, i as u8 + 1, NOW - 100))
        .collect();
    fx.publish(&seed);
    let before = fx.state(&keys);
    let mut next: StdVec<Update> = keys
        .iter()
        .enumerate()
        .map(|(i, k)| fx.upd(k, i as u8 + 100, NOW))
        .collect();
    next[24].as_of = NOW - 101; // stale
    fx.assert_publish_fails(&next, FeedError::StaleAsOf, &keys);
    assert_eq!(fx.state(&keys), before);
}

#[test]
fn t16_index_cap() {
    let fx = Fx::new();
    assert_eq!(MAX_ASSETS, 100);
    let keys: StdVec<Address> = (0..MAX_ASSETS).map(|_| fx.addr()).collect();
    for chunk in keys.chunks(25) {
        let ups: StdVec<Update> = chunk.iter().map(|k| fx.upd(k, 1, NOW - 100)).collect();
        assert_eq!(fx.publish(&ups), 25);
    }
    assert_eq!(fx.client().assets().len(), 100);

    // A 101st new key.
    let extra = fx.addr();
    fx.assert_publish_fails(
        &[fx.upd(&extra, 1, NOW)],
        FeedError::TooManyAssets,
        &[extra.clone(), keys[0].clone()],
    );
    // Also when mixed with an update to an existing key: nothing lands.
    fx.assert_publish_fails(
        &[fx.upd(&keys[0], 9, NOW), fx.upd(&extra, 1, NOW)],
        FeedError::TooManyAssets,
        &[extra.clone(), keys[0].clone()],
    );

    // An update to an existing key at the cap succeeds.
    assert_eq!(fx.publish(&[fx.upd(&keys[99], 2, NOW)]), 1);
    assert_eq!(fx.entry(&keys[99]).unwrap().as_of, NOW);
    assert_eq!(fx.client().assets().len(), 100);
}

#[test]
fn t17_get_many() {
    let fx = Fx::new();
    let a = fx.addr();
    let b = fx.addr();
    let unknown = fx.addr();
    fx.publish(&[fx.upd(&a, 1, NOW), fx.upd(&b, 2, NOW)]);
    let ea = fx.entry(&a);
    let eb = fx.entry(&b);

    let ask = |keys: &[&Address]| {
        let mut v = Vec::new(&fx.env);
        for k in keys {
            v.push_back((*k).clone());
        }
        v
    };
    let got = fx.client().get_many(&ask(&[&b, &unknown, &a, &b]));
    let got: StdVec<Option<Entry>> = got.iter().collect();
    assert_eq!(got, vec![eb, None, ea, fx.entry(&b)]);

    assert_eq!(fx.client().get_many(&ask(&[])).len(), 0);

    // 25 is fine, 26 is not.
    let keys25: StdVec<&Address> = (0..25).map(|_| &a).collect();
    assert_eq!(fx.client().get_many(&ask(&keys25)).len(), 25);
    let keys26: StdVec<&Address> = (0..26).map(|_| &a).collect();
    assert_eq!(
        err(fx.client().try_get_many(&ask(&keys26))),
        FeedError::BatchTooLarge
    );
}
