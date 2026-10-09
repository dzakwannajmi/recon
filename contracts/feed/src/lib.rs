#![no_std]

//! Feed of verified facts and flags for tokenized real-world assets.
//!
//! The contract stores and guards; it never decides. Status, flags, and hold
//! windows are computed off chain by deterministic code and arrive here as
//! plain numbers and hashes. No free text is stored.
//!
//! Layout: `constants`, `types`, `errors`, and `events` are the public ABI;
//! `storage` holds the typed storage and TTL helpers; `validate` holds the
//! per-update checks of `publish` in their fixed order; `contract` holds the
//! entry points.

mod constants;
mod contract;
mod errors;
mod events;
mod storage;
mod types;
mod validate;

pub use constants::*;
pub use contract::{Feed, FeedClient};
pub use errors::FeedError;
pub use events::{
    AdminChanged, AdminProposed, EntryUpdated, Initialized, PublisherChanged, Upgraded,
};
pub use types::{DataKey, Entry, Update};

// The crate is `no_std`; the tests use `std` for files, vectors, and XDR output.
#[cfg(test)]
extern crate std;

#[cfg(test)]
mod test;
