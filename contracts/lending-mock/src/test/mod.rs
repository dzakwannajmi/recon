//! Tests of the market contract, one file per area. Shared fixtures live in `setup`.

// Tests clone into one-element slices on purpose; the fixtures take `&[Address]`.
#![allow(clippy::cloned_ref_to_slice_refs)]

mod borrow;
mod config;
mod errors;
mod pinned;
mod resume;
mod setup;
mod stub;
mod sync;
mod ttl;
