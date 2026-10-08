# What works today

Data as of 2026-10-08. Each item lists proof (a merged pull request and a file in this repo) and how to reproduce it. Commands run from `frontend/`.

362 unit tests pass (`npm test`, vitest, no network).

| Item | What it does | Proof | Reproduce |
| --- | --- | --- | --- |
| Chat agent with a testnet wallet | Gemini through the Vercel AI SDK. Tools: `get_my_wallet`, `fund_my_wallet`, `check_asset`. Every tool call is shown in the chat. Cost guards: daily token budget, step limit, rate limits. | [PR 1](https://github.com/dzakwannajmi/recon/pull/1), [`frontend/agent/tools.ts`](../frontend/agent/tools.ts) | `npm run dev`, then click "Check USTRY on Stellar mainnet" |
| Asset universe | 27 non-stablecoin RWA assets on Stellar mainnet. Each has an issuer account and an official domain pinned with evidence. | [PR 2](https://github.com/dzakwannajmi/recon/pull/2), [`data/assets.csv`](../data/assets.csv) | Open the file |
| Chain checks | Read-only mainnet reads for supply, trustlines, holders, issuer flags, signers. Issuer identity checked against the pinned `stellar.toml`. | [PR 3](https://github.com/dzakwannajmi/recon/pull/3), [`data/checks/2026-10-08.json`](../data/checks/2026-10-08.json) | `npm run check:assets` |
| Document snapshots | Issuer pages, issuer PDFs, and SEC filings fetched and hashed with SHA-256. The index lists 39 snapshots (as of 2026-10-08). | [PR 4](https://github.com/dzakwannajmi/recon/pull/4), [`data/snapshots/index.json`](../data/snapshots/index.json), [`data/sec.csv`](../data/sec.csv) | `npm run snapshot:docs` |
| Claim extraction with quote check | An LLM proposes claims. Code keeps a claim only if its quote appears in the snapshot. Dropped proposals are logged with a reason. | [PR 5](https://github.com/dzakwannajmi/recon/pull/5), [`data/claims/claims.json`](../data/claims/claims.json), [`data/claims/dropped.json`](../data/claims/dropped.json) | `npm run extract:claims -- --reverify` (offline) |
| Examiner | Compares on-chain supply with stellar.toml fields and SEC filings, and logs each investigation. | [PR 6](https://github.com/dzakwannajmi/recon/pull/6), [`data/examinations/2026-10-08.json`](../data/examinations/2026-10-08.json) | `npm run examine` |
| Nine flags and status | Pure functions over stored files. Status per asset: OK, WARNING, or CRITICAL. As of 2026-10-08: 18 OK, 9 WARNING, 0 CRITICAL. Two flags (`LARGE_MINT_BURN`, `PRICE_DEVIATION`) are not evaluated yet. | [PR 7](https://github.com/dzakwannajmi/recon/pull/7), [`data/status/2026-10-08.json`](../data/status/2026-10-08.json) | `npm run status` |
| Fact sheets in English and Indonesian | A page per asset at `/en/assets` and `/id/assets`, built from the newest status file. Each flag links to its evidence. | [PR 8](https://github.com/dzakwannajmi/recon/pull/8), [`frontend/lib/factsheet/`](../frontend/lib/factsheet/) | `npm run build`, then `npm start` and open `/en/assets` |
| Operator review queue | Documents with a failed or empty extraction are listed. Reviewed proposals go through the same verifier and are labeled `operator-reviewed`. First run: 9 entries, 8 claims stored. | [PR 9](https://github.com/dzakwannajmi/recon/pull/9), [`data/review/queue.json`](../data/review/queue.json), [`data/review/imports.json`](../data/review/imports.json) | `npm run review:queue`, `npm run import:review` |

## Week 1: what we learned

We split the work: the LLM proposes claims, deterministic code decides. Each claim must carry a verbatim quote from the hashed snapshot; extractions that fail the quote or field checks are dropped and logged (24 LLM claims kept, 24 dropped so far). We used each issuer's stellar.toml as the identity anchor (the home_domain's stellar.toml lists the issuer account); comparing it with the chain surfaced a mismatch between BB1's stellar.toml supply field and its on-chain supply. The free Gemini model missed some documents, so we built an operator review queue (9 entries, 8 claims stored, same verifier). All runs stay inside a daily token budget.

See [examples.md](examples.md) for the flags and claims behind these numbers.
