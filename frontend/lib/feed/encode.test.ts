import fs from "fs";
import path from "path";
import { Address, xdr } from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";
import { assetEvidenceHash } from "../flags/status";
import {
  FEED_ERROR_NAMES, FeedError, addressesToScVal, contractErrorCode, decodeEntries, decodeOptionEntry, entryMatches, feedErrorFromText,
  feedErrorName, fileFieldsOf, isoToUnix, parseStatusFile, toUpdate, updateToScVal, updatesToScVal, type Entry, type Update,
} from "./encode";
import { loadStatus, loadStatusJson, updatesOf, withUnpublished } from "./testkit";

const USTRY_KEY = "CBLV4ATSIWU67CFSQU2NVRKINQIKUZ2ODSZBUJTJ43VJVRSBTZYOPNUR";
const USTRY_HASH = "a481142e1e5f02360ec8e1a307b629a8357aa004d2c9125872bb0829c51286e2";
const ustry = (file = loadStatus()) => file.assets.find((a) => a.asset_code === "USTRY") as ReturnType<typeof loadStatus>["assets"][number];

const sym = (s: string) => xdr.ScVal.scvSymbol(s);
const entry = (key: string, val: xdr.ScVal) => new xdr.ScMapEntry({ key: sym(key), val });
const bytes = (hex: string) => xdr.ScVal.scvBytes(Buffer.from(hex, "hex"));

/** The `Update` struct as the host wants it, built by hand: keys sorted, explicit XDR types. */
function handBuiltUpdate(u: Update): xdr.ScVal {
  return xdr.ScVal.scvMap([
    entry("as_of", xdr.ScVal.scvU64(u.as_of)),
    entry("asset", new Address(u.asset).toScVal()),
    entry("evidence_hash", bytes(u.evidence_hash)),
    entry("flags", xdr.ScVal.scvU32(u.flags)),
    entry("issuer_change_seen_at", xdr.ScVal.scvU64(u.issuer_change_seen_at)),
    entry("status", xdr.ScVal.scvU32(u.status)),
  ]);
}

/** An `Entry` as the contract returns it, built by hand. */
function handBuiltEntry(e: Omit<Entry, "asset">): xdr.ScVal {
  return xdr.ScVal.scvMap([
    entry("as_of", xdr.ScVal.scvU64(e.as_of)),
    entry("evidence_hash", bytes(e.evidence_hash)),
    entry("flags", xdr.ScVal.scvU32(e.flags)),
    entry("issuer_change_seen_at", xdr.ScVal.scvU64(e.issuer_change_seen_at)),
    entry("published_ledger", xdr.ScVal.scvU32(e.published_ledger)),
    entry("status", xdr.ScVal.scvU32(e.status)),
    entry("version", xdr.ScVal.scvU32(e.version)),
  ]);
}

