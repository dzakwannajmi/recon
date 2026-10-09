//! The per-update checks of `publish`. The order fixes which error wins; do not
//! reorder. `check_update` looks at the update and the batch only;
//! `check_against_stored` compares it with the entry already on chain.

use soroban_sdk::{BytesN, Vec};

use crate::constants::{CHANGE_FLAGS, KNOWN_FLAGS, MAX_CLOCK_SKEW, STATUS_MAX};
use crate::errors::FeedError;
use crate::types::{Entry, Update};

/// Checks that need no stored state, in the documented order. `i` is the
/// position of `u` in `updates`; `now` is the ledger timestamp.
pub(crate) fn check_update(
    updates: &Vec<Update>,
    i: usize,
    u: &Update,
    now: u64,
    zero: &BytesN<32>,
) -> Result<(), FeedError> {
    if updates
        .iter()
        .take(i)
        .any(|earlier| earlier.asset == u.asset)
    {
        return Err(FeedError::DuplicateAsset);
    }
    if u.status > STATUS_MAX {
        return Err(FeedError::InvalidStatus);
    }
    if u.flags & !KNOWN_FLAGS != 0 {
        return Err(FeedError::UnknownFlagBits);
    }
    if (u.status == 0) != (u.flags == 0) {
        return Err(FeedError::StatusFlagsMismatch);
    }
    if u.flags & CHANGE_FLAGS != 0 && u.issuer_change_seen_at == 0 {
        return Err(FeedError::MissingChangeTime);
    }
    if &u.evidence_hash == zero {
        return Err(FeedError::ZeroEvidenceHash);
    }
    if u.as_of == 0 {
        return Err(FeedError::InvalidAsOf);
    }
    if u.as_of > now.saturating_add(MAX_CLOCK_SKEW) {
        return Err(FeedError::AsOfInFuture);
    }
    if u.issuer_change_seen_at > u.as_of {
        return Err(FeedError::ChangeAfterAsOf);
    }
    Ok(())
}

/// Ordering guards against the entry already stored for the same asset.
pub(crate) fn check_against_stored(u: &Update, e: &Entry) -> Result<(), FeedError> {
    if u.as_of < e.as_of {
        return Err(FeedError::StaleAsOf);
    }
    if u.as_of == e.as_of && u.evidence_hash == e.evidence_hash {
        return Err(FeedError::AlreadyPublished);
    }
    if u.issuer_change_seen_at < e.issuer_change_seen_at {
        return Err(FeedError::ChangeTimeWentBack);
    }
    Ok(())
}
