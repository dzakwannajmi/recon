use soroban_sdk::contracterror;

/// Public ABI: numbers are never renumbered.
#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum FeedError {
    NotInitialized = 1,
    NoPendingAdmin = 2,
    EmptyBatch = 10,
    BatchTooLarge = 11,
    DuplicateAsset = 12,
    InvalidStatus = 13,
    UnknownFlagBits = 14,
    StatusFlagsMismatch = 15,
    MissingChangeTime = 16,
    ZeroEvidenceHash = 17,
    InvalidAsOf = 18,
    AsOfInFuture = 19,
    ChangeAfterAsOf = 20,
    StaleAsOf = 30,
    AlreadyPublished = 31,
    ChangeTimeWentBack = 32,
    TooManyAssets = 40,
}
