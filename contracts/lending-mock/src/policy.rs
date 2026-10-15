//! The market's pause policy. One feed read, then plain comparisons. No branch
//! can fail: every problem with the feed becomes a reason code, so the caller
//! pauses instead of trapping.

use soroban_sdk::{Address, BytesN, Env};

use crate::feed;
use crate::types::{
    Decision, Policy, FEED_SCHEMA, MAX_CLOCK_SKEW, REASON_CLEAR, REASON_FEED_UNAVAILABLE,
    REASON_NOT_COVERED, REASON_STALE, REASON_STATUS, REASON_UNKNOWN_SCHEMA, STATUS_MAX,
};

pub(crate) fn empty(env: &Env, reason: u32) -> Decision {
    Decision {
        reason,
        status: 0,
        flags: 0,
        as_of: 0,
        evidence_hash: BytesN::from_array(env, &[0u8; 32]),
        published_ledger: 0,
    }
}

/// Order of the checks: 2, 1, 3, 5, 4, else 0. A stale CRITICAL reports STATUS.
pub(crate) fn decide(env: &Env, feed_id: &Address, policy: &Policy, asset: &Address) -> Decision {
    let client = feed::Client::new(env, feed_id);
    // `try_get`: a failing or missing feed contract must not trap this call.
    let entry = match client.try_get(asset) {
        Ok(Ok(Some(entry))) => entry,
        Ok(Ok(None)) => return empty(env, REASON_NOT_COVERED),
        Ok(Err(_)) | Err(_) => return empty(env, REASON_FEED_UNAVAILABLE),
    };

    let now = env.ledger().timestamp();
    // A feed that stamps `as_of` beyond its own clock-skew cap is not the
    // schema this market reads (the real feed rejects such writes).
    let reason = if entry.version != FEED_SCHEMA
        || entry.status > STATUS_MAX
        || entry.as_of > now.saturating_add(MAX_CLOCK_SKEW)
    {
        REASON_UNKNOWN_SCHEMA
    } else if entry.status >= policy.pause_at {
        REASON_STATUS
    } else if now.saturating_sub(entry.as_of) > policy.max_age {
        REASON_STALE
    } else {
        REASON_CLEAR
    };

    Decision {
        reason,
        status: entry.status,
        flags: entry.flags,
        as_of: entry.as_of,
        evidence_hash: entry.evidence_hash,
        published_ledger: entry.published_ledger,
    }
}
