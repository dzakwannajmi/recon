#![cfg(test)]
// The crate is `no_std`; the tests use `std` for files, vectors, and XDR output.
extern crate std;

use super::*;
use soroban_sdk::{
    testutils::{
        storage::{Instance as _, Persistent as _},
        Address as _, AuthorizedFunction, AuthorizedInvocation, Events as _, Ledger as _, MockAuth,
        MockAuthInvoke,
    },
    vec as svec,
    xdr::{Limits, ScVal, WriteXdr},
    ConversionError, Event as _, Executable, IntoVal, InvokeError, Symbol, TryFromVal, Val,
};
use std::{format, vec, vec::Vec as StdVec};

const NOW: u64 = 1_791_500_000;
const SEQ: u32 = 1_000;

type Res<T> = Result<Result<T, ConversionError>, Result<FeedError, InvokeError>>;

/// The contract error of a failed `try_*` call. Anything else (an auth failure, a
/// conversion error) fails the test.
fn err<T: core::fmt::Debug>(r: Res<T>) -> FeedError {
    match r {
        Err(Ok(e)) => e,
        other => panic!("expected a FeedError, got {other:?}"),
    }
}

/// A failed `try_*` call that is not a `FeedError` (a host auth error).
fn assert_auth_error<T: core::fmt::Debug>(r: Res<T>) {
    match r {
        Err(Err(_)) => {}
        other => panic!("expected a host auth error, got {other:?}"),
    }
}

struct Fx {
    env: Env,
    id: Address,
    admin: Address,
    publisher: Address,
}

impl Fx {
    /// No auth is mocked: every test mocks what it needs.
    fn bare() -> Self {
        let env = Env::default();
        env.ledger().set_timestamp(NOW);
        env.ledger().set_sequence_number(SEQ);
        let admin = Address::generate(&env);
        let publisher = Address::generate(&env);
        let id = env.register(Feed, (admin.clone(), publisher.clone()));
        Fx {
            env,
            id,
            admin,
            publisher,
        }
    }

    /// All auths approved. Use only when a test is not about auth.
    fn new() -> Self {
        let fx = Self::bare();
        fx.env.mock_all_auths();
        fx
    }

    fn client(&self) -> FeedClient<'_> {
        FeedClient::new(&self.env, &self.id)
    }

    fn addr(&self) -> Address {
        Address::generate(&self.env)
    }

    fn hash(&self, b: u8) -> BytesN<32> {
        BytesN::from_array(&self.env, &[b; 32])
    }

    /// A valid WARNING update with flag bit 0 raised.
    fn upd(&self, asset: &Address, hash_byte: u8, as_of: u64) -> Update {
        Update {
            asset: asset.clone(),
            status: 1,
            flags: 1,
            evidence_hash: self.hash(hash_byte),
            as_of,
            issuer_change_seen_at: 0,
        }
    }

    fn batch(&self, ups: &[Update]) -> Vec<Update> {
        let mut v = Vec::new(&self.env);
        for u in ups {
            v.push_back(u.clone());
        }
        v
    }

    fn publish(&self, ups: &[Update]) -> u32 {
        self.client().publish(&self.batch(ups))
    }

    fn try_publish(&self, ups: &[Update]) -> Res<u32> {
        self.client().try_publish(&self.batch(ups))
    }

    fn entry(&self, asset: &Address) -> Option<Entry> {
        self.client().get(asset)
    }

    fn entry_ttl(&self, asset: &Address) -> u32 {
        self.env.as_contract(&self.id, || {
            self.env
                .storage()
                .persistent()
                .get_ttl(&DataKey::Entry(asset.clone()))
        })
    }

    fn index_ttl(&self) -> u32 {
        self.env.as_contract(&self.id, || {
            self.env.storage().persistent().get_ttl(&DataKey::Assets)
        })
    }

    fn instance_ttl(&self) -> u32 {
        self.env
            .as_contract(&self.id, || self.env.storage().instance().get_ttl())
    }

    fn advance(&self, ledgers: u32) {
        let seq = self.env.ledger().sequence();
        self.env.ledger().set_sequence_number(seq + ledgers);
    }

    /// Everything a reader can see: the index and the entry of each given key.
    fn state(&self, keys: &[Address]) -> (StdVec<Address>, StdVec<Option<Entry>>) {
        let c = self.client();
        (
            c.assets().iter().collect(),
            keys.iter().map(|k| c.get(k)).collect(),
        )
    }

    fn mock(&self, who: &Address, fn_name: &'static str, args: Vec<Val>) {
        self.env.mock_auths(&[MockAuth {
            address: who,
            invoke: &MockAuthInvoke {
                contract: &self.id,
                fn_name,
                args,
                sub_invokes: &[],
            },
        }]);
    }

    fn assert_auth(&self, who: &Address, fn_name: &str, args: Vec<Val>) {
        assert_eq!(
            self.env.auths(),
            vec![(
                who.clone(),
                AuthorizedInvocation {
                    function: AuthorizedFunction::Contract((
                        self.id.clone(),
                        Symbol::new(&self.env, fn_name),
                        args
                    )),
                    sub_invocations: vec![],
                }
            )]
        );
    }

    fn entry_updated(&self, u: &Update) -> soroban_sdk::xdr::ContractEvent {
        EntryUpdated {
            asset: u.asset.clone(),
            status: u.status,
            flags: u.flags,
            evidence_hash: u.evidence_hash.clone(),
            as_of: u.as_of,
            issuer_change_seen_at: u.issuer_change_seen_at,
        }
        .to_xdr(&self.env, &self.id)
    }

    fn assert_no_events(&self) {
        assert_eq!(self.env.events().all().events().len(), 0, "no events");
    }

    /// A failed publish: the exact error, no events, nothing written.
    fn assert_publish_fails(&self, ups: &[Update], want: FeedError, keys: &[Address]) {
        let before = self.state(keys);
        let got = err(self.try_publish(ups));
        // Events (and auths) reset on the next call, so check them first.
        self.assert_no_events();
        assert_eq!(got, want);
        assert_eq!(self.state(keys), before, "state unchanged after {want:?}");
    }
}

