# Recon app (`frontend/`)

The Next.js app behind Recon: the chat agent, the fact sheet pages, the API routes, the pipeline scripts, and the tests. For what Recon is and how to try it, see the [root README](../README.md). For the Soroban contracts, see [`contracts/`](../contracts/README.md).

## Contents

- [Tech stack](#tech-stack)
- [Repository layout](#repository-layout)
- [Routes](#routes)
- [Environment](#environment)
- [Commands](#commands)
- [Tests](#tests)

## Tech stack

| Layer | Technology | Version |
| --- | --- | --- |
| Framework | Next.js (App Router) | 16.3.8 |
| UI | React | 19.3.0 |
| Language | TypeScript | 5.9.3 |
| Styling | Tailwind CSS | 4.3.3 |
| Components | shadcn, Base UI (`@base-ui/react`), lucide-react | 4.21, 1.8, 1.48 |
| LLM layer | Vercel AI SDK (`ai`) | 7.0.128 |
| LLM providers | `@ai-sdk/google` | 4.0.88 |
| | `@ai-sdk/groq` | 4.0.59 |
| | `@ai-sdk/openai-compatible` (OpenRouter and NVIDIA) | 3.0.67 |
| Stellar | `@stellar/stellar-sdk` (Horizon and StellarExpert reads on mainnet; testnet wallet) | 17.2.1 |
| Payments | `@x402/core`, `@x402/next`, `@x402/stellar` | 2.28.0 |
| Auth and storage | `@supabase/ssr`, `@supabase/supabase-js` (GitHub sign-in, saved chats) | 0.12.7, 2.117.2 |
| Validation | zod | 4.6.5 |
| TOML parsing | smol-toml | 1.9 |
| PDF text | unpdf | 1.8.1 |
| Tests | vitest | 5.0.3 |
| Hosting | Vercel | n/a |

## Repository layout

| Path | What it holds |
| --- | --- |
| `app/` | Pages (landing, `/agent`, `/login`, `/privacy`, fact sheets at `/en/assets` and `/id/assets`), API routes, and the OAuth callback |
| `proxy.ts` | Refreshes the sign-in session and sends visitors without one from a fact sheet page to `/login` |
| `components/` | UI: `chat/` (messages, prompt bar, sidebar, feedback box, evidence card), `auth/`, `landing/`, `layout/`, `ui/` |
| `agent/` | Chat agent, its seven tools, the testnet wallet and signer, the model allowlist, and the LLM usage guards |
| `lib/chain/` | Read-only Horizon and StellarExpert reads, SSRF-guarded `stellar.toml` fetch, issuer identity check |
| `lib/documents/` | Document discovery from the official domain and SEC EDGAR, snapshot store, HTML and PDF text |
| `lib/claims/` | Extraction prompt and parsing, verbatim quote verifier, claim store |
| `lib/examine/` | Checks per asset type and bounded investigation of discrepancies |
| `lib/flags/` | The nine flag rules and the status mapping |
| `lib/monitor/` | Re-check cadence, issuer event triggers, daily mint and burn sums |
| `lib/review/` | Operator review queue and import |
| `lib/factsheet/` | Fact sheet content in English and Indonesian |
| `lib/feed/`, `lib/keeper/` | Encoding and publishing to the Soroban feed, and the lending keeper |
| `lib/gateway/`, `lib/mcp/` | The free summary, the paid detail, and the MCP endpoint |
| `lib/browser-payer/` | The user's browser testnet wallet and the x402 payment flow for evidence |
| `lib/auth/`, `lib/history/` | Sign-in helpers, saved chats, saved evidence and feedback (Supabase, row-level security) |
| `lib/commands.ts` | The slash commands that run without the model |
| `scripts/` | The pipeline and operator commands listed below |
| `public/` | Logos and static files |

Data files live one level up in [`data/`](../data/): the asset universe (`assets.csv`), chain checks, snapshots index, claims, examinations, status files, the feed log, and the Monitor's state and daily sums.

## Routes

| Route | What it does |
| --- | --- |
| `/agent` | The chat. Needs a signed-in user when sign-in is set up |
| `/login`, `/privacy` | GitHub sign-in and the privacy note |
| `/en/assets`, `/id/assets`, `/[lang]/assets/[code]` | Fact sheets, built from the newest status file |
| `POST /api/agent` | The chat agent: messages in, answer and tool steps out |
| `POST /api/command` | Slash commands without the model |
| `GET /api/check` | Free summary of one asset's stored status |
| `GET /api/check/detail` | Paid evidence bundle (x402, testnet), off unless the operator switches it on |
| `POST /api/mcp` | MCP endpoint for other agents (`check_asset`, `get_fact_sheet`, `list_flags`) |
| `/api/wallet` | The agent's testnet wallet |

## Environment

Settings live in `frontend/.env` (git-ignored). Copy `.env.example` and read the comments there; it lists every name. Groups:

- **Models:** `GEMINI_API_KEY`, and optionally `GROQ_API_KEY`, `OPENROUTER_API_KEY`, `NVIDIA_API_KEY`; `LLM_PROVIDER` and `LLM_MODEL`; the daily token budget and the per-provider request budgets (`LLM_DAILY_REQUEST_BUDGET`, `LLM_MINUTE_REQUEST_BUDGET`).
- **Limits:** per-IP and global rate limits for the chat, check, MCP and wallet routes.
- **Sign-in:** `NEXT_PUBLIC_SUPABASE_URL` and the publishable key. Never put a secret key in a `NEXT_PUBLIC_` variable: Supabase rejects it in the browser. `AUTH_REQUIRED=false` lets the chat run without signing in, for local work.
- **Paid evidence:** the `X402_*` settings for the testnet rail.
- **Agent wallet:** created by the "Create wallet" button or `POST /api/wallet` and saved in `.agent-wallet.json` (git-ignored). Its secret is never returned or logged.

Never commit `.env*` or the wallet file.

## Commands

Run from `frontend/`.

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server on http://localhost:3000 |
| `npm run build` | Production build, including the fact sheets |
| `npm run typecheck` | TypeScript check |
| `npm test` | Unit tests (vitest, no network) |
| `npm run check:assets` | Read-only mainnet check of every asset -> `data/checks/DATE.json` |
| `npm run snapshot:docs` | Fetch and hash issuer documents |
| `npm run extract:claims` | LLM extraction with the quote check (`--reverify` runs offline) |
| `npm run examine` | Examination run -> `data/examinations/DATE.json` |
| `npm run status` | Compute flags and status -> `data/status/DATE.json` (no network, no LLM) |
| `npm run monitor`, `npm run monitor:demo` | Watch issuer accounts and re-check when due; a simulated event |
| `npm run feed:publish`, `npm run feed:verify` | Publish a status file to the testnet feed, then read every entry back |
| `npm run keeper:demo` | The lending demo on a synthetic feed |
| `npm run benchmark`, `npm run benchmark:score` | The extraction benchmark and its scoring |
| `npm run review:queue`, `npm run import:review` | The operator review queue |

## Tests

`npm test` runs about 1,500 unit tests with no network. Tests that read the committed data are pinned to the 2026-10-15 status through `pinnedDataDir()` in `lib/gateway/testkit.ts`, so newer data runs do not change them.
