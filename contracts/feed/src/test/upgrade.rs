use super::setup::*;
use crate::*;
use soroban_sdk::{testutils::Events as _, Event as _, Executable};
use std::vec;

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
