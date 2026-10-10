/**
 * Demo client: pay for one detail response with x402 on Stellar testnet and confirm it on chain (spec 8.2).
 *
 *   X402_PAY_TO=G... X402_TESTNET_AMOUNT=... npm run check:paid -- --asset CODE [--issuer G...] [--base-url URL] [--replay-check]
 *
 * Testnet only. The payer is a stellar-cli identity (default x402-payer): its secret is read into memory
 * with `stellar keys secret` (a child process that gets a minimal environment) and is never printed, logged,
 * or written. No .env file is loaded: configuration comes from the flags and the process environment only.
 * This script never prints an amount, a balance, or library error text, and it never pays twice on its own.
 * Exit codes (lib/payer/outcome.ts): 0 done, 1 refused before paying, 2 paid without a response, 3 not settled.
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { Keypair, StrKey } from "@stellar/stellar-sdk";
import { x402Client, x402HTTPClient } from "@x402/core/client";
import { createEd25519Signer } from "@x402/stellar";
import { ExactStellarScheme } from "@x402/stellar/exact/client";
import { loadDeployment } from "../lib/feed/deployment";
import { NETWORK } from "../lib/gateway/payment-config";
import { USAGE, parseArgs, type CliArgs } from "../lib/payer/args";
import { confirmTransfer, paymentsSince, type Confirmation, type HorizonOperation, type HorizonTransaction } from "../lib/payer/confirm";
import { stellarChildEnv } from "../lib/payer/env";
import { exitCode, newRunState, stoppedSentence } from "../lib/payer/outcome";
import { USDC_CODE, USDC_TESTNET_ISSUER, acceptRequirements, decimalToBase, refusePayer, refuseReason } from "../lib/payer/policy";

const HORIZON = "https://horizon-testnet.stellar.org";
const EXPLORER = "https://stellar.expert/explorer/testnet/tx";
const IDENTITY = /^[A-Za-z0-9_-]{1,32}$/;
const PAID_TIMEOUT_MS = 120_000;
const POLL_EVERY_MS = 5_000;
const POLL_UP_TO_MS = 75_000;
const REPLAY_WAIT_MS = 30_000;

/** A refusal before anything was paid. The message is written here, never taken from a library or a server. */
class Stop extends Error {}

const state = newRunState();
let stage = "the arguments";
/** When the paid request started (minus a margin); the chain polls look for transfers after this. */
let paidStartedAt: Date | null = null;
let step = 0;
const say = (line: string) => console.log(`[${++step}] ${line}`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchJson<T>(url: string, init: RequestInit = {}, timeoutMs = 15_000): Promise<{ status: number; body: T | null }> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  let body: T | null = null;
  try {
    body = (await res.json()) as T;
  } catch {
    body = null;
  }
  return { status: res.status, body };
}

/** Run stellar-cli with no shell, no stderr, and a minimal environment; the output is returned, never printed. */
function stellar(args: string[]): string {
  return execFileSync("stellar", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], env: stellarChildEnv(process.env) as NodeJS.ProcessEnv }).trim();
}

type Account = { balances?: { asset_code?: string; asset_issuer?: string; balance?: string }[] };
type Records<T> = { _embedded?: { records?: T[] } };

async function payerOperations(payer: string): Promise<HorizonOperation[]> {
  const r = await fetchJson<Records<HorizonOperation>>(`${HORIZON}/accounts/${payer}/operations?order=desc&limit=30&include_failed=false`);
  return r.body?._embedded?.records ?? [];
}

/** Look for a payer-to-receiver transfer since the start, for up to 75 s. Never pays. */
async function pollChain(payer: string, payTo: string, since: Date): Promise<"found" | "none" | "unknown"> {
  const deadline = Date.now() + POLL_UP_TO_MS;
  let reads = 0;
  while (Date.now() < deadline) {
    await sleep(POLL_EVERY_MS);
    try {
      const found = paymentsSince(await payerOperations(payer), { payer, payTo, since });
      reads++;
      if (found.length > 0) {
        console.log(`Paid, response not delivered. Transfer transaction: ${found[0]}`);
        console.log(`${EXPLORER}/${found[0]}`);
        return "found";
      }
    } catch {
      // a failed read does not prove that nothing moved
    }
  }
  return reads > 0 ? "none" : "unknown";
}