describe("toUpdate (spec 3.1) on the real USTRY asset", () => {
  it("maps the status asset to the Update of the spec example", () => {
    const file = loadStatus();
    expect(toUpdate(fileFieldsOf(file), ustry(file))).toEqual({
      asset: USTRY_KEY, status: 1, flags: 24, evidence_hash: USTRY_HASH, as_of: 1791423259n, issuer_change_seen_at: 1791423259n,
    });
  });

  it("uses 0 for a missing change time", () => {
    const file = loadStatus();
    const gold = file.assets.find((a) => a.asset_code === "GOLD")!;
    expect(gold.issuer_change_seen_at).toBeNull();
    expect(toUpdate(fileFieldsOf(file), gold)).toMatchObject({ status: 0, flags: 0, issuer_change_seen_at: 0n });
  });

  it("maps every published asset of the file, each once", () => {
    const updates = updatesOf(loadStatus());
    expect(updates).toHaveLength(27);
    expect(new Set(updates.map((u) => u.asset)).size).toBe(27);
  });

  it("throws on status null", () => {
    const json = withUnpublished(loadStatusJson(), "USTRY");
    const file = parseStatusFile(json);
    expect(() => toUpdate(fileFieldsOf(file), ustry(file))).toThrow(/status is null/);
  });

  it("throws on a bad hex hash", () => {
    const file = loadStatus();
    const a = { ...ustry(file), evidence_hash: USTRY_HASH.toUpperCase() };
    expect(() => toUpdate(fileFieldsOf(file), a)).toThrow(/64 lowercase hex/);
    expect(() => toUpdate(fileFieldsOf(file), { ...a, evidence_hash: "abc" })).toThrow(/64 lowercase hex/);
  });

  it("throws on a time that fails isIsoTime", () => {
    const file = loadStatus();
    // Re-hash after each edit so only the time can be what fails.
    for (const bad of ["2026-10-08", "2026-10-08T01:34:19Z", "not a time"]) {
      const a = { ...ustry(file), checked_at: bad };
      a.evidence_hash = assetEvidenceHash(fileFieldsOf(file), a as never);
      expect(() => toUpdate(fileFieldsOf(file), a)).toThrow(/not a valid ISO time/);
    }
    const b = { ...ustry(file), issuer_change_seen_at: "yesterday" };
    b.evidence_hash = assetEvidenceHash(fileFieldsOf(file), b as never);
    expect(() => toUpdate(fileFieldsOf(file), b)).toThrow(/issuer_change_seen_at is not a valid ISO time/);
    expect(() => isoToUnix("2026-10-08T01:34:19.579Z", "t")).not.toThrow();
  });

  it("throws when the hash or the key does not recompute", () => {
    const file = loadStatus();
    expect(() => toUpdate(fileFieldsOf(file), { ...ustry(file), flags_bitmask: 8 })).toThrow(/does not match the recomputed hash/);
    expect(() => toUpdate(fileFieldsOf(file), { ...ustry(file), sac_contract_id: "CA4JGI47NZ4DYZT6SIXFJU4TVJPKC7QHYQXLKUZ2C7BT3ZX4ZXHO6YIK" })).toThrow(/does not match the contract ID derived/);
    expect(() => toUpdate(fileFieldsOf(file), { ...ustry(file), status_code: 2 })).toThrow(/status_code 2 does not match/);
  });

  it("rejects a file whose shape is wrong", () => {
    expect(() => parseStatusFile({ assets: "no" })).toThrow(/status file is invalid/);
    const json = loadStatusJson();
    json.assets[0].flags_bitmask = "24";
    expect(() => parseStatusFile(json)).toThrow(/flags_bitmask/);
  });
});

describe("ScVal encoding", () => {
  const u = (): Update => updatesOf(loadStatus()).find((x) => x.asset === USTRY_KEY)!;

  it("encodes an Update to the hand-built map, byte for byte", () => {
    expect(updateToScVal(u()).toXDR("base64")).toBe(handBuiltUpdate(u()).toXDR("base64"));
  });

  it("uses the contract's field names and types", () => {
    const m = updateToScVal(u());
    expect(m.type).toBe("scvMap");
    const fields = (m as xdr.ScVal & { value: xdr.ScMapEntry[] }).value.map((e) => [(e.key as { value: string }).value, e.val.type]);
    expect(fields).toEqual([
      ["as_of", "scvU64"], ["asset", "scvAddress"], ["evidence_hash", "scvBytes"], ["flags", "scvU32"], ["issuer_change_seen_at", "scvU64"], ["status", "scvU32"],
    ]);
  });

  it("encodes the batch as a Vec in order, and the keys as a Vec of addresses", () => {
    const list = updatesOf(loadStatus()).slice(0, 3);
    const v = updatesToScVal(list);
    expect(v.toXDR("base64")).toBe(xdr.ScVal.scvVec(list.map(handBuiltUpdate)).toXDR("base64"));
    const keys = addressesToScVal(list.map((x) => x.asset));
    expect(keys.toXDR("base64")).toBe(xdr.ScVal.scvVec(list.map((x) => new Address(x.asset).toScVal())).toXDR("base64"));
  });

  it("refuses values outside the u32 or u64 range or a bad hash", () => {
    expect(() => updateToScVal({ ...u(), flags: -1 })).toThrow(/out of range/);
    expect(() => updateToScVal({ ...u(), status: 2 ** 32 })).toThrow(/out of range/);
    expect(() => updateToScVal({ ...u(), as_of: 1n << 64n })).toThrow(/out of range/);
    expect(() => updateToScVal({ ...u(), evidence_hash: "00" })).toThrow(/64 lowercase hex/);
  });
});