fn args1<A: IntoVal<Env, Val>>(env: &Env, a: A) -> Vec<Val> {
    let v: Val = a.into_val(env);
    let mut out = Vec::new(env);
    out.push_back(v);
    out
}

// ---------------------------------------------------------------- Roles

#[test]
fn t1_constructor_stores_roles() {
    let env = Env::default();
    env.ledger().set_timestamp(NOW);
    env.ledger().set_sequence_number(SEQ);
    let admin = Address::generate(&env);
    let publisher = Address::generate(&env);
    let id = env.register(Feed, (admin.clone(), publisher.clone()));

    // The constructor ran in the last invocation.
    let expected = Initialized {
        admin: admin.clone(),
        publisher: publisher.clone(),
    }
    .to_xdr(&env, &id);
    assert_eq!(env.events().all(), vec![expected]);

    let c = FeedClient::new(&env, &id);
    assert_eq!(c.admin(), admin);
    assert_eq!(c.publisher(), publisher);
    assert_eq!(c.schema(), 1);
    assert_eq!(c.pending_admin(), None);
    assert_eq!(c.assets().len(), 0);
    let ttl = env.as_contract(&id, || env.storage().instance().get_ttl());
    assert_eq!(ttl, TTL_EXTEND_TO);
}

#[test]
fn t1_admin_may_equal_publisher() {
    let env = Env::default();
    let who = Address::generate(&env);
    let id = env.register(Feed, (who.clone(), who.clone()));
    let c = FeedClient::new(&env, &id);
    assert_eq!(c.admin(), who);
    assert_eq!(c.publisher(), who);
}

#[test]
fn t2_publish_requires_exactly_the_publisher_auth() {
    let fx = Fx::bare();
    let a = fx.addr();
    let ups = fx.batch(&[fx.upd(&a, 1, NOW)]);
    fx.mock(&fx.publisher, "publish", args1(&fx.env, ups.clone()));
    assert_eq!(fx.client().publish(&ups), 1);
    fx.assert_auth(&fx.publisher, "publish", args1(&fx.env, ups));
}

// ---------------------------------------------------------- Publish and read

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
fn t7_entry_updated_events_in_order() {
    let fx = Fx::new();
    let keys: StdVec<Address> = (0..3).map(|_| fx.addr()).collect();
    let ups = vec![
        fx.upd(&keys[0], 1, NOW),
        Update {
            status: 2,
            flags: 24 | 1,
            issuer_change_seen_at: NOW - 5,
            ..fx.upd(&keys[1], 2, NOW - 1)
        },
        Update {
            status: 0,
            flags: 0,
            ..fx.upd(&keys[2], 3, NOW - 2)
        },
    ];
    fx.publish(&ups);
    let want: StdVec<_> = ups.iter().map(|u| fx.entry_updated(u)).collect();
    assert_eq!(fx.env.events().all(), want);
}

