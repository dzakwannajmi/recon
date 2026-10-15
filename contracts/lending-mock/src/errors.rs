use soroban_sdk::contracterror;

/// Public ABI: numbers are never renumbered.
#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum MarketError {
    NotInitialized = 1,
    InvalidPolicy = 10,
    AlreadyListed = 11,
    TooManyMarkets = 12,
    NotListed = 13,
    BorrowsPaused = 20,
    InvalidAmount = 21,
    Overflow = 22,
    PolicyBlocks = 30,
}
