use crate::feed;
use crate::*;
use soroban_sdk::{
    testutils::{
        storage::{Instance as _, Persistent as _},
        Address as _, AuthorizedFunction, AuthorizedInvocation, Events as _, Ledger as _, MockAuth,
        MockAuthInvoke,
    },
    Address, BytesN, ConversionError, Env, Event as _, IntoVal, InvokeError, Symbol, Val, Vec,
};
use std::{vec, vec::Vec as StdVec};

pub const NOW: u64 = 1_791_500_000;
pub const SEQ: u32 = 1_000;
pub const EIGHT_DAYS: u64 = 691_200;

pub type Res<T> = Result<Result<T, ConversionError>, Result<MarketError, InvokeError>>;

/// The contract error of a failed `try_*` call. Anything else (an auth failure, a
/// conversion error) fails the test.
pub fn err<T: core::fmt::Debug>(r: Res<T>) -> MarketError {
    match r {
        Err(Ok(e)) => e,
        other => panic!("expected a MarketError, got {other:?}"),
    }
}

/// A failed `try_*` call that is not a `MarketError` (a host auth error).
pub fn assert_auth_error<T: core::fmt::Debug>(r: Res<T>) {
    match r {
        Err(Err(_)) => {}
        other => panic!("expected a host auth error, got {other:?}"),
    }
}

/// Everything a reader can see, for before/after comparisons.
#[derive(Debug, PartialEq)]
pub struct Snapshot {
    pub policy: Policy,
    pub markets: StdVec<Address>,
    pub states: StdVec<Option<MarketState>>,
    pub debts: StdVec<i128>,
}

pub struct Fx {
    pub env: Env,
    /// The market under test.
    pub id: Address,
    /// The feed it reads (the real feed Wasm unless a test brings its own).
    pub feed_id: Address,
    pub admin: Address,
    pub feed_publisher: Address,
}

impl Fx {
    /// No auth is mocked: every test mocks what it needs. Real feed Wasm, the
    /// default policy (pause at CRITICAL, eight days).
    pub fn bare() -> Self {
        Self::with_policy(2, EIGHT_DAYS)
    }

    pub fn with_policy(pause_at: u32, max_age: u64) -> Self {
        let env = Env::default();
        env.ledger().set_timestamp(NOW);
        env.ledger().set_sequence_number(SEQ);
        let feed_admin = Address::generate(&env);
        let feed_publisher = Address::generate(&env);
        let feed_id = env.register(feed::WASM, (feed_admin, feed_publisher.clone()));
        Self::on_feed(env, feed_id, feed_publisher, pause_at, max_age)
    }

    /// A market that reads `feed_id`, which the caller registered in `env`.
    pub fn on_feed(
        env: Env,
        feed_id: Address,
        feed_publisher: Address,
        pause_at: u32,
        max_age: u64,
    ) -> Self {
        let admin = Address::generate(&env);
        let id = env.register(
            LendingMock,
            (admin.clone(), feed_id.clone(), pause_at, max_age),
        );
        Fx {
            env,
            id,
            feed_id,
            admin,
            feed_publisher,
        }
    }

