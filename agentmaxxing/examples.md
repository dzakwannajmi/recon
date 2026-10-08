# Examples

Data as of 2026-10-08. These are observations with dated evidence, not findings about intent or conduct.

## Flags in the 2026-10-08 status file

Statements are copied from [`data/status/2026-10-08.json`](../data/status/2026-10-08.json).

| Asset | Flag | Statement |
| --- | --- | --- |
| BB1 (Bitbond) | `TOML_INCONSISTENT` | Mismatch between bitbondsto.com stellar.toml ([[CURRENCIES]] BB1, line 43, fixed_number 2,667,360) and on-chain supply 2668351.5866776 as of 2026-10-08. |
| USTRY (Etherfuse) | `FLAG_CHANGE` | Issuer authorization flags changed between checks on 2026-10-06 and 2026-10-08: auth_revocable false → true, auth_clawback_enabled false → true. |
| USTRY (Etherfuse) | `SIGNER_CHANGE` | Issuer signers or thresholds changed between checks on 2026-10-06 and 2026-10-08: added GAEN…4ELZ(weight 2); added GAQW…4UHG(weight 2); added GAWR…3VIP(weight 2); added GBRQ…EQFF(weight 2); added GBY2…ANVV(weight 2); GCRY…MYWC weight 1 → 5; low threshold 0 → 5; medium threshold 0 → 5; high threshold 0 → 6. |
| gBENJI (Franklin Templeton) | `NO_PUBLIC_DOCS` | No issuer document or regulatory filing with readable text was found for gBENJI as of 2026-10-06: 1 page(s) fetched from the issuer's site, the largest with 29 characters of text. |

Notes:

- TESOURO, EUROB, KTB, and GILTS share the Etherfuse issuer account with USTRY and carry the same two flags.
- grBENJI and sgBENJI carry the same `NO_PUBLIC_DOCS` flag as gBENJI, with the same evidence: one issuer page fetched, 29 characters of readable text.
- The Etherfuse issuer account has a transaction at 2026-10-06T21:54:47Z: [`5ad34f72…da76` on StellarExpert](https://stellar.expert/explorer/public/tx/5ad34f720108dcd6d92ad8bc78f2c151076206a01e8ae652829c2d35f0bfda76).

## Claims with their quotes

A claim is stored only if its quote appears in the snapshot. Both examples are from [`data/claims/claims.json`](../data/claims/claims.json).

**Extracted by the LLM (`field_source: "llm"`)**

- Asset: BB1. Field: `max_issuance`. Value: EUR 100,000,000.00 (page 48).
- Quote: "The Issuer issues this series of token-based bonds for a total nominal amount of EUR 100,000,000.00 (in words Euro one hundred million) (issue currency)."
- Source: https://www.bitbondsto.com/files/bitbond-sto-prospectus.pdf
- Snapshot SHA-256: `b6e802e66c624445342ff685d18116fd18d31eab600720c0834aa6d960e83ca3`
- Model: `gemini-flash-lite-latest`, extracted 2026-10-06.

**Added through the operator review queue (`field_source: "operator-reviewed"`)**

- Asset: YLDS. Field: `custodian`. Value: UMB Bank N.A. (page 13).
- Quote: "UMB Bank N.A. and Flagstar Bank, N.A., each a Member FDIC, are the custodians of FCC’s assets pursuant to custody agreements."
- Source: https://cdn.figure.com/docs/markets/fcc-prospectus.pdf
- Snapshot SHA-256: `7f0d17109a0d4e9fe938f20e94d6a5766aeb204f12551001402e04d3f2682140`
- Reviewed 2026-10-08. The quote passed the same verifier as the LLM claims.

## Example chat prompts

| Prompt | Tool it triggers |
| --- | --- |
| Check USTRY on Stellar mainnet | `check_asset` (live read-only mainnet check) |
| What's in your wallet? | `get_my_wallet` (testnet) |
| Fund your wallet on testnet | `fund_my_wallet` (Friendbot, testnet) |
| What can you check for me? | None; the agent describes its tools |

`check_asset` without an issuer lists the issuers that use the same asset code and whether each one verifies against the pinned domain.
