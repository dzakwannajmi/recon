use super::setup::*;
use crate::*;
use soroban_sdk::{
    testutils::{Address as _, Events as _, Ledger as _},
    xdr::{Limits, ScVal, WriteXdr},
    Address, BytesN, Env, IntoVal, TryFromVal, Val, Vec,
};
use std::vec::Vec as StdVec;

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
