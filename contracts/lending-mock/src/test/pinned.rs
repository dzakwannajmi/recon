//! L13: the vendored feed Wasm is the deployed one. Also pins the public ABI
//! numbers, so a renumbering fails here.

use super::setup::*;
use crate::feed;
use crate::*;
use soroban_sdk::{Bytes, Env};
use std::{format, vec::Vec as StdVec};

/// The Wasm hash recorded for the deployed feed.
const DEPLOYED: &str = "92b5af7e84779dad06fa9c31f9ab7edebede3ea8d257a62a1f190637f6923d72";

fn hex(bytes: &[u8]) -> std::string::String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

#[test]
fn l13_vendored_feed_wasm_is_the_deployed_wasm() {
    let env = Env::default();
    let path = format!("{}/vendor/feed.wasm", env!("CARGO_MANIFEST_DIR"));
    let on_disk: StdVec<u8> = std::fs::read(&path).expect("vendor/feed.wasm");
    let h = env
        .crypto()
        .sha256(&Bytes::from_slice(&env, &on_disk))
        .to_array();
    assert_eq!(hex(&h), DEPLOYED);
    // The bytes compiled into the contract are the same file.
    assert_eq!(feed::WASM, on_disk.as_slice());
}

#[test]
fn error_codes_and_reason_codes_are_fixed() {
    let codes = [
        (MarketError::NotInitialized, 1),
        (MarketError::InvalidPolicy, 10),
        (MarketError::AlreadyListed, 11),
        (MarketError::TooManyMarkets, 12),
        (MarketError::NotListed, 13),
        (MarketError::BorrowsPaused, 20),
        (MarketError::InvalidAmount, 21),
        (MarketError::Overflow, 22),
        (MarketError::PolicyBlocks, 30),
    ];
    for (e, n) in codes {
        assert_eq!(e as u32, n);
    }
    assert_eq!(
        [
            REASON_CLEAR,
            REASON_NOT_COVERED,
            REASON_FEED_UNAVAILABLE,
            REASON_UNKNOWN_SCHEMA,
            REASON_STALE,
            REASON_STATUS,
            REASON_LISTED,
            REASON_MANUAL
        ],
        [0, 1, 2, 3, 4, 5, 10, 11]
    );
    assert_eq!(
        (FEED_SCHEMA, MAX_MARKETS, MIN_MAX_AGE, MAX_MAX_AGE),
        (1, 10, 60, 2_592_000)
    );
    assert_eq!((TTL_THRESHOLD, TTL_EXTEND_TO), (60 * 17_280, 120 * 17_280));
}

#[test]
fn the_feed_schema_this_market_reads_is_the_feeds_schema() {
    let fx = Fx::bare();
    assert_eq!(fx.feed_client().schema(), FEED_SCHEMA);
}
