import { describe, expect, it } from "vitest";
import { MIN_HTML_CHARS, flagNoPublicDocs } from "./docs";
import { KEY, snapshot } from "./fixtures";

const toml = snapshot({ sha256: "sha-toml", sourceClass: "issuer_toml", url: "https://bitbondsto.com/.well-known/stellar.toml", text: { kind: "text", chars: 900, pages: null, sha256: "t", extractor: "x" } });
const html = (chars: number, over = {}) => snapshot({ sha256: `h${chars}`, url: `https://bitbondsto.com/${chars}`, text: { kind: "html", chars, pages: null, sha256: "t", extractor: "x" }, ...over });

describe("flagNoPublicDocs", () => {
  it("is not evaluated when no toml snapshot exists", () => {
    expect(flagNoPublicDocs([snapshot()], KEY)).toMatchObject({ outcome: "not_evaluated", reason: "Documents have not been collected for this asset" });
    expect(flagNoPublicDocs([toml], "OTHER:G").outcome).toBe("not_evaluated");
  });

  it("is clear with a pdf, an xml filing, or html of at least 1500 characters", () => {
    expect(flagNoPublicDocs([toml, snapshot()], KEY)).toMatchObject({ outcome: "clear", reason: "1 issuer or regulatory document with readable text (pdf) as of 2026-10-06." });
    const filing = snapshot({ sha256: "f", sourceClass: "regulatory_filing", text: { kind: "xml", chars: 10, pages: null, sha256: "t", extractor: "x" } });
    expect(flagNoPublicDocs([toml, filing], KEY).outcome).toBe("clear");
    expect(flagNoPublicDocs([toml, html(MIN_HTML_CHARS)], KEY).outcome).toBe("clear");
  });

  it("counts html with 1499 characters as a shell page and raises", () => {
    const e = flagNoPublicDocs([toml, html(MIN_HTML_CHARS - 1)], KEY);
    expect(e).toMatchObject({ outcome: "raised", severity: "WARNING" });
    expect(e.outcome === "raised" && e.statement).toBe(
      "No issuer document or regulatory filing with readable text was found for BB1 as of 2026-10-06: 1 page(s) fetched from the issuer's site, the largest with 1499 characters of text.",
    );
    expect(e.outcome === "raised" && e.evidence).toEqual([{ kind: "snapshot", ref: "h1499", source_url: "https://bitbondsto.com/1499", snapshot_sha256: "h1499" }]);
  });

  it("does not count tomls, third-party sources, or records without text", () => {
    const noText = snapshot({ sha256: "n", text: null });
    const other = snapshot({ sha256: "o", sourceClass: "third_party_toml" });
    const e = flagNoPublicDocs([toml, noText, other], KEY);
    expect(e.outcome === "raised" && e.statement).toContain("1 page(s) fetched from the issuer's site, the largest with 0 characters");
  });

  it("says so when no issuer page or filing was fetched, using the newest date", () => {
    const e = flagNoPublicDocs([toml, snapshot({ sha256: "x", sourceClass: "issuer_toml", url: "https://b.com/t", lastSeenAt: "2026-10-07T00:00:00.000Z" })], KEY);
    expect(e.outcome === "raised" && e.statement).toBe("No issuer document or regulatory filing with readable text was found for BB1 as of 2026-10-07: no issuer page or filing was fetched.");
  });
});
