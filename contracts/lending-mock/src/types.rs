use soroban_sdk::{contracttype, Address, BytesN};

/// Feed schema version this market understands (`Entry.version`).
pub const FEED_SCHEMA: u32 = 1;
/// Highest status code of schema 1 (0 OK, 1 WARNING, 2 CRITICAL).
pub const STATUS_MAX: u32 = 2;
/// Seconds an entry's `as_of` may exceed the ledger time (same as the feed's).
pub const MAX_CLOCK_SKEW: u64 = 300;
/// Cap for the `Markets` list.
pub const MAX_MARKETS: u32 = 10;
/// Shortest allowed freshness limit, in seconds.
pub const MIN_MAX_AGE: u64 = 60;
/// Longest allowed freshness limit: 30 days, in seconds.
pub const MAX_MAX_AGE: u64 = 2_592_000;
/// Ledgers per day at 5 s per ledger.
pub const DAY_IN_LEDGERS: u32 = 17_280;
/// Extend only when the remaining TTL is below this (60 days).
pub const TTL_THRESHOLD: u32 = 60 * DAY_IN_LEDGERS;
/// Extend to this many ledgers (120 days, below the 180-day maximum).
pub const TTL_EXTEND_TO: u32 = 120 * DAY_IN_LEDGERS;

/// Reason codes. Public ABI, append-only. 0 to 5 are check results; 10 and 11
/// are market states only and never a check result.
pub const REASON_CLEAR: u32 = 0;
pub const REASON_NOT_COVERED: u32 = 1;
pub const REASON_FEED_UNAVAILABLE: u32 = 2;
pub const REASON_UNKNOWN_SCHEMA: u32 = 3;
pub const REASON_STALE: u32 = 4;
pub const REASON_STATUS: u32 = 5;
pub const REASON_LISTED: u32 = 10;
pub const REASON_MANUAL: u32 = 11;

/// The market's own pause policy. Not a judgment by the feed publisher.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Policy {
    /// Pause when the feed status is at least this (1 WARNING, 2 CRITICAL).
    pub pause_at: u32,
    /// Pause when the entry is older than this many seconds.
    pub max_age: u64,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MarketState {
    pub borrow_enabled: bool,
    /// Why the market is paused (0 while open). See the `REASON_*` codes.
    pub reason: u32,
    pub changed_ledger: u32,
    pub total_borrowed: i128,
}

/// Result of a check: the reason and a copy of the entry it looked at. All
/// entry fields are zero (and a zero hash) for reasons 1 and 2.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Decision {
    pub reason: u32,
    pub status: u32,
    pub flags: u32,
    pub as_of: u64,
    pub evidence_hash: BytesN<32>,
    pub published_ledger: u32,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DataKey {
    /// Instance: `Address`.
    Admin,
    /// Instance: `Address`, set once at construction.
    Feed,
    /// Instance: `Policy`.
    Policy,
    /// Persistent: `Vec<Address>`, listing order, at most `MAX_MARKETS`.
    Markets,
    /// Persistent: `MarketState`.
    Market(Address),
    /// Persistent: `i128`, key is (borrower, asset).
    Debt(Address, Address),
}
