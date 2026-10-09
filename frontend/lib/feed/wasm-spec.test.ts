/**
 * Cross-check the encoders against the contract's own interface, read from the built Wasm
 * (`stellar contract build` in contracts/feed). Skipped when the Wasm has not been built;
 * set FEED_WASM to point at another build.
 */
import fs from "fs";
import path from "path";
import { contract, xdr } from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";
import { addressesToScVal, decodeEntries, updatesToScVal } from "./encode";
import { loadStatus, updatesOf } from "./testkit";

const WASM = process.env.FEED_WASM ?? path.join(process.cwd(), "..", "contracts", "feed", "target", "wasm32v1-none", "release", "feed.wasm");

describe.skipIf(!fs.existsSync(WASM))("encoders against the built contract interface", () => {
  const updates = updatesOf(loadStatus()).slice(0, 3);
  const spec = async () => contract.Spec.fromWasm(fs.readFileSync(WASM));

  it("publish(updates) takes exactly what updatesToScVal builds", async () => {
    const [arg] = (await spec()).funcArgsToScVals("publish", {
      updates: updates.map((u) => ({ ...u, evidence_hash: Buffer.from(u.evidence_hash, "hex") })),
    });
    expect(arg.toXDR("base64")).toBe(updatesToScVal(updates).toXDR("base64"));
  });

  it("get_many(assets) takes exactly what addressesToScVal builds", async () => {
    const [arg] = (await spec()).funcArgsToScVals("get_many", { assets: updates.map((u) => u.asset) });
    expect(arg.toXDR("base64")).toBe(addressesToScVal(updates.map((u) => u.asset)).toXDR("base64"));
  });

  it("decodes an Entry that the contract's own spec encodes", async () => {
    const s = await spec();
    const e = { version: 1, status: 1, flags: 24, evidence_hash: Buffer.from(updates[0].evidence_hash, "hex"), as_of: 5n, issuer_change_seen_at: 4n, published_ledger: 99 };
    const scv = s.nativeToScVal(e, xdr.ScSpecTypeDef.scSpecTypeUdt(new xdr.ScSpecTypeUdt({ name: "Entry" })));
    const [decoded] = decodeEntries(xdr.ScVal.scvVec([scv]), [updates[0].asset]);
    expect(decoded).toMatchObject({ version: 1, status: 1, flags: 24, as_of: 5n, issuer_change_seen_at: 4n, published_ledger: 99, evidence_hash: updates[0].evidence_hash });
  });
});