// ------------------------------------------------------------------- Auth

#[test]
fn t8_publish_without_the_publisher_auth_fails() {
    let fx = Fx::bare();
    let a = fx.addr();
    let ups = fx.batch(&[fx.upd(&a, 1, NOW)]);
    let random = fx.addr();

    // No auth at all.
    assert_auth_error(fx.client().try_publish(&ups));
    assert_eq!(fx.env.events().all().events().len(), 0);
    assert_eq!(fx.entry(&a), None);

    // The admin's auth.
    fx.mock(&fx.admin, "publish", args1(&fx.env, ups.clone()));
    assert_auth_error(fx.client().try_publish(&ups));
    assert_eq!(fx.env.events().all().events().len(), 0);
    assert_eq!(fx.entry(&a), None);

    // A random address's auth.
    fx.mock(&random, "publish", args1(&fx.env, ups.clone()));
    assert_auth_error(fx.client().try_publish(&ups));
    assert_eq!(fx.env.events().all().events().len(), 0);
    assert_eq!(fx.entry(&a), None);

    // Auth comes first: an invalid batch also fails as an auth error, not EmptyBatch.
    let empty = fx.batch(&[]);
    assert_auth_error(fx.client().try_publish(&empty));
    assert_eq!(fx.client().assets().len(), 0);
}

#[test]
fn t9_set_publisher_is_admin_only() {
    let fx = Fx::bare();
    let new_pub = fx.addr();
    let random = fx.addr();

    // The publisher and a random address fail.
    for who in [fx.publisher.clone(), random] {
        fx.mock(&who, "set_publisher", args1(&fx.env, new_pub.clone()));
        assert_auth_error(fx.client().try_set_publisher(&new_pub));
        assert_eq!(fx.env.events().all().events().len(), 0);
        assert_eq!(fx.client().publisher(), fx.publisher);
    }

    // The admin succeeds.
    let old_pub = fx.publisher.clone();
    fx.mock(&fx.admin, "set_publisher", args1(&fx.env, new_pub.clone()));
    fx.client().set_publisher(&new_pub);
    fx.assert_auth(&fx.admin, "set_publisher", args1(&fx.env, new_pub.clone()));
    // The assertion above read env.auths(); the events were not reset by it.
    assert_eq!(
        fx.env.events().all(),
        vec![PublisherChanged {
            publisher: new_pub.clone(),
            previous: old_pub.clone(),
        }
        .to_xdr(&fx.env, &fx.id)]
    );
    assert_eq!(fx.client().publisher(), new_pub);
    assert_eq!(fx.client().admin(), fx.admin);

    // The old publisher can no longer write; the new one can.
    let a = fx.addr();
    let ups = fx.batch(&[fx.upd(&a, 1, NOW)]);
    fx.mock(&old_pub, "publish", args1(&fx.env, ups.clone()));
    assert_auth_error(fx.client().try_publish(&ups));
    assert_eq!(fx.entry(&a), None);
    fx.mock(&new_pub, "publish", args1(&fx.env, ups.clone()));
    assert_eq!(fx.client().publish(&ups), 1);
    assert!(fx.entry(&a).is_some());
}

