use soroban_sdk::{contracttype, Address, BytesN};

/// Publisher input, one per asset. `asset` is the mainnet token contract address.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Update {
    pub asset: Address,
    pub status: u32,
    pub flags: u32,
    pub evidence_hash: BytesN<32>,
    pub as_of: u64,
    pub issuer_change_seen_at: u64,
}

/// Stored and returned by reads. New fields are added as `Option` (CAP-86).
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Entry {
    pub version: u32,
    pub status: u32,
    pub flags: u32,
    pub evidence_hash: BytesN<32>,
    pub as_of: u64,
    pub issuer_change_seen_at: u64,
    pub published_ledger: u32,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DataKey {
    /// Instance: `Address`.
    Admin,
    /// Instance: `Address`, present only between `propose_admin` and `accept_admin`.
    PendingAdmin,
    /// Instance: `Address`, the only writer of entries.
    Publisher,
    /// Persistent: `Vec<Address>`, first-publish order, at most `MAX_ASSETS`.
    Assets,
    /// Persistent: `Entry`, one per asset key.
    Entry(Address),
}
