/**
 * Test helpers for the check routes: the real committed data, a fake feed reader, and a fake
 * x402 facilitator with call counters. No network. Test support only; nothing in the app imports this file.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { encodePaymentSignatureHeader } from "@x402/core/http";
import type { FacilitatorClient } from "@x402/core/server";
import type { PaymentPayload, PaymentRequired, PaymentRequirements, SettleResponse, SupportedResponse, VerifyResponse } from "@x402/core/types";
import type { LoadedAsset, LoadedStatus } from "../factsheet/load";
import { fileFieldsOf, parseStatusFile, toUpdate, type Entry } from "../feed/encode";
import { createGatewayData, type GatewayData } from "./data";
import type { EntryReader } from "./detail";
import { resolveAsset } from "./resolve";

/**
 * The committed data as it stood when the 2026-10-15 status was published: dated files after `upTo`
 * and the monitor folder are left out, so tests that rely on that status keep their meaning when newer
 * runs are committed. Everything else is symlinked. Built once per process in a temp folder.
 */
let pinned: string | undefined;
export function pinnedDataDir(upTo = "2026-10-15"): string {
  if (pinned) return pinned;
  const real = path.join(process.cwd(), "..", "data");
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "pinned-data-"));
  for (const name of fs.readdirSync(real)) {
    const src = path.join(real, name);
    if (name === "monitor") continue;
    if (name === "status" || name === "checks" || name === "examinations") {
      fs.mkdirSync(path.join(out, name));
      for (const f of fs.readdirSync(src)) {
        const date = /^(\d{4}-\d{2}-\d{2})\./.exec(f)?.[1];
        if (date && date > upTo) continue;
        fs.symlinkSync(path.join(src, f), path.join(out, name, f));
      }
    } else if (name === "feed") {
      // The publish log as it stood: later publishes name status files that are left out above.
      fs.mkdirSync(path.join(out, name));
      for (const f of fs.readdirSync(src)) {
        if (f !== "log.json") {
          fs.symlinkSync(path.join(src, f), path.join(out, name, f));
          continue;
        }
        const log = JSON.parse(fs.readFileSync(path.join(src, f), "utf8")) as { status_file?: string }[];
        const kept = log.filter((r) => !/(\d{4}-\d{2}-\d{2})\.json$/.test(r.status_file ?? "") || /(\d{4}-\d{2}-\d{2})\.json$/.exec(r.status_file ?? "")![1] <= upTo);
        fs.writeFileSync(path.join(out, name, f), JSON.stringify(kept, null, 2));
      }
    } else fs.symlinkSync(src, path.join(out, name));
  }
  return (pinned = out);
}

export const realData = (): GatewayData => createGatewayData(pinnedDataDir());

/** The asset with this code from the committed status file, with its universe row. */
export function realAsset(code: string, issuer?: string) {
  const data = realData();
  const loaded = data.status();
  const universe = data.universe();
  const r = resolveAsset({ asset_code: code, ...(issuer ? { issuer } : {}) }, loaded.status, universe);
  if (r.kind !== "found") throw new Error(`${code} is not found in the committed status file`);
  return { data, loaded, universe, asset: r.asset, row: r.row, codeIsUnique: r.codeIsUnique };
}

/** The entry the feed holds when the committed status was published. */
export function entryFor(loaded: LoadedStatus, asset: LoadedAsset, over: Partial<Entry> = {}): Entry {
  const file = parseStatusFile(loaded.status);
  const feedAsset = file.assets.find((a) => a.asset === asset.asset);
  if (!feedAsset) throw new Error("not in the status file");
  const u = toUpdate(fileFieldsOf(file), feedAsset);
  return { ...u, version: 1, published_ledger: 5111525, ...over };
}

export function fakeReader(entries: Record<string, Entry | null> = {}): EntryReader & { calls: string[][] } {
  const calls: string[][] = [];
  return {
    calls,
    async readEntries(keys) {
      calls.push([...keys]);
      return keys.map((k) => entries[k] ?? null);
    },
  };
}

// ---------------------------------------------------------------- the x402 facilitator

/** A sentinel, not a price: tests assert it never leaves the PAYMENT-REQUIRED header. */
export const SENTINEL_AMOUNT = "4242";
export const PAY_TO = "GBTKLHCCBQTHTTZNPYO5LVSEDSQAXIGZG4TFLNNXIMY2EQKBN4CR6SRD";
export const FAKE_TX_HASH = "ab".repeat(32);
export const FAKE_PAYER = "GD436PARIAIVGQMI4O54RRKGBL6H7T3BPPKFSTYQGSG3727SXRCGE4S4";

export type FakeFacilitator = FacilitatorClient & {
  calls: { getSupported: number; verify: number; settle: number; order: string[] };
  getSupportedImpl: () => Promise<SupportedResponse>;
  verifyImpl: (p: PaymentPayload, r: PaymentRequirements) => Promise<VerifyResponse>;
  settleImpl: (p: PaymentPayload, r: PaymentRequirements) => Promise<SettleResponse>;
};

export function fakeFacilitator(): FakeFacilitator {
  const f: FakeFacilitator = {
    calls: { getSupported: 0, verify: 0, settle: 0, order: [] },
    getSupportedImpl: async () => ({
      kinds: [{ x402Version: 2, scheme: "exact", network: "stellar:testnet", extra: { areFeesSponsored: true } }],
      extensions: [],
      signers: { "stellar:*": [PAY_TO] },
    }),
    verifyImpl: async () => ({ isValid: true, payer: FAKE_PAYER }),
    settleImpl: async () => ({ success: true, transaction: FAKE_TX_HASH, network: "stellar:testnet", payer: FAKE_PAYER }),
    async getSupported() {
      f.calls.getSupported++;
      return f.getSupportedImpl();
    },
    async verify(p, r) {
      f.calls.verify++;
      f.calls.order.push("verify");
      return f.verifyImpl(p, r);
    },
    async settle(p, r) {
      f.calls.settle++;
      f.calls.order.push("settle");
      return f.settleImpl(p, r);
    },
  };
  return f;
}

/** A payment signature header for the first requirement of a decoded PAYMENT-REQUIRED, with a fake transaction. */
let paymentCounter = 0;
export function paymentHeader(required: PaymentRequired, transaction = `AAAAfake-${++paymentCounter}`) {
  const payload: PaymentPayload = { x402Version: 2, accepted: required.accepts[0], payload: { transaction } };
  return encodePaymentSignatureHeader(payload);
}
