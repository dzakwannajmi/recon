use super::setup::*;
use crate::*;
use soroban_sdk::{
    testutils::{storage::Instance as _, Address as _, Events as _, Ledger as _},
    Address, Env, Event as _, Vec,
};
use std::vec;

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
