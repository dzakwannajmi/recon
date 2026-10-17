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

describe("BundleBody escapes issuer text", () => {
  it("renders markup and javascript: urls as inert text, with no links and no HTML injection", () => {
    const view: BundleView = {
      asset: { code: "A", issuer: G, issuer_org: "<img src=x onerror=alert(1)>" },
      status: { value: "WARNING", as_of: "2026-10-08" },
      flags: [{ flag: "F", outcome: "raised", severity: "WARNING", text: "<script>alert(1)</script>", as_of: null, evidence: [{ quote: "<b>q</b>", source_url: "javascript:alert(1)", snapshot_sha256: "ab", where: null }] }],
      claims: [],
      feed: { read: "ok", matches: true },
      evidence_hash: "ee",
      generated_at: null,
    };
    const out = renderToStaticMarkup(<BundleBody view={view} />);
    expect(out).not.toContain("<script>");
    expect(out).not.toContain("<img");
    expect(out).not.toContain("<b>q");
    expect(out).toContain("&lt;script&gt;");
    expect(out).toContain("javascript:alert(1)");
    expect(out).not.toMatch(/<a\b/);
  });
});
