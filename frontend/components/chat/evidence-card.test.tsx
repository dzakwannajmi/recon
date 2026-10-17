import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { BundleView } from "@/lib/browser-payer/bundle";
import { BundleBody } from "./evidence-bundle";
import { EvidenceCard } from "./evidence-card";
import { MessageView } from "./message";

const G = "GBHNGLLIE3KWGKCHIKMHJ5HVZHYIK7WTBE4QF5PLAKL4CJGSEU7HZIW5";

describe("EvidenceCard", () => {
  it("says paid detail is not available when the tool says so", () => {
    const out = renderToStaticMarkup(<EvidenceCard offer={{ available: false, assetCode: "USTRY", issuer: null, url: null }} />);
    expect(out).toContain("not available");
    expect(out).not.toContain("Pay and unlock");
  });

  it("starts at wallet missing with a create button, a testnet note, and no amount", () => {
    const out = renderToStaticMarkup(<EvidenceCard offer={{ available: true, assetCode: "USTRY", issuer: G, url: `/api/check/detail?asset_code=USTRY&issuer=${G}` }} />);
    expect(out).toContain("No payer wallet in this browser yet.");
    expect(out).toContain("Create testnet wallet");
    expect(out).toContain("The agent does not pay");
    expect(out).not.toMatch(/\$\d|USD\b|price/i);
  });
});

describe("the chat shows the card from a tool step", () => {
  it("renders the card for get_evidence_bundle and nothing for other tools", () => {
    const step = { tool: "get_evidence_bundle", args: {}, result: { premium: true, available: true, asset_code: "USTRY", issuer: G } };
    const withCard = renderToStaticMarkup(<MessageView message={{ role: "agent", text: "ok", steps: [step] }} />);
    expect(withCard).toContain("Unlock evidence for USTRY");
    const without = renderToStaticMarkup(<MessageView message={{ role: "agent", text: "ok", steps: [{ ...step, tool: "check_asset" }] }} />);
    expect(without).not.toContain("Unlock evidence");
  });
});

const claim = (over: Partial<BundleView["claims"][number]> = {}): BundleView["claims"][number] => ({
  field: "networks", value_text: "Stellar", quote: "q", source_url: "https://issuer.example/a.pdf", source_class: "issuer_document", page: "3", snapshot_sha256: "ab", ...over,
});
const base: BundleView = {
  asset: { code: "A", issuer: G, issuer_org: "Org" },
  status: { value: "WARNING", as_of: "2026-10-08" },
  flags: [],
  claims: [],
  feed: { read: "ok", matches: true },
  evidence_hash: "e".repeat(64),
  generated_at: null,
};

describe("BundleBody escapes issuer text", () => {
  it("renders markup and javascript: urls as inert text, with no links and no HTML injection", () => {
    const view: BundleView = {
      ...base,
      asset: { code: "A", issuer: G, issuer_org: "<img src=x onerror=alert(1)>" },
      flags: [{ flag: "F", outcome: "raised", severity: "WARNING", text: "<script>alert(1)</script>", as_of: null, evidence: [] }],
      claims: [claim({ quote: "<b>q</b>", source_url: "javascript:alert(1)" })],
    };
    const out = renderToStaticMarkup(<BundleBody view={view} />);
    expect(out).not.toContain("<script>");
    expect(out).not.toContain("<img");
    expect(out).not.toContain("<b>q");
    expect(out).toContain("&lt;script&gt;");
    expect(out).toContain("&lt;b&gt;q&lt;/b&gt;");
    expect(out).toContain("javascript:alert(1)");
    expect(out).not.toMatch(/<a\b/);
  });
});

describe("BundleBody compact view", () => {
  const long = "The Fund is available on Stellar, Ethereum and Polygon.";
  const view: BundleView = {
    ...base,
    flags: [{ flag: "F1", outcome: "raised", severity: "WARNING", text: "Mismatch between doc (p3) and on-chain 5 as of 2026-10-08.", as_of: "2026-10-08", evidence: [{ quote: "<i>fq</i>", source_url: "https://issuer.example/f.pdf", snapshot_sha256: "ff", where: "p3" }] }],
    claims: [claim({ quote: "The Fund is available on Stellar" }), claim({ quote: long }), claim({ field: "custodian", value_text: "Bank", quote: "Custodian is Bank" })],
  };

  it("shows the header with short forms, the flag statement, and claims grouped by field with duplicates collapsed", () => {
    const out = renderToStaticMarkup(<BundleBody view={view} />);
    expect(out).toContain("Issuer GBHNGL…7HZIW5");
    expect(out).toContain("Stored status WARNING, as of 2026-10-08");
    expect(out).toContain("Testnet feed read: ok, matches the stored file");
    expect(out).toContain(`Evidence hash ${"e".repeat(10)}…${"e".repeat(8)}`);
    expect(out).not.toContain("e".repeat(64) + "</p>"); // the full hash is only in the tooltip
    expect(out).toContain("Mismatch between doc (p3) and on-chain 5 as of 2026-10-08.");
    expect(out).toContain("Issuer claims (2 shown of 3, overlapping quotes collapsed)");
    expect(out).toContain("networks (1)");
    expect(out).toContain("custodian (1)");
    expect(out).toContain("1 overlapping quote collapsed");
    expect(out).toContain(`Quote: ${long}`);
    expect(out).not.toContain("Quote: The Fund is available on Stellar</p>");
  });

  it("keeps each raised flag's evidence in a collapsed details block, as plain text", () => {
    const out = renderToStaticMarkup(<BundleBody view={view} />);
    expect(out).toContain("Evidence (1)");
    expect(out).toContain("Quote: &lt;i&gt;fq&lt;/i&gt;");
    expect(out).toContain("Source: https://issuer.example/f.pdf (p3)");
    expect(out).toContain("Snapshot SHA-256: ff");
    expect(out).not.toContain("<i>fq");
  });

  it("makes each claim collapsible (native details) with quote, source URL, page, and snapshot hash", () => {
    const out = renderToStaticMarkup(<BundleBody view={view} />);
    expect(out.match(/<details/g)).toHaveLength(3); // one flag evidence, two claims
    expect(out).toContain("Source: https://issuer.example/a.pdf");
    expect(out).toContain("Page: 3");
    expect(out).toContain("Snapshot SHA-256: ab");
  });

  it("offers Download PDF always and Download JSON only when the bundle text is at hand, with no amounts", () => {
    const without = renderToStaticMarkup(<BundleBody view={view} />);
    expect(without).toContain("Download PDF");
    expect(without).not.toContain("Download JSON");
    const withRaw = renderToStaticMarkup(<BundleBody view={view} raw='{"schema":"check-detail/1"}' />);
    expect(withRaw).toContain("Download JSON");
    expect(withRaw).not.toMatch(/\$\d|USD\b|price/i);
  });
});
