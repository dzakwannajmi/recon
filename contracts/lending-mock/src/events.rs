use soroban_sdk::{contractevent, Address, BytesN};

#[contractevent]
pub struct Initialized {
    pub admin: Address,
    pub feed: Address,
    pub pause_at: u32,
    pub max_age: u64,
}

#[contractevent]
pub struct MarketListed {
    #[topic]
    pub asset: Address,
}

/// Carries the feed entry the pause acted on (zero for reasons 1, 2, and 11
/// when the feed had nothing).
#[contractevent]
pub struct BorrowsPaused {
    #[topic]
    pub asset: Address,
    #[topic]
    pub reason: u32,
    pub status: u32,
    pub flags: u32,
    pub as_of: u64,
    pub evidence_hash: BytesN<32>,
    pub published_ledger: u32,
}

#[contractevent]
pub struct BorrowsResumed {
    #[topic]
    pub asset: Address,
    pub status: u32,
    pub as_of: u64,
    pub evidence_hash: BytesN<32>,
    pub published_ledger: u32,
}

#[contractevent]
pub struct BorrowOpened {
    #[topic]
    pub asset: Address,
    #[topic]
    pub borrower: Address,
    pub amount: i128,
}

#[contractevent]
pub struct PolicySet {
    pub pause_at: u32,
    pub max_age: u64,
}
