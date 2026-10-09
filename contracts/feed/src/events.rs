use soroban_sdk::{contractevent, Address, BytesN};

#[contractevent]
pub struct Initialized {
    pub admin: Address,
    pub publisher: Address,
}

#[contractevent]
pub struct EntryUpdated {
    #[topic]
    pub asset: Address,
    #[topic]
    pub status: u32,
    pub flags: u32,
    pub evidence_hash: BytesN<32>,
    pub as_of: u64,
    pub issuer_change_seen_at: u64,
}

#[contractevent]
pub struct PublisherChanged {
    #[topic]
    pub publisher: Address,
    pub previous: Address,
}

#[contractevent]
pub struct AdminProposed {
    #[topic]
    pub proposed: Address,
    pub admin: Address,
}

#[contractevent]
pub struct AdminChanged {
    #[topic]
    pub admin: Address,
    pub previous: Address,
}

#[contractevent]
pub struct Upgraded {
    pub wasm_hash: BytesN<32>,
}