async function session(args: CliArgs): Promise<void> {
  say(`Arguments valid: asset ${args.asset}, server ${args.baseUrl}`);

  // 2. Environment and the payer identity.
  stage = "the setup";
  const payTo = (process.env.X402_PAY_TO ?? "").trim();
  if (!StrKey.isValidEd25519PublicKey(payTo)) throw new Stop("X402_PAY_TO must be set to the receiving account address (G...)");
  const cap = (process.env.X402_TESTNET_AMOUNT ?? "").trim();
  if (!/^[1-9][0-9]{0,11}$/.test(cap)) throw new Stop("X402_TESTNET_AMOUNT must be set to the most this run may pay, in USDC base units");
  const capBase = BigInt(cap);
  const identity = (process.env.X402_PAYER_IDENTITY ?? "").trim() || "x402-payer";
  if (!IDENTITY.test(identity)) throw new Stop("X402_PAYER_IDENTITY must be 1 to 32 letters, digits, dashes, or underscores");
  let payer: string;
  let secret: string;
  try {
    payer = stellar(["keys", "address", identity]);
    secret = stellar(["keys", "secret", identity]);
  } catch {
    throw new Stop(`Could not read the stellar-cli identity "${identity}". Create it first (see the testnet setup).`);
  }
  if (!StrKey.isValidEd25519PublicKey(payer) || !StrKey.isValidEd25519SecretSeed(secret) || Keypair.fromSecret(secret).publicKey() !== payer) {
    throw new Stop("The stellar-cli identity is not a valid account");
  }
  say(`Payer ${payer} (identity "${identity}"); the secret stays in stellar-cli and in memory`);

  // 3. The payer must not be a key Recon uses for anything else.
  const deployment = loadDeployment();
  const refused = refusePayer({ payer, publisher: deployment.publisher, admin: deployment.admin, payTo });
  if (refused) throw new Stop(`Refused: ${refused}`);
  say("Payer is not the feed publisher, the feed admin, or the receiver");

  // 4. Preflight on Horizon testnet: the account, the USDC trustline, and enough balance.
  stage = "the balance preflight";
  const account = await fetchJson<Account>(`${HORIZON}/accounts/${payer}`);
  if (account.status === 404) throw new Stop("The payer account does not exist on testnet");
  if (account.status !== 200 || !account.body) throw new Stop("Horizon testnet could not be read");
  const usdc = account.body.balances?.find((b) => b.asset_code === USDC_CODE && b.asset_issuer === USDC_TESTNET_ISSUER);
  if (!usdc) throw new Stop("The payer has no testnet USDC trustline");
  let enough = false;
  try {
    enough = decimalToBase(String(usdc.balance)) >= capBase;
  } catch {
    enough = false;
  }
  if (!enough) throw new Stop("The payer's test USDC balance is not sufficient");
  say("test USDC balance: sufficient");

  // 5. The free summary.
  stage = "the free summary";
  const query = `asset_code=${encodeURIComponent(args.asset)}${args.issuer ? `&issuer=${encodeURIComponent(args.issuer)}` : ""}`;
  const free = await fetchJson<{ status?: string | null; as_of?: string; raised_flags?: { code: string }[]; asset?: { issuer?: string } }>(`${args.baseUrl}/api/check?${query}`);
  if (free.status !== 200 || !free.body) throw new Stop(`The free summary answered ${free.status}`);
  say(`Free summary: status ${free.body.status ?? "none"}, as of ${free.body.as_of}, raised flags: ${(free.body.raised_flags ?? []).map((f) => f.code).join(", ") || "none"}`);
  const detailUrl = `${args.baseUrl}/api/check/detail?asset_code=${encodeURIComponent(args.asset)}&issuer=${encodeURIComponent(args.issuer ?? free.body.asset?.issuer ?? "")}`;

  // 6. The unpaid request must be a 402 whose requirements are exactly what we expect.
  stage = "the unpaid request";
  const expected = { payTo, capBase };
  const client = new x402Client();
  client.register(NETWORK, new ExactStellarScheme(createEd25519Signer(secret, NETWORK)));
  client.registerPolicy(acceptRequirements(expected));
  const http = new x402HTTPClient(client);
  const unpaid = await fetch(detailUrl, { signal: AbortSignal.timeout(30_000) });
  if (unpaid.status !== 402) throw new Stop(`Expected 402 without a payment, got ${unpaid.status}`);
  const unpaidBody = await unpaid.json().catch(() => undefined);
  const required = http.getPaymentRequiredResponse((n) => unpaid.headers.get(n), unpaidBody);
  const reasons = required.accepts.map((r) => refuseReason(required.x402Version, r, expected));
  const accepted = required.accepts.find((_, i) => reasons[i] === null);
  if (!accepted) throw new Stop(`Refused the server's requirements: ${[...new Set(reasons)].join("; ")}`);
  say(`402: x402 v${required.x402Version}, ${accepted.scheme}, ${accepted.network}, test USDC, pay to ${accepted.payTo}`);
  const requiredBase = BigInt(accepted.amount);

  // 7. Sign the Soroban authorization for the transfer. The facilitator submits it and pays the fee.
  stage = "signing";
  const payload = await http.createPaymentPayload(required);
  const signature = http.encodePaymentSignatureHeader(payload);
  say("Signed a Soroban auth entry for the USDC transfer; the facilitator pays the fee.");

  // 8. The one paid request. It is never repeated automatically. From here on, no failure is "refused before paying".
  stage = "the paid request";
  const startedAt = new Date(Date.now() - 5_000);
  paidStartedAt = startedAt;
  state.paidSent = true;
  let paid: Response | null = null;
  let bytes: Buffer | null = null;
  try {
    paid = await fetch(detailUrl, { headers: signature, signal: AbortSignal.timeout(PAID_TIMEOUT_MS) });
    if (paid.status === 200) bytes = Buffer.from(await paid.arrayBuffer());
  } catch {
    // no answer, or a broken one: the chain tells whether the money moved
  }
  const settle = paid && bytes ? safeSettle(http, paid) : null;
  const txHash = settle?.success && settle.transaction && /^[0-9a-f]{64}$/i.test(settle.transaction) ? settle.transaction : null;

  if (paid && bytes && settle && txHash) {
    state.delivered = true;
    let schema: string | undefined;
    let matches = "unknown";
    try {
      const body = JSON.parse(bytes.toString("utf8")) as { schema?: string; feed?: { onchain?: { matches?: boolean | null } } };
      schema = body.schema;
      matches = String(body.feed?.onchain?.matches);
    } catch {
      // the settlement is what matters; a body we cannot read is reported as unknown
    }
    say(`Paid response 200. Settlement tx ${txHash}`);
    say(`Explorer: ${EXPLORER}/${txHash}`);
    say(`Payer ${settle.payer ?? payer}, network ${settle.network}`);
    say(`Body sha256 ${createHash("sha256").update(bytes).digest("hex")}, ${bytes.length} bytes, schema ${schema}, feed.onchain.matches ${matches}`);

    // 9. Confirm on Horizon testnet. It can take a few seconds to show up.
    stage = "the chain confirmation";
    let confirmation: Confirmation | null = null;
    try {
      confirmation = { ok: false, reason: "the transaction was not found on Horizon testnet" };
      for (let attempt = 0; attempt < 12; attempt++) {
        const tx = await fetchJson<HorizonTransaction>(`${HORIZON}/transactions/${txHash}`);
        if (tx.status === 200 && tx.body) {
          const ops = await fetchJson<Records<HorizonOperation>>(`${HORIZON}/transactions/${txHash}/operations?limit=50`);
          confirmation = confirmTransfer(tx.body, ops.body?._embedded?.records ?? [], { txHash, payer, payTo, amountBase: requiredBase });
          break;
        }
        await sleep(POLL_EVERY_MS);
      }
    } catch {
      confirmation = null;
    }
    if (confirmation === null) {
      state.confirmation = "unreadable";
      console.error("Could not read Horizon testnet to confirm the transfer. Check the explorer link above.");
      return;
    }
    if (!confirmation.ok) {
      // "not found" after 12 tries is unreadable, not a contradiction; anything else contradicts the response.
      state.confirmation = confirmation.reason.includes("not found") ? "unreadable" : "mismatch";
      console.error(`On-chain check failed: ${confirmation.reason}`);
      return;
    }
    state.confirmation = "confirmed";
    say(`On-chain: successful, ledger ${confirmation.ledger}, transfer confirmed`);

    // 10. Optional: the same payment again must be refused and must not move money.
    if (args.replayCheck) {
      stage = "the replay check";
      state.replay = "error";
      const again = await fetch(detailUrl, { headers: signature, signal: AbortSignal.timeout(PAID_TIMEOUT_MS) });
      if (again.status === 200) {
        state.replay = "not_refused";
        console.error("The replayed payment was NOT refused");
        return;
      }
      let reason = "no reason given";
      try {
        reason = String(http.getPaymentRequiredResponse((n) => again.headers.get(n), undefined).error ?? reason).slice(0, 80);
      } catch {
        // a non-402 refusal has no PAYMENT-REQUIRED header
      }
      say(`Replay refused: status ${again.status}, reason ${reason}`);
      await sleep(REPLAY_WAIT_MS);
      const hashes = paymentsSince(await payerOperations(payer), { payer, payTo, since: startedAt });
      if (hashes.length !== 1) {
        state.replay = "second_transfer";
        console.error(`Expected exactly one transfer since the start, found ${hashes.length}`);
        return;
      }
      state.replay = "refused";
      say("No second transfer appeared after the replay");
    }
    return;
  }

  // The response did not arrive or was not a settled 200: find out whether money moved. Never pay again here.
  stage = "the chain poll";
  say(`No settled response${paid ? ` (status ${paid.status})` : " (no answer)"}. Checking the chain for a transfer; this will not pay again.`);
  state.chain = await pollChain(payer, payTo, startedAt);
  if (state.chain === "none") console.log("No transfer found on chain: the payment did not settle.");
}

function safeSettle(http: x402HTTPClient, res: Response) {
  try {
    return http.getPaymentSettleResponse((n) => res.headers.get(n));
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2));
  if (parsed.kind === "help") {
    console.log(USAGE);
    return;
  }
  if (parsed.kind === "error") {
    console.error(`${parsed.message}\n\n${USAGE}`);
    process.exitCode = 1;
    return;
  }
  try {
    await session(parsed.args);
  } catch (err) {
    if (err instanceof Stop) {
      console.error(err.message);
    } else {
      // Never print library error text: a Stellar simulation error can contain the transfer amount.
      console.error(`${err instanceof Error ? err.name : "Error"}: ${stoppedSentence(state, stage)}`);
    }
    // After the paid request, try once to learn whether the money moved (no new payment, no error text).
    if (state.paidSent && !state.delivered && state.chain === "pending") {
      try {
        const payer = stellar(["keys", "address", (process.env.X402_PAYER_IDENTITY ?? "").trim() || "x402-payer"]);
        state.chain = await pollChain(payer, (process.env.X402_PAY_TO ?? "").trim(), paidStartedAt ?? new Date());
      } catch {
        state.chain = "unknown";
      }
    }
  }
  process.exitCode = exitCode(state);
}

void main();
