/**
 * Demo client: pay for one detail response with x402 on Stellar testnet and confirm it on chain (spec 8.2).
 *
 *   npm run check:paid -- --asset CODE [--issuer G...] [--base-url URL] [--replay-check]
 *
 * Testnet only. The payer is a stellar-cli identity (default x402-payer): its secret is read into memory
 * with `stellar keys secret` and is never printed, logged, or written. This script never prints an amount
 * or a balance, and it never pays twice on its own. Exit codes: 0 done, 1 refused before paying,
 * 2 paid without a response, 3 not settled.
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { Keypair, StrKey } from "@stellar/stellar-sdk";
import { x402Client, x402HTTPClient } from "@x402/core/client";
import { createEd25519Signer } from "@x402/stellar";
import { ExactStellarScheme } from "@x402/stellar/exact/client";
import { loadDeployment } from "../lib/feed/deployment";
import { NETWORK } from "../lib/gateway/payment-config";
import { USAGE, parseArgs } from "../lib/payer/args";
import { confirmTransfer, paymentsSince, type HorizonOperation, type HorizonTransaction } from "../lib/payer/confirm";
import { USDC_CODE, USDC_TESTNET_ISSUER, acceptRequirements, decimalToBase, refusePayer, refuseReason } from "../lib/payer/policy";

const HORIZON = "https://horizon-testnet.stellar.org";
const EXPLORER = "https://stellar.expert/explorer/testnet/tx";
const IDENTITY = /^[A-Za-z0-9_-]{1,32}$/;
const PAID_TIMEOUT_MS = 120_000;
const POLL_EVERY_MS = 5_000;
const POLL_UP_TO_MS = 75_000;
const REPLAY_WAIT_MS = 30_000;

class Stop extends Error {
  constructor(message: string, readonly code: number) {
    super(message);
  }
}

let step = 0;
const say = (line: string) => console.log(`[${++step}] ${line}`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchJson<T>(url: string, init: RequestInit = {}, timeoutMs = 15_000): Promise<{ status: number; body: T | null; headers: Headers }> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  let body: T | null = null;
  try {
    body = (await res.json()) as T;
  } catch {
    body = null;
  }
  return { status: res.status, body, headers: res.headers };
}

/** Run stellar-cli with no shell and no stderr; the output is returned, never printed. */
function stellar(args: string[]): string {
  return execFileSync("stellar", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
}

type Account = { balances?: { asset_type?: string; asset_code?: string; asset_issuer?: string; balance?: string }[] };
type Records<T> = { _embedded?: { records?: T[] } };

async function payerOperations(payer: string): Promise<HorizonOperation[]> {
  const r = await fetchJson<Records<HorizonOperation>>(`${HORIZON}/accounts/${payer}/operations?order=desc&limit=30&include_failed=false`);
  return r.body?._embedded?.records ?? [];
}

async function run(): Promise<number> {
  const parsed = parseArgs(process.argv.slice(2));
  if (parsed.kind === "help") {
    console.log(USAGE);
    return 0;
  }
  if (parsed.kind === "error") {
    console.error(`${parsed.message}\n\n${USAGE}`);
    return 1;
  }
  const { args } = parsed;
  say(`Arguments valid: asset ${args.asset}, server ${args.baseUrl}`);

  // 2. Environment and the payer identity.
  const payTo = (process.env.X402_PAY_TO ?? "").trim();
  if (!StrKey.isValidEd25519PublicKey(payTo)) throw new Stop("X402_PAY_TO must be set to the receiving account address (G...)", 1);
  let capBase: bigint;
  try {
    const cap = (process.env.X402_TESTNET_AMOUNT ?? "").trim();
    if (!/^[1-9][0-9]{0,11}$/.test(cap)) throw new Error("bad cap");
    capBase = BigInt(cap);
  } catch {
    throw new Stop("X402_TESTNET_AMOUNT must be set to the most this run may pay, in USDC base units", 1);
  }
  const identity = (process.env.X402_PAYER_IDENTITY ?? "").trim() || "x402-payer";
  if (!IDENTITY.test(identity)) throw new Stop("X402_PAYER_IDENTITY must be 1 to 32 letters, digits, dashes, or underscores", 1);
  let payer: string;
  let secret: string;
  try {
    payer = stellar(["keys", "address", identity]);
    secret = stellar(["keys", "secret", identity]);
  } catch {
    throw new Stop(`Could not read the stellar-cli identity "${identity}". Create it first (see the testnet setup).`, 1);
  }
  if (!StrKey.isValidEd25519PublicKey(payer) || !StrKey.isValidEd25519SecretSeed(secret) || Keypair.fromSecret(secret).publicKey() !== payer) {
    throw new Stop("The stellar-cli identity is not a valid account", 1);
  }
  say(`Payer ${payer} (identity "${identity}"); the secret stays in stellar-cli and in memory`);

  // 3. The payer must not be a key Recon uses for anything else.
  const deployment = loadDeployment();
  const refused = refusePayer({ payer, publisher: deployment.publisher, admin: deployment.admin, payTo });
  if (refused) throw new Stop(`Refused: ${refused}`, 1);
  say("Payer is not the feed publisher, the feed admin, or the receiver");

  // 4. Preflight on Horizon testnet: the account, the USDC trustline, and enough balance.
  const account = await fetchJson<Account>(`${HORIZON}/accounts/${payer}`);
  if (account.status === 404) throw new Stop("The payer account does not exist on testnet", 1);
  if (account.status !== 200 || !account.body) throw new Stop("Horizon testnet could not be read", 1);
  const usdc = account.body.balances?.find((b) => b.asset_code === USDC_CODE && b.asset_issuer === USDC_TESTNET_ISSUER);
  if (!usdc) throw new Stop("The payer has no testnet USDC trustline", 1);
  let enough = false;
  try {
    enough = decimalToBase(String(usdc.balance)) >= capBase;
  } catch {
    enough = false;
  }
  if (!enough) throw new Stop("The payer's test USDC balance is not sufficient", 1);
  say("test USDC balance: sufficient");

  // 5. The free summary.
  const query = `asset_code=${encodeURIComponent(args.asset)}${args.issuer ? `&issuer=${encodeURIComponent(args.issuer)}` : ""}`;
  const free = await fetchJson<{ status?: string | null; as_of?: string; raised_flags?: { code: string }[]; error?: string; asset?: { issuer?: string } }>(`${args.baseUrl}/api/check?${query}`);
  if (free.status !== 200 || !free.body) throw new Stop(`The free summary answered ${free.status}${free.body?.error ? ` (${String(free.body.error).slice(0, 40)})` : ""}`, 1);
  say(`Free summary: status ${free.body.status ?? "none"}, as of ${free.body.as_of}, raised flags: ${(free.body.raised_flags ?? []).map((f) => f.code).join(", ") || "none"}`);
  const detailQuery = `asset_code=${encodeURIComponent(args.asset)}&issuer=${encodeURIComponent(args.issuer ?? free.body.asset?.issuer ?? "")}`;
  const detailUrl = `${args.baseUrl}/api/check/detail?${detailQuery}`;

  // 6. The unpaid request must be a 402 whose requirements are exactly what we expect.
  const expected = { payTo, capBase };
  const client = new x402Client();
  client.register(NETWORK, new ExactStellarScheme(createEd25519Signer(secret, NETWORK)));
  client.registerPolicy(acceptRequirements(expected));
  const http = new x402HTTPClient(client);
  const unpaid = await fetch(detailUrl, { signal: AbortSignal.timeout(30_000) });
  if (unpaid.status !== 402) throw new Stop(`Expected 402 without a payment, got ${unpaid.status}`, 1);
  const unpaidBody = await unpaid.json().catch(() => undefined);
  const required = http.getPaymentRequiredResponse((n) => unpaid.headers.get(n), unpaidBody);
  const reasons = required.accepts.map((r) => refuseReason(required.x402Version, r, expected));
  const accepted = required.accepts.find((_, i) => reasons[i] === null);
  if (!accepted) throw new Stop(`Refused the server's requirements: ${[...new Set(reasons)].join("; ")}`, 1);
  say(`402: x402 v${required.x402Version}, ${accepted.scheme}, ${accepted.network}, test USDC, pay to ${accepted.payTo}`);
  const requiredBase = BigInt(accepted.amount);

  // 7. Sign the Soroban authorization for the transfer. The facilitator submits it and pays the fee.
  const payload = await http.createPaymentPayload(required);
  const signature = http.encodePaymentSignatureHeader(payload);
  say("Signed a Soroban auth entry for the USDC transfer; the facilitator pays the fee.");

  // 8. The one paid request. It is never repeated automatically.
  const startedAt = new Date(Date.now() - 5_000);
  let paid: Response | null = null;
  try {
    paid = await fetch(detailUrl, { headers: signature, signal: AbortSignal.timeout(PAID_TIMEOUT_MS) });
  } catch {
    paid = null;
  }
  const bytes = paid?.status === 200 ? Buffer.from(await paid.arrayBuffer()) : null;
  const settle = paid && bytes ? safeSettle(http, paid) : null;
  if (paid && bytes && settle?.success && settle.transaction && /^[0-9a-f]{64}$/i.test(settle.transaction)) {
    const body = JSON.parse(bytes.toString("utf8")) as { schema?: string; feed?: { onchain?: { matches?: boolean | null } } };
    say(`Paid response 200. Settlement tx ${settle.transaction}`);
    say(`Explorer: ${EXPLORER}/${settle.transaction}`);
    say(`Payer ${settle.payer ?? payer}, network ${settle.network}`);
    say(`Body sha256 ${createHash("sha256").update(bytes).digest("hex")}, ${bytes.length} bytes, schema ${body.schema}, feed.onchain.matches ${String(body.feed?.onchain?.matches)}`);

    // 9. Confirm on Horizon testnet. It can take a few seconds to show up.
    let confirmation: ReturnType<typeof confirmTransfer> = { ok: false, reason: "the transaction was not found on Horizon testnet" };
    for (let attempt = 0; attempt < 12; attempt++) {
      const tx = await fetchJson<HorizonTransaction>(`${HORIZON}/transactions/${settle.transaction}`);
      if (tx.status === 200 && tx.body) {
        const ops = await fetchJson<Records<HorizonOperation>>(`${HORIZON}/transactions/${settle.transaction}/operations?limit=50`);
        confirmation = confirmTransfer(tx.body, ops.body?._embedded?.records ?? [], { txHash: settle.transaction, payer, payTo, amountBase: requiredBase });
        break;
      }
      await sleep(POLL_EVERY_MS);
    }
    if (!confirmation.ok) throw new Stop(`On-chain check failed: ${confirmation.reason}`, 3);
    say(`On-chain: successful, ledger ${confirmation.ledger}, transfer confirmed`);

    // 10. Optional: the same payment again must be refused and must not move money.
    if (args.replayCheck) {
      const again = await fetch(detailUrl, { headers: signature, signal: AbortSignal.timeout(PAID_TIMEOUT_MS) });
      if (again.status === 200) throw new Stop("The replayed payment was NOT refused", 3);
      let reason = "no reason given";
      try {
        reason = String(http.getPaymentRequiredResponse((n) => again.headers.get(n), undefined).error ?? reason).slice(0, 80);
      } catch {
        // a non-402 refusal has no PAYMENT-REQUIRED header
      }
      say(`Replay refused: status ${again.status}, reason ${reason}`);
      await sleep(REPLAY_WAIT_MS);
      const hashes = paymentsSince(await payerOperations(payer), { payer, payTo, since: startedAt });
      if (hashes.length !== 1) throw new Stop(`Expected exactly one transfer since the start, found ${hashes.length}`, 3);
      say("No second transfer appeared after the replay");
    }
    return 0;
  }

  // The response did not arrive or was not a settled 200: find out whether money moved. Never pay again here.
  say(`No settled response${paid ? ` (status ${paid.status})` : " (no answer)"}. Checking the chain for a transfer; this will not pay again.`);
  const deadline = Date.now() + POLL_UP_TO_MS;
  while (Date.now() < deadline) {
    await sleep(POLL_EVERY_MS);
    const found = paymentsSince(await payerOperations(payer), { payer, payTo, since: startedAt });
    if (found.length > 0) {
      console.log(`Paid, response not delivered. Transfer transaction: ${found[0]}`);
      console.log(`${EXPLORER}/${found[0]}`);
      return 2;
    }
  }
  console.log("No transfer found on chain: the payment did not settle.");
  return 3;
}

function safeSettle(http: x402HTTPClient, res: Response) {
  try {
    return http.getPaymentSettleResponse((n) => res.headers.get(n));
  } catch {
    return null;
  }
}

run()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err) => {
    if (err instanceof Stop) {
      console.error(err.message);
      process.exitCode = err.code;
      return;
    }
    // Library errors can be long; show the kind and a short message only.
    console.error(`${err instanceof Error ? err.name : "Error"}: ${(err instanceof Error ? err.message : String(err)).slice(0, 300)}`);
    process.exitCode = 1;
  });
