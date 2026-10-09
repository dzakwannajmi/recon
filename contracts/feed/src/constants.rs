/// Entry layout, bit table, status codes, and evidence-hash formula in force.
pub const SCHEMA: u32 = 1;
/// Status codes 0 (OK), 1 (WARNING), 2 (CRITICAL).
pub const STATUS_MAX: u32 = 2;
/// Bits 0 to 8 (D-035). Widened only by a contract upgrade.
pub const KNOWN_FLAGS: u32 = 0x1FF;
/// FLAG_CHANGE (bit 3) and SIGNER_CHANGE (bit 4).
pub const CHANGE_FLAGS: u32 = 0x018;
/// Cap for `publish` and `get_many`.
pub const MAX_BATCH: u32 = 25;
/// Cap for the `Assets` index.
pub const MAX_ASSETS: u32 = 100;
/// Seconds `as_of` may exceed the ledger timestamp (operator clock skew).
pub const MAX_CLOCK_SKEW: u64 = 300;
/// Ledgers per day at 5 s per ledger.
pub const DAY_IN_LEDGERS: u32 = 17_280;
/// Extend only when the remaining TTL is below this.
pub const TTL_THRESHOLD: u32 = 60 * DAY_IN_LEDGERS;
/// Extend to this many ledgers (below the 180-day maximum).
pub const TTL_EXTEND_TO: u32 = 120 * DAY_IN_LEDGERS;