#[test]
fn t10_admin_rotation_is_two_step() {
    let fx = Fx::bare();
    let new_admin = fx.addr();
    let random = fx.addr();

    // propose_admin by a non-admin fails.
    fx.mock(&random, "propose_admin", args1(&fx.env, new_admin.clone()));
    assert_auth_error(fx.client().try_propose_admin(&new_admin));
    assert_eq!(fx.env.events().all().events().len(), 0);
    assert_eq!(fx.client().pending_admin(), None);

    // accept_admin with nothing pending.
    assert_eq!(
        err(fx.client().try_accept_admin()),
        FeedError::NoPendingAdmin
    );
    assert_eq!(fx.env.events().all().events().len(), 0);

    // The admin proposes.
    fx.mock(
        &fx.admin,
        "propose_admin",
        args1(&fx.env, new_admin.clone()),
    );
    fx.client().propose_admin(&new_admin);
    fx.assert_auth(
        &fx.admin,
        "propose_admin",
        args1(&fx.env, new_admin.clone()),
    );
    assert_eq!(
        fx.env.events().all(),
        vec![AdminProposed {
            proposed: new_admin.clone(),
            admin: fx.admin.clone(),
        }
        .to_xdr(&fx.env, &fx.id)]
    );
    assert_eq!(fx.client().pending_admin(), Some(new_admin.clone()));
    assert_eq!(fx.client().admin(), fx.admin);

    // accept_admin by an address other than the pending one fails (also the old admin).
    for who in [random.clone(), fx.admin.clone()] {
        fx.mock(&who, "accept_admin", Vec::new(&fx.env));
        assert_auth_error(fx.client().try_accept_admin());
        assert_eq!(fx.env.events().all().events().len(), 0);
        assert_eq!(fx.client().admin(), fx.admin);
        assert_eq!(fx.client().pending_admin(), Some(new_admin.clone()));
    }

    // The pending admin accepts.
    fx.mock(&new_admin, "accept_admin", Vec::new(&fx.env));
    fx.client().accept_admin();
    fx.assert_auth(&new_admin, "accept_admin", Vec::new(&fx.env));
    assert_eq!(
        fx.env.events().all(),
        vec![AdminChanged {
            admin: new_admin.clone(),
            previous: fx.admin.clone(),
        }
        .to_xdr(&fx.env, &fx.id)]
    );
    assert_eq!(fx.client().admin(), new_admin);
    assert_eq!(fx.client().pending_admin(), None);

    // The old admin can't set the publisher; the new admin can.
    let p2 = fx.addr();
    fx.mock(&fx.admin, "set_publisher", args1(&fx.env, p2.clone()));
    assert_auth_error(fx.client().try_set_publisher(&p2));
    assert_eq!(fx.client().publisher(), fx.publisher);
    fx.mock(&new_admin, "set_publisher", args1(&fx.env, p2.clone()));
    fx.client().set_publisher(&p2);
    assert_eq!(fx.client().publisher(), p2);

    // And nothing is pending any more.
    assert_eq!(
        err(fx.client().try_accept_admin()),
        FeedError::NoPendingAdmin
    );
}

#[test]
fn t10_a_new_proposal_overwrites_the_old_one() {
    let fx = Fx::new();
    let first = fx.addr();
    let second = fx.addr();
    fx.client().propose_admin(&first);
    fx.client().propose_admin(&second);
    assert_eq!(fx.client().pending_admin(), Some(second.clone()));
    fx.mock(&first, "accept_admin", Vec::new(&fx.env));
    assert_auth_error(fx.client().try_accept_admin());
    assert_eq!(fx.client().admin(), fx.admin);
}

#[test]
fn t11_upgrade_is_admin_only() {
    let fx = Fx::bare();
    // A real uploaded Wasm, so that only the missing admin auth can stop the call.
    let wasm = built_wasm();
    let hash = fx.env.deployer().upload_contract_wasm(wasm.as_slice());
    let before = fx.id.executable();
    let random = fx.addr();

    assert_auth_error(fx.client().try_upgrade(&hash));
    assert_eq!(fx.env.events().all().events().len(), 0);
    for who in [fx.publisher.clone(), random] {
        fx.mock(&who, "upgrade", args1(&fx.env, hash.clone()));
        assert_auth_error(fx.client().try_upgrade(&hash));
        assert_eq!(fx.env.events().all().events().len(), 0);
    }
    assert_eq!(fx.id.executable(), before, "executable unchanged");
}

fn built_wasm() -> StdVec<u8> {
    let path = format!(
        "{}/target/wasm32v1-none/release/feed.wasm",
        env!("CARGO_MANIFEST_DIR")
    );
    std::fs::read(&path).unwrap_or_else(|e| {
        panic!("{path}: {e}. Run `stellar contract build` before `cargo test`.")
    })
}

#[test]
fn t12_upgrade_to_the_built_wasm_keeps_storage() {
    let fx = Fx::new();
    let a = fx.addr();
    let b = fx.addr();
    fx.publish(&[fx.upd(&a, 1, NOW), fx.upd(&b, 2, NOW)]);
    let before = fx.state(&[a.clone(), b.clone()]);

    let wasm = built_wasm();
    let hash = fx.env.deployer().upload_contract_wasm(wasm.as_slice());
    fx.mock(&fx.admin, "upgrade", args1(&fx.env, hash.clone()));
    fx.client().upgrade(&hash);
    fx.assert_auth(&fx.admin, "upgrade", args1(&fx.env, hash.clone()));
    assert_eq!(
        fx.env.events().all(),
        vec![Upgraded {
            wasm_hash: hash.clone()
        }
        .to_xdr(&fx.env, &fx.id)]
    );
    assert_eq!(fx.id.executable(), Some(Executable::Wasm(hash)));

    // T23: storage survives; the Wasm code now answers.
    assert_eq!(fx.state(&[a.clone(), b.clone()]), before);
    assert_eq!(fx.client().admin(), fx.admin);
    assert_eq!(fx.client().publisher(), fx.publisher);
    assert_eq!(fx.client().schema(), 1);
    let c = fx.addr();
    let ups = fx.batch(&[fx.upd(&c, 3, NOW)]);
    fx.mock(&fx.publisher, "publish", args1(&fx.env, ups.clone()));
    assert_eq!(fx.client().publish(&ups), 1);
    assert_eq!(fx.client().assets().len(), 3);
}

