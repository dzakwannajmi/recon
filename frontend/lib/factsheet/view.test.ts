import { describe, expect, it } from "vitest";
import type { EvidenceRef } from "../flags/types";
import { EV, HASH } from "./fixtures";
import { bitmaskBinary, evidenceView, explorerLinks, findAsset, fmt, formatTimestamp, inputDate, safeHttpUrl } from "./view";

describe("safeHttpUrl", () => {
  it("rejects dangerous or relative values", () => {
    for (const s of ["javascript:alert(1)", "JaVaScript:alert(1)", "data:text/html,<b>x</b>", "//evil", "/relative", "relative/path", "", "ftp://x.test/a", "file:///etc/passwd"]) {
      expect(safeHttpUrl(s), s).toBeNull();
    }
    expect(safeHttpUrl("https://good.example@evil.example/")).toBeNull();
    expect(safeHttpUrl("https://user:pw@example.com/")).toBeNull();
    expect(safeHttpUrl(null)).toBeNull();
    expect(safeHttpUrl(undefined)).toBeNull();
  });
  it("accepts http and https", () => {
    expect(safeHttpUrl("https://www.sec.gov/a.xml")).toBe("https://www.sec.gov/a.xml");
    expect(safeHttpUrl("http://example.com/x")).toBe("http://example.com/x");
  });
});

describe("fmt", () => {
  it("replaces named placeholders", () => {
    expect(fmt("As of {date}: {n} of {n}", { date: "2026-10-08", n: 3 })).toBe("As of 2026-10-08: 3 of 3");
  });
  it("leaves unknown placeholders and does not touch inherited keys", () => {
    expect(fmt("{a} {b} {toString}", { a: "x" })).toBe("x {b} {toString}");
  });
});

describe("findAsset", () => {
  const mk = (asset_code: string, issuer: string) => ({ asset_code, issuer }) as never;
  const status = { assets: [mk("AAA", "G1"), mk("BBB", "G2"), mk("BBB", "G3")] };
  it("finds the exact one", () => expect(findAsset(status, "AAA")?.issuer).toBe("G1"));
  it("is exact (case-sensitive)", () => expect(findAsset(status, "aaa")).toBeNull());
  it("returns null for none and for ambiguous", () => {
    expect(findAsset(status, "CCC")).toBeNull();
    expect(findAsset(status, "BBB")).toBeNull();
  });
});

describe("explorerLinks / bitmaskBinary / inputDate", () => {
  const issuer = "GBHNGLLIE3KWGKCHIKMHJ5HVZHYIK7WTBE4QF5PLAKL4CJGSEU7HZIW5";
  it("builds links only for well-formed values", () => {
    expect(explorerLinks("BENJI", issuer)).toEqual({
      horizon: `https://horizon.stellar.org/accounts/${issuer}`,
      explorer: `https://stellar.expert/explorer/public/asset/BENJI-${issuer}`,
    });
    expect(explorerLinks("BE/NJI", issuer)).toBeNull();
    expect(explorerLinks("BENJI", "GABC")).toBeNull();
    expect(explorerLinks("TOOLONGCODE123", issuer)).toBeNull();
  });
  it("formats the bitmask", () => {
    expect(bitmaskBinary(0)).toBe("000000000");
    expect(bitmaskBinary(2)).toBe("000000010");
    expect(bitmaskBinary(0b100000001)).toBe("100000001");
  });
  it("reads the date of an input path", () => {
    expect(inputDate("data/checks/2026-10-08.json")).toBe("2026-10-08");
    expect(inputDate("data/checks/2026-02-30.json")).toBeNull();
    expect(inputDate(undefined)).toBeNull();
  });
});

describe("evidenceView", () => {
  it("chain_check without source_url", () => {
    expect(evidenceView(EV.chain)).toEqual({ kind: "chain_check", date: "2026-10-08" });
  });
  it("chain_check with source_url becomes a link labelled with the hostname", () => {
    expect(evidenceView(EV.chainLink)).toEqual({ kind: "link", url: EV.chainLink.source_url, rawUrl: EV.chainLink.source_url, label: "horizon.stellar.org" });
  });
  it("examination", () => {
    expect(evidenceView(EV.exam)).toEqual({ kind: "examination", date: "2026-10-08", check: "supply_vs_filed_shares" });
  });
  it("source_fact and snapshot are documents", () => {
    expect(evidenceView(EV.sourceFact)).toEqual({
      kind: "document", url: EV.sourceFact.source_url, rawUrl: EV.sourceFact.source_url, quote: EV.sourceFact.quote, where: "generalInfo", snapshot_sha256: HASH,
    });
    expect(evidenceView(EV.snapshot)).toMatchObject({ kind: "document", quote: null, where: null, snapshot_sha256: HASH });
  });
  it("a document with an unsafe URL has no link but keeps the raw text", () => {
    const v = evidenceView({ kind: "claim", ref: "x", source_url: "javascript:alert(1)", quote: "q", snapshot_sha256: "ab" });
    expect(v).toMatchObject({ kind: "document", url: null, rawUrl: "javascript:alert(1)" });
  });
  it("malformed refs fall back to other and never throw", () => {
    for (const ref of [
      { kind: "chain_check", ref: "nonsense" },
      { kind: "chain_check", ref: "data/checks/2026-02-30.json#A:B" },
      { kind: "examination", ref: "" },
      { kind: "wat", ref: "zzz" },
      { kind: "claim", ref: undefined },
      null,
    ] as unknown as EvidenceRef[]) {
      expect(() => evidenceView(ref)).not.toThrow();
    }
    expect(evidenceView({ kind: "chain_check", ref: "nonsense" })).toEqual({ kind: "other", ref: "nonsense" });
    expect(evidenceView(EV.malformed)).toEqual({ kind: "other", ref: EV.malformed.ref });
  });
});

describe("formatTimestamp", () => {
  it("formats ISO timestamps as YYYY-MM-DD HH:mm (UTC)", () => {
    expect(formatTimestamp("2026-10-08T01:48:49.859Z")).toBe("2026-10-08 01:48");
    expect(formatTimestamp("2026-10-08T23:05:00Z")).toBe("2026-10-08 23:05");
  });
  it("returns anything else unchanged", () => {
    for (const s of ["", "yesterday", "2026-10-08", "2026-02-30T01:00:00Z", "2026-10-08T01:48:49+07:00"]) expect(formatTimestamp(s)).toBe(s);
  });
});
