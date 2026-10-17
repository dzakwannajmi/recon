import { describe, expect, it, vi } from "vitest";
import type { BundleView, ClaimView } from "./bundle";
import { downloadName, downloadText, escapeHtml, groupClaims, openPrintTab, printableHtml, shortId, UNTRUSTED_LINE } from "./evidence-view";

const G = "GBHNGLLIE3KWGKCHIKMHJ5HVZHYIK7WTBE4QF5PLAKL4CJGSEU7HZIW5";
const claim = (over: Partial<ClaimView>): ClaimView => ({ field: "networks", value_text: "Stellar", quote: "q", source_url: "https://issuer.example/a.pdf", source_class: "issuer_document", page: "3", snapshot_sha256: "aa", ...over });

const view = (over: Partial<BundleView> = {}): BundleView => ({
  asset: { code: "USTRY", issuer: G, issuer_org: "Org <b>Inc</b>" },
  status: { value: "WARNING", as_of: "2026-10-08" },
  flags: [{ flag: "F1", outcome: "raised", severity: "WARNING", text: "Mismatch between doc (p3) and on-chain 5 as of 2026-10-08.", as_of: "2026-10-08", evidence: [{ quote: "<script>x</script>", source_url: "javascript:alert(1)", snapshot_sha256: "bb", where: "p3" }] }],
  claims: [claim({ quote: "<img src=x onerror=alert(1)>" })],
  feed: { read: "ok", matches: true },
  evidence_hash: "e".repeat(64),
  generated_at: "2026-10-17T00:00:00Z",
  ...over,
});

describe("shortId", () => {
  it("keeps the ends of a long identifier and returns short ones whole", () => {
    expect(shortId(G)).toBe("GBHNGL…SEU7HZIW5".replace("SEU7HZIW5", G.slice(-6)));
    expect(shortId("abc")).toBe("abc");
    expect(shortId(null)).toBe("not given");
    expect(shortId("e".repeat(64), 10, 8)).toBe(`${"e".repeat(10)}…${"e".repeat(8)}`);
  });
});

describe("groupClaims", () => {
  const long = "The Fund is available on Stellar, Ethereum, Polygon and Avalanche networks.";

  it("groups by field in order of first appearance", () => {
    const g = groupClaims([claim({ field: "custodian", quote: "c" }), claim({ field: "networks", quote: "n" }), claim({ field: "custodian", quote: "d" })]);
    expect(g.map((x) => [x.field, x.items.length])).toEqual([["custodian", 2], ["networks", 1]]);
  });

  it("collapses quotes that are prefixes of the longest one in the same source, keeping the longest", () => {
    const g = groupClaims([
      claim({ quote: "The Fund is available on Stellar" }),
      claim({ quote: "The Fund is available on Stellar, Ethereum" }),
      claim({ quote: long }),
      claim({ quote: "The Fund is available on Stellar" }),
    ]);
    expect(g).toHaveLength(1);
    expect(g[0].items).toHaveLength(1);
    expect(g[0].items[0].claim.quote).toBe(long);
    expect(g[0].items[0].collapsed).toBe(3);
  });

  it("collapses an exact duplicate to its first occurrence", () => {
    const g = groupClaims([claim({ quote: "same" }), claim({ quote: "same" })]);
    expect(g[0].items).toHaveLength(1);
  });

  it("never hides a claim that differs in value or page, even when its quote is a prefix", () => {
    const g = groupClaims([
      claim({ quote: "Stellar", value_text: "Stellar" }),
      claim({ quote: "Stellar and Ethereum", value_text: "Stellar, Ethereum" }),
      claim({ quote: "Stellar and Ethereum", value_text: "Stellar", page: "9" }),
    ]);
    expect(g[0].items).toHaveLength(3);
  });

  it("lists every claim when not collapsing", () => {
    const list = [claim({ quote: "a" }), claim({ quote: "a b" }), claim({ quote: "a b c" })];
    expect(groupClaims(list)[0].items).toHaveLength(1);
    expect(groupClaims(list, { collapse: false })[0].items).toHaveLength(3);
  });

  it("keeps quotes that are not prefixes, or that come from another source, snapshot, or field", () => {
    const g = groupClaims([
      claim({ quote: "Stellar" }),
      claim({ quote: "Ethereum" }),
      claim({ quote: "Stellar and more", source_url: "https://issuer.example/b.pdf" }),
      claim({ quote: "Stellar and more", snapshot_sha256: "cc" }),
      claim({ field: "custodian", quote: "Stellar and more" }),
    ]);
    expect(g.find((x) => x.field === "networks")!.items).toHaveLength(4);
    expect(g.find((x) => x.field === "custodian")!.items).toHaveLength(1);
  });

  it("never drops a claim with an empty quote", () => {
    expect(groupClaims([claim({ quote: null }), claim({ quote: "x" })])[0].items).toHaveLength(2);
  });
});

