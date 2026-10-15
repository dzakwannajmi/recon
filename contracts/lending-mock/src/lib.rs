#![no_std]

//! Mock lending market that reads the verified-facts feed on chain.
//!
//! An example consumer. The feed publishes status codes; the pause threshold,
//! the freshness limit, and the resume rule are this market's own policy, not
//! a judgment about any asset. `sync` is open to anyone and can only pause;
//! only the admin resumes, and only while the check is CLEAR. The contract is
//! immutable: no upgrade, no admin rotation. No token ever moves.
//!
//! Layout: `types`, `errors`, and `events` are the public ABI; `storage` holds
//! the typed storage and TTL helpers; `policy` holds the pause decision;
//! `contract` holds the entry points.

mod contract;
mod errors;
mod events;
mod policy;
mod storage;
mod types;

/// The deployed feed, imported from the vendored Wasm (sha256 pinned in tests).
mod feed {
    soroban_sdk::contractimport!(file = "vendor/feed.wasm");
}

pub use contract::{LendingMock, LendingMockClient};
pub use errors::MarketError;
pub use events::{
    BorrowOpened, BorrowsPaused, BorrowsResumed, Initialized, MarketListed, PolicySet,
};
pub use types::*;

// The crate is `no_std`; the tests use `std` for files, vectors, and hashing.
#[cfg(test)]
extern crate std;

#[cfg(test)]
mod test;