    pub fn client(&self) -> LendingMockClient<'_> {
        LendingMockClient::new(&self.env, &self.id)
    }

    pub fn feed_client(&self) -> feed::Client<'_> {
        feed::Client::new(&self.env, &self.feed_id)
    }

    pub fn addr(&self) -> Address {
        Address::generate(&self.env)
    }

    pub fn hash(&self, b: u8) -> BytesN<32> {
        BytesN::from_array(&self.env, &[b; 32])
    }

    /// Publishes one entry to the real feed with the publisher's exact auth.
    /// `status` 0 needs `flags` 0; any other status needs a non-zero `flags`.
    pub fn publish(&self, asset: &Address, status: u32, as_of: u64, hash_byte: u8) {
        let flags = if status == 0 { 0 } else { 1 };
        let ups = soroban_sdk::vec![
            &self.env,
            feed::Update {
                asset: asset.clone(),
                status,
                flags,
                evidence_hash: self.hash(hash_byte),
                as_of,
                issuer_change_seen_at: 0,
            }
        ];
        self.env.mock_auths(&[MockAuth {
            address: &self.feed_publisher,
            invoke: &MockAuthInvoke {
                contract: &self.feed_id,
                fn_name: "publish",
                args: args1(&self.env, ups.clone()),
                sub_invokes: &[],
            },
        }]);
        self.feed_client().publish(&ups);
    }

    /// A market on a stub feed (see `stub`), starting in `mode`.
    pub fn with_stub(mode: u32) -> Self {
        let env = Env::default();
        env.ledger().set_timestamp(NOW);
        env.ledger().set_sequence_number(SEQ);
        let feed_id = env.register(super::stub::StubFeed, (mode,));
        let publisher = Address::generate(&env);
        Self::on_feed(env, feed_id, publisher, 2, EIGHT_DAYS)
    }

    pub fn stub_mode(&self, mode: u32) {
        super::stub::StubFeedClient::new(&self.env, &self.feed_id).set_mode(&mode);
    }

    /// Lists `asset` and writes it as open without going through
    /// `resume_borrows`, for feeds that could never pass the CLEAR check.
    pub fn force_open(&self, asset: &Address) {
        self.list(asset);
        self.env.as_contract(&self.id, || {
            self.env.storage().persistent().set(
                &DataKey::Market(asset.clone()),
                &MarketState {
                    borrow_enabled: true,
                    reason: REASON_CLEAR,
                    changed_ledger: SEQ,
                    total_borrowed: 0,
                },
            );
        });
    }

    /// A market that reads `feed_id` (any contract the caller registered).
    pub fn with_feed_contract(env: Env, feed_id: Address) -> Self {
        env.ledger().set_timestamp(NOW);
        env.ledger().set_sequence_number(SEQ);
        let publisher = Address::generate(&env);
        Self::on_feed(env, feed_id, publisher, 2, EIGHT_DAYS)
    }

    /// An OK entry in the real feed, then the market listed and resumed.
    pub fn open_market(&self, asset: &Address) {
        self.publish(asset, 0, NOW - 100, 1);
        self.list_open(asset);
    }

    /// Lists `asset` with the admin's exact auth.
    pub fn list(&self, asset: &Address) {
        self.mock(&self.admin, "add_market", args1(&self.env, asset.clone()));
        self.client().add_market(asset);
    }

    /// Lists `asset` and resumes it (needs a CLEAR entry in the feed).
    pub fn list_open(&self, asset: &Address) {
        self.list(asset);
        self.mock(
            &self.admin,
            "resume_borrows",
            args1(&self.env, asset.clone()),
        );
        self.client().resume_borrows(asset);
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

    pub fn advance_time(&self, secs: u64) {
        let t = self.env.ledger().timestamp();
        self.env.ledger().set_timestamp(t + secs);
    }

    pub fn advance(&self, ledgers: u32) {
        let seq = self.env.ledger().sequence();
        self.env.ledger().set_sequence_number(seq + ledgers);
    }

    pub fn assert_no_events(&self) {
        assert_eq!(self.env.events().all().events().len(), 0, "no events");
    }

    pub fn snapshot(&self, assets: &[Address], borrowers: &[Address]) -> Snapshot {
        let c = self.client();
        let mut debts = StdVec::new();
        for b in borrowers {
            for a in assets {
                debts.push(c.debt(b, a));
            }
        }
        Snapshot {
            policy: c.policy(),
            markets: c.markets().iter().collect(),
            states: assets.iter().map(|a| c.market(a)).collect(),
            debts,
        }
    }

    pub fn state(&self, asset: &Address) -> MarketState {
        self.client().market(asset).expect("listed")
    }

    pub fn market_ttl(&self, asset: &Address) -> u32 {
        self.env.as_contract(&self.id, || {
            self.env
                .storage()
                .persistent()
                .get_ttl(&DataKey::Market(asset.clone()))
        })
    }

    pub fn markets_ttl(&self) -> u32 {
        self.env.as_contract(&self.id, || {
            self.env.storage().persistent().get_ttl(&DataKey::Markets)
        })
    }

    pub fn debt_ttl(&self, borrower: &Address, asset: &Address) -> u32 {
        self.env.as_contract(&self.id, || {
            self.env
                .storage()
                .persistent()
                .get_ttl(&DataKey::Debt(borrower.clone(), asset.clone()))
        })
    }

    pub fn instance_ttl(&self) -> u32 {
        self.env
            .as_contract(&self.id, || self.env.storage().instance().get_ttl())
    }

    pub fn paused_event(
        &self,
        asset: &Address,
        reason: u32,
        d: &Decision,
    ) -> soroban_sdk::xdr::ContractEvent {
        BorrowsPaused {
            asset: asset.clone(),
            reason,
            status: d.status,
            flags: d.flags,
            as_of: d.as_of,
            evidence_hash: d.evidence_hash.clone(),
            published_ledger: d.published_ledger,
        }
        .to_xdr(&self.env, &self.id)
    }

    pub fn resumed_event(&self, asset: &Address, d: &Decision) -> soroban_sdk::xdr::ContractEvent {
        BorrowsResumed {
            asset: asset.clone(),
            status: d.status,
            as_of: d.as_of,
            evidence_hash: d.evidence_hash.clone(),
            published_ledger: d.published_ledger,
        }
        .to_xdr(&self.env, &self.id)
    }

    /// A failed `try_*` call returned `want`: no events and nothing changed.
    /// Call it with the snapshot taken before the failing call.
    pub fn assert_unchanged(&self, before: &Snapshot, assets: &[Address], borrowers: &[Address]) {
        // Events reset on the next call, so check them first.
        self.assert_no_events();
        assert_eq!(&self.snapshot(assets, borrowers), before, "state unchanged");
    }
}

pub fn args1<A: IntoVal<Env, Val>>(env: &Env, a: A) -> Vec<Val> {
    let v: Val = a.into_val(env);
    let mut out = Vec::new(env);
    out.push_back(v);
    out
}

pub fn args2<A: IntoVal<Env, Val>, B: IntoVal<Env, Val>>(env: &Env, a: A, b: B) -> Vec<Val> {
    let mut out = args1(env, a);
    out.push_back(b.into_val(env));
    out
}

pub fn args3<A: IntoVal<Env, Val>, B: IntoVal<Env, Val>, C: IntoVal<Env, Val>>(
    env: &Env,
    a: A,
    b: B,
    c: C,
) -> Vec<Val> {
    let mut out = args2(env, a, b);
    out.push_back(c.into_val(env));
    out
}