describe("Entry decoding", () => {
  const e: Omit<Entry, "asset"> = {
    version: 1, status: 1, flags: 24, evidence_hash: USTRY_HASH, as_of: 1791423259n, issuer_change_seen_at: 1791423259n, published_ledger: 1234,
  };

  it("decodes a hand-built Entry", () => {
    expect(decodeOptionEntry(handBuiltEntry(e))).toEqual({ ...e, asset: "" });
  });

  it("decodes void to null and rejects other shapes", () => {
    expect(decodeOptionEntry(xdr.ScVal.scvVoid())).toBeNull();
    expect(() => decodeOptionEntry(xdr.ScVal.scvU32(1))).toThrow(/Expected Option<Entry>/);
  });

  it("rejects a map with a missing or mistyped field", () => {
    const m = handBuiltEntry(e) as xdr.ScVal & { value: xdr.ScMapEntry[] };
    const without = xdr.ScVal.scvMap(m.value.filter((x) => (x.key as { value: string }).value !== "published_ledger"));
    expect(() => decodeOptionEntry(without)).toThrow(/published_ledger/);
    const short = xdr.ScVal.scvMap(m.value.map((x) => ((x.key as { value: string }).value === "evidence_hash" ? entry("evidence_hash", bytes("00")) : x)));
    expect(() => decodeOptionEntry(short)).toThrow(/32 bytes/);
  });

  it("decodes a get_many result in input order and names each entry", () => {
    const keys = [USTRY_KEY, "CA4JGI47NZ4DYZT6SIXFJU4TVJPKC7QHYQXLKUZ2C7BT3ZX4ZXHO6YIK"];
    const out = decodeEntries(xdr.ScVal.scvVec([handBuiltEntry(e), xdr.ScVal.scvVoid()]), keys);
    expect(out).toEqual([{ ...e, asset: USTRY_KEY }, null]);
    expect(() => decodeEntries(xdr.ScVal.scvVec([xdr.ScVal.scvVoid()]), keys)).toThrow(/1 entries for 2 keys/);
  });

  it("round-trips: an entry written for an Update matches it, and a changed field is named", () => {
    const update = updatesOf(loadStatus()).find((x) => x.asset === USTRY_KEY)!;
    const stored: Entry = { ...update, version: 1, published_ledger: 7 };
    expect(entryMatches(stored, update)).toEqual([]);
    expect(entryMatches({ ...stored, flags: 0 }, update)).toEqual(["flags 0 != 24"]);
    expect(entryMatches({ ...stored, version: 2, as_of: 1n }, update)).toHaveLength(2);
  });
});

describe("contract error codes", () => {
  it("maps all 17 codes to the names in lib.rs, with the same numbers", () => {
    const src = fs.readFileSync(path.join(process.cwd(), "..", "contracts", "feed", "src", "lib.rs"), "utf8");
    const body = /pub enum FeedError \{([\s\S]*?)\}/.exec(src)![1];
    const fromRust = Object.fromEntries([...body.matchAll(/(\w+)\s*=\s*(\d+)/g)].map((m) => [Number(m[2]), m[1]]));
    expect(Object.keys(fromRust)).toHaveLength(17);
    expect(FEED_ERROR_NAMES).toEqual(fromRust);
  });

  it("looks a name up by code, and returns null for an unknown code", () => {
    expect(feedErrorName(30)).toBe("StaleAsOf");
    expect(feedErrorName(31)).toBe("AlreadyPublished");
    expect(feedErrorName(32)).toBe("ChangeTimeWentBack");
    expect(feedErrorName(40)).toBe("TooManyAssets");
    expect(feedErrorName(3)).toBeNull();
    expect(feedErrorName(0)).toBeNull();
  });

  it("reads the code out of RPC and host error text", () => {
    expect(contractErrorCode("HostError: Error(Contract, #30)\n\nEvent log (newest first): ...")).toBe(30);
    expect(contractErrorCode("Error(Contract,#12)")).toBe(12);
    expect(contractErrorCode("HostError: Error(Auth, InvalidAction)")).toBeNull();
  });

  it("builds a typed FeedError", () => {
    const err = feedErrorFromText("HostError: Error(Contract, #30)");
    expect(err).toBeInstanceOf(FeedError);
    expect(err).toMatchObject({ kind: "contract", code: 30, errorName: "StaleAsOf" });
    expect(err.message).toBe("contract error #30 (StaleAsOf)");
    expect(feedErrorFromText("Error(Contract, #99)")).toMatchObject({ code: 99, errorName: null });
    expect(feedErrorFromText("HostError: Error(Auth, InvalidAction)")).toMatchObject({ kind: "simulation", code: null, errorName: null });
  });
});