// ------------------------------------------------------------- Validation

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

// -------------------------------------------------------------------- TTL

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

// ---------------------------------------------------------------- Other

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

// ---------------------------------------------------------------- Resources

fn xdr_len<T: IntoVal<Env, Val>>(env: &Env, v: T) -> usize {
    let val: Val = v.into_val(env);
    ScVal::try_from_val(env, &val)
        .unwrap()
        .to_xdr(Limits::none())
        .unwrap()
        .len()
}

#[test]
fn t24_resources_of_a_full_batch() {
    // Native contract first, then the built Wasm (real CPU numbers).
    let wasm = built_wasm();
    for use_wasm in [false, true] {
        let env = Env::default();
        env.mock_all_auths();
        env.ledger().set_timestamp(NOW);
        env.ledger().set_sequence_number(SEQ);
        let admin = Address::generate(&env);
        let publisher = Address::generate(&env);
        let id = if use_wasm {
            env.register(wasm.as_slice(), (admin, publisher))
        } else {
            env.register(Feed, (admin, publisher))
        };
        let c = FeedClient::new(&env, &id);

        let keys: StdVec<Address> = (0..MAX_BATCH).map(|_| Address::generate(&env)).collect();
        let mut ups = Vec::new(&env);
        for (i, k) in keys.iter().enumerate() {
            ups.push_back(Update {
                asset: k.clone(),
                status: 1,
                flags: 24,
                evidence_hash: BytesN::from_array(&env, &[i as u8 + 1; 32]),
                as_of: NOW,
                issuer_change_seen_at: NOW - 10,
            });
        }
        let written = c.publish(&ups);
        assert_eq!(written, 25);
        let r = env.cost_estimate().resources();
        let ret = xdr_len(&env, written);
        std::println!(
            "T24 publish(25) wasm={use_wasm}: instructions={} mem_bytes={} write_entries={} \
             write_bytes={} read_entries(disk={}, mem={}) events_bytes={} return_bytes={}",
            r.instructions,
            r.mem_bytes,
            r.write_entries,
            r.write_bytes,
            r.disk_read_entries,
            r.memory_read_entries,
            r.contract_events_size_bytes,
            ret
        );
        assert!(r.write_entries <= 30, "written entries");
        assert!(r.contract_events_size_bytes as usize + ret <= 8 * 1024);
        assert_eq!(env.events().all().events().len(), 25);

        let mut ask = Vec::new(&env);
        for k in &keys {
            ask.push_back(k.clone());
        }
        let out = c.get_many(&ask);
        let r = env.cost_estimate().resources();
        let ret = xdr_len(&env, out);
        std::println!(
            "T24 get_many(25) wasm={use_wasm}: instructions={} mem_bytes={} write_entries={} \
             events_bytes={} return_bytes={}",
            r.instructions,
            r.mem_bytes,
            r.write_entries,
            r.contract_events_size_bytes,
            ret
        );
        assert_eq!(r.write_entries, 0);
        assert!(r.contract_events_size_bytes as usize + ret <= 8 * 1024);
    }
}

#[test]
fn t24_the_index_at_the_cap_is_a_small_return_value() {
    let fx = Fx::new();
    let keys: StdVec<Address> = (0..MAX_ASSETS).map(|_| fx.addr()).collect();
    for chunk in keys.chunks(25) {
        let ups: StdVec<Update> = chunk.iter().map(|k| fx.upd(k, 1, NOW)).collect();
        fx.publish(&ups);
    }
    let n = xdr_len(&fx.env, fx.client().assets());
    std::println!("T24 assets() with 100 keys: return_bytes={n}");
    assert!(n < 8 * 1024);
}
