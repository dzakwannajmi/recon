use super::setup::*;
use crate::*;
use soroban_sdk::{
    testutils::Events as _,
    xdr::{ContractEventBody, ScSymbol, ScVal},
    Address, TryFromVal,
};
use std::{vec, vec::Vec as StdVec};

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
    let all = fx.env.events().all();
    assert_eq!(all, want);

    // Not circular: the raw topics are what RPC `getEvents` filters on
    // (`["entry_updated", "*", u32]`), so a rename of the struct must fail here.
    for (event, u) in all.events().iter().zip(&ups) {
        let ContractEventBody::V0(body) = &event.body;
        let want_topics: StdVec<ScVal> = vec![
            ScVal::Symbol(ScSymbol("entry_updated".try_into().unwrap())),
            ScVal::try_from_val(&fx.env, &u.asset.to_val()).unwrap(),
            ScVal::U32(u.status),
        ];
        assert_eq!(body.topics.to_vec(), want_topics);
    }
}
