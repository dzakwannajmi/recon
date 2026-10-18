# Contracts (`contracts/`)

Two Soroban contracts in Rust, both on **Stellar testnet**. Recon reads mainnet and writes only to testnet. For the rest of the project, see the [root README](../README.md).

| Contract | Folder | What it is | Testnet id |
| --- | --- | --- | --- |
| Feed | [`feed/`](feed/) | Stores each asset's status, flag bitmask, evidence hash and as-of time. Lending protocols and other agents read it. | `CAXEHTAMDRASNGUPGRRPZZAUAOOB5MMAUNLLA5O43KH3BQWZ4LQSX2PR` |
| Lending mock | [`lending-mock/`](lending-mock/) | An example consumer: a mock lending market that pauses new borrows when the feed says so. | see `data/keeper/deployment.json` |

Toolchain: `soroban-sdk` 29.0.0, stellar-cli 28.1.0, target `wasm32v1-none`. Deployment records: [`data/feed/deployment.json`](../data/feed/deployment.json) and [`data/keeper/deployment.json`](../data/keeper/deployment.json). The publish log is [`data/feed/log.json`](../data/feed/log.json).

## Feed contract

The contract stores and guards; it never decides. Status, flags, and the 7-day hold are computed off chain by deterministic code from stored evidence and arrive as plain numbers and hashes. No free text is stored.

**Key.** Each entry is keyed by the asset's **mainnet** Stellar Asset Contract id (derived from `CODE:ISSUER` with the public network passphrase). That id exists on mainnet, so the testnet explorer shows it as "not found". Only the feed contract itself lives on testnet.

**Entry** (schema 1):

| Field | Meaning |
| --- | --- |
| `version` | Schema version (1) |
| `status` | 0 OK, 1 WARNING, 2 CRITICAL |
| `flags` | Bitmask of raised flags (bits 0 to 8, see below) |
| `evidence_hash` | 32-byte hash over the evidence behind the status |
| `as_of` | Unix seconds of the data the status is based on |
| `issuer_change_seen_at` | When a signer or flag change was first seen (0 if none); drives the 7-day hold |
| `published_ledger` | Ledger of the write |

**Flag bits** (append-only, never renumbered):

| Bit | Flag | Bit | Flag |
| --- | --- | --- | --- |
| 0 | `ISSUER_IDENTITY` | 5 | `LARGE_MINT_BURN` |
| 1 | `SUPPLY_MISMATCH` | 6 | `PRICE_DEVIATION` |
| 2 | `STALE_ATTESTATION` | 7 | `NO_PUBLIC_DOCS` |
| 3 | `FLAG_CHANGE` | 8 | `TOML_INCONSISTENT` |
| 4 | `SIGNER_CHANGE` | | |

**Entry points.**

| Function | Who | What it does |
| --- | --- | --- |
| `publish(updates)` | publisher | Writes up to 25 entries in one transaction. Each update is checked in a fixed order: no duplicate asset, status at most 2, known flag bits only, status and flags agree (OK means no flags), a change time when a change flag is set, a non-zero evidence hash, a valid `as_of` (not in the future beyond 300 s of clock skew), and, against the stored entry, an `as_of` that is not older, no exact repeat, and a change time that does not move backwards |
| `get(asset)`, `get_many(assets)` | anyone | Read one entry, or up to 25 |
| `assets()` | anyone | The index of published assets (at most 100) |
| `admin()`, `publisher()`, `pending_admin()`, `schema()` | anyone | Roles and schema version |
| `set_publisher(new)` | admin | Rotates the only account that can write entries |
| `propose_admin(new)`, `accept_admin()` | admin, then the new admin | Two-step admin handover |
| `upgrade(wasm_hash)` | admin | Replaces the contract code |

The publisher is the agent's own testnet wallet (`GDV2G36BI4ICUINTYKF66YSCADLDALCDZ4EG7Y34T7EJBVDSU32GDHQZ`); the admin is a separate operator key that is never on the server. Entries live in persistent storage and their TTL is extended on write. Events are emitted for initialization, entry updates, publisher and admin changes, and upgrades.

**Publishing.** From `frontend/`: `npm run feed:publish -- --status data/status/DATE.json --dry-run` simulates every batch, then the same command without `--dry-run` signs and sends, and `npm run feed:verify -- --status data/status/DATE.json` reads every entry back and compares it with the status file. The signing key comes only from the agent signer and is never printed.

## Lending mock

An example consumer, immutable (no upgrade, no admin rotation). No token ever moves. The feed publishes status codes; the pause threshold, the freshness limit, and the resume rule are this market's own policy, not a judgment about any asset.

- `check(asset)` reads the feed once and returns a decision with a reason code: clear, not covered, feed unavailable, unknown schema, stale, or status at or above the pause threshold. Every problem with the feed becomes a reason code, so the call pauses instead of failing.
- `sync(asset)` is open to anyone (a keeper calls it) and can **only pause**.
- `resume_borrows(asset)` is admin-only and works only while the check is clear.
- `open_borrow(...)` is refused while a market is paused.
- `set_policy(pause_at, max_age)` sets the market's policy; the admin lists markets with `add_market`.

The keeper is `frontend/scripts/keeper.ts` and its demo is `npm run keeper:demo`. The CRITICAL path is shown only on a **synthetic**, clearly labeled demo feed, because Recon's own feed has no CRITICAL entry. The demo's transactions are stored in [`data/keeper/log.json`](../data/keeper/log.json).

## Build and test

```bash
cd contracts/feed
stellar contract build
cargo test            # loads the last built Wasm for a few tests, so build first

cd ../lending-mock
cargo test            # uses the vendored feed Wasm (vendor/feed.wasm, hash pinned in tests)
```

The tests cover roles, publish validation order, sequence rules, events, TTL, resource limits, upgrades, and the market's pause and resume policy.