describe("printableHtml", () => {
  it("escapes all issuer text, allows no script, and carries the notice and the as-of dates", () => {
    const html = printableHtml(view());
    expect(html).not.toMatch(/<script|<img|<b>Inc/i);
    expect(html).toContain("&lt;script&gt;x&lt;/script&gt;");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(html).toContain("Org &lt;b&gt;Inc&lt;/b&gt;");
    expect(html).toContain("javascript:alert(1)"); // shown as text
    expect(html).not.toMatch(/<a\b|href=|src=["']http/i);
    expect(html).toContain("default-src 'none'");
    expect(html).toContain(UNTRUSTED_LINE);
    expect(html).toContain("as of 2026-10-08");
    expect(html).toContain("2026-10-17T00:00:00Z");
    expect(html).toContain("e".repeat(64)); // the full hash is in the print page
    expect(html).toContain("Mismatch between doc (p3) and on-chain 5 as of 2026-10-08.");
  });

  it("lists every claim, so its count matches the list", () => {
    const html = printableHtml(view({ claims: [claim({ quote: "Stellar" }), claim({ quote: "Stellar and Ethereum" }), claim({ field: "custodian", quote: "Bank" })] }));
    expect(html).toContain("Issuer claims (3)");
    expect(html).toContain("networks (2)");
    expect(html.match(/Quote: /g)).toHaveLength(4); // three claims and one flag evidence
  });

  it("states empty sections, and shows no amounts", () => {
    const html = printableHtml(view({ flags: [], claims: [] }));
    expect(html).toContain("None raised.");
    expect(html).toContain("None on file.");
    expect(html).not.toMatch(/\$\d|USD\b|price/i);
  });
});

describe("downloads", () => {
  it("names files from the asset code and as-of date only", () => {
    expect(downloadName(view(), "json")).toBe("evidence-USTRY-2026-10-08.json");
    expect(downloadName(view({ asset: { code: "../../x", issuer: null, issuer_org: null }, status: { value: null, as_of: null } }), "pdf")).toBe("evidence-x.pdf");
  });

  it("downloadText saves the text exactly, clicks once, and cleans up", async () => {
    const text = '{"schema":"check-detail/1",  "n": 1.0}\n';
    let blob!: Blob;
    const a = { href: "", download: "", rel: "", click: vi.fn(), remove: vi.fn() };
    const append = vi.fn();
    const revoke = vi.fn();
    let later!: () => void;
    downloadText("f.json", text, "application/json", {
      createObjectURL: (b) => ((blob = b), "blob:x"),
      revokeObjectURL: revoke,
      later: (f) => (later = f),
      document: { createElement: () => a as never, body: { appendChild: append } as never },
    });
    expect(await blob.text()).toBe(text);
    expect(blob.type).toBe("application/json");
    expect(a).toMatchObject({ href: "blob:x", download: "f.json" });
    expect(a.click).toHaveBeenCalledTimes(1);
    expect(a.remove).toHaveBeenCalledTimes(1);
    expect(revoke).not.toHaveBeenCalled(); // released later, so the download is not cancelled
    later();
    expect(revoke).toHaveBeenCalledWith("blob:x");
  });

  it("openPrintTab writes the page, cuts the opener, and prints; it reports a blocked tab", () => {
    const w = { document: { write: vi.fn(), close: vi.fn() }, focus: vi.fn(), print: vi.fn(), opener: {} as unknown };
    let later!: () => void;
    expect(openPrintTab("<p>hi</p>", () => w, (f) => (later = f))).toBe(true);
    expect(w.document.write).toHaveBeenCalledWith("<p>hi</p>");
    expect(w.opener).toBeNull();
    expect(w.print).not.toHaveBeenCalled();
    later();
    expect(w.print).toHaveBeenCalledTimes(1);
    expect(openPrintTab("x", () => null)).toBe(false);
  });
});

describe("escapeHtml", () => {
  it("escapes the five characters", () => {
    expect(escapeHtml(`<a href="x">&'</a>`)).toBe("&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;");
  });
});
