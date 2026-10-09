use crate::*;
use soroban_sdk::{
    testutils::{
        storage::{Instance as _, Persistent as _},
        Address as _, AuthorizedFunction, AuthorizedInvocation, Events as _, Ledger as _, MockAuth,
        MockAuthInvoke,
    },
    Address, BytesN, ConversionError, Env, Event as _, IntoVal, InvokeError, Symbol, Val, Vec,
};
use std::{format, vec, vec::Vec as StdVec};

pub const NOW: u64 = 1_791_500_000;
pub const SEQ: u32 = 1_000;

pub type Res<T> = Result<Result<T, ConversionError>, Result<FeedError, InvokeError>>;

/// The contract error of a failed `try_*` call. Anything else (an auth failure, a
/// conversion error) fails the test.
pub fn err<T: core::fmt::Debug>(r: Res<T>) -> FeedError {
    match r {
        Err(Ok(e)) => e,
        other => panic!("expected a FeedError, got {other:?}"),
    }
}

/// A failed `try_*` call that is not a `FeedError` (a host auth error).
pub fn assert_auth_error<T: core::fmt::Debug>(r: Res<T>) {
    match r {
        Err(Err(_)) => {}
        other => panic!("expected a host auth error, got {other:?}"),
    }
}

pub struct Fx {
    pub env: Env,
    pub id: Address,
    pub admin: Address,
    pub publisher: Address,
}

impl Fx {
    /// No auth is mocked: every test mocks what it needs.
    pub fn bare() -> Self {
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
    pub fn new() -> Self {
        let fx = Self::bare();
        fx.env.mock_all_auths();
        fx
    }

    pub fn client(&self) -> FeedClient<'_> {
        FeedClient::new(&self.env, &self.id)
    }

    pub fn addr(&self) -> Address {
        Address::generate(&self.env)
    }

    pub fn hash(&self, b: u8) -> BytesN<32> {
        BytesN::from_array(&self.env, &[b; 32])
    }

    /// A valid WARNING update with flag bit 0 raised.
    pub fn upd(&self, asset: &Address, hash_byte: u8, as_of: u64) -> Update {
        Update {
            asset: asset.clone(),
            status: 1,
            flags: 1,
            evidence_hash: self.hash(hash_byte),
            as_of,
            issuer_change_seen_at: 0,
        }
    }

    pub fn batch(&self, ups: &[Update]) -> Vec<Update> {
        let mut v = Vec::new(&self.env);
        for u in ups {
            v.push_back(u.clone());
        }
        v
    }

    pub fn publish(&self, ups: &[Update]) -> u32 {
        self.client().publish(&self.batch(ups))
    }

    pub fn try_publish(&self, ups: &[Update]) -> Res<u32> {
        self.client().try_publish(&self.batch(ups))
    }

    pub fn entry(&self, asset: &Address) -> Option<Entry> {
        self.client().get(asset)
    }

    pub fn entry_ttl(&self, asset: &Address) -> u32 {
        self.env.as_contract(&self.id, || {
            self.env
                .storage()
                .persistent()
                .get_ttl(&DataKey::Entry(asset.clone()))
        })
    }

    pub fn index_ttl(&self) -> u32 {
        self.env.as_contract(&self.id, || {
            self.env.storage().persistent().get_ttl(&DataKey::Assets)
        })
    }

    pub fn instance_ttl(&self) -> u32 {
        self.env
            .as_contract(&self.id, || self.env.storage().instance().get_ttl())
    }

    pub fn advance(&self, ledgers: u32) {
        let seq = self.env.ledger().sequence();
        self.env.ledger().set_sequence_number(seq + ledgers);
    }

    /// Everything a reader can see: the index and the entry of each given key.
    pub fn state(&self, keys: &[Address]) -> (StdVec<Address>, StdVec<Option<Entry>>) {
        let c = self.client();
        (
            c.assets().iter().collect(),
            keys.iter().map(|k| c.get(k)).collect(),
        )
    }

    pub fn mock(&self, who: &Address, fn_name: &'static str, args: Vec<Val>) {
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

    pub fn assert_auth(&self, who: &Address, fn_name: &str, args: Vec<Val>) {
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

    pub fn entry_updated(&self, u: &Update) -> soroban_sdk::xdr::ContractEvent {
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

    pub fn assert_no_events(&self) {
        assert_eq!(self.env.events().all().events().len(), 0, "no events");
    }

    /// A failed publish: the exact error, no events, nothing written.
    pub fn assert_publish_fails(&self, ups: &[Update], want: FeedError, keys: &[Address]) {
        let before = self.state(keys);
        let got = err(self.try_publish(ups));
        // Events (and auths) reset on the next call, so check them first.
        self.assert_no_events();
        assert_eq!(got, want);
        assert_eq!(self.state(keys), before, "state unchanged after {want:?}");
    }
}

pub fn args1<A: IntoVal<Env, Val>>(env: &Env, a: A) -> Vec<Val> {
    let v: Val = a.into_val(env);
    let mut out = Vec::new(env);
    out.push_back(v);
    out
}

pub fn built_wasm() -> StdVec<u8> {
    let path = format!(
        "{}/target/wasm32v1-none/release/feed.wasm",
        env!("CARGO_MANIFEST_DIR")
    );
    std::fs::read(&path).unwrap_or_else(|e| {
        panic!("{path}: {e}. Run `stellar contract build` before `cargo test`.")
    })
}
