import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { fakeTransport } from "./testing";
import {
  codeTemplateMatches,
  fetchStellarToml,
  findCurrency,
  parseStellarToml,
  sameSiteWww,
  tomlListsAccount,
  tomlListsCode,
  type StellarToml,
} from "./toml";

const ISSUER = "GBHNGLLIE3KWGKCHIKMHJ5HVZHYIK7WTBE4QF5PLAKL4CJGSEU7HZIW5";
const OTHER = "GCRYUGD5NVARGXT56XEZI5CIFCQETYHAPQQTHO2O3IQZTHDH4LATMYWC";

const TEXT = `
NETWORK_PASSPHRASE="Public Global Stellar Network ; September 2015"
ACCOUNTS=["${ISSUER}"]

[DOCUMENTATION]
ORG_NAME="Example Fund Manager"

[[CURRENCIES]]
code="BENJI"
issuer="${ISSUER}"
anchor_asset="FOBXX"
`;
const toml = parseStellarToml(TEXT).toml;

describe("tomlListsAccount", () => {
  it("finds an issuer listed in ACCOUNTS or only as a currency issuer", () => {
    expect(tomlListsAccount({ ACCOUNTS: [ISSUER] }, ISSUER)).toBe(true);
    expect(tomlListsAccount({ CURRENCIES: [{ code: "BENJI", issuer: ISSUER }] }, ISSUER)).toBe(true);
  });

  it("does not list an absent issuer", () => {
    expect(tomlListsAccount(toml, OTHER)).toBe(false);
    expect(tomlListsAccount({}, OTHER)).toBe(false);
  });

  it("ignores malformed ACCOUNTS and CURRENCIES values", () => {
    expect(tomlListsAccount({ ACCOUNTS: ISSUER, CURRENCIES: { issuer: ISSUER } } as StellarToml, ISSUER)).toBe(false);
    expect(tomlListsAccount({ ACCOUNTS: [42, null], CURRENCIES: ["x", null] } as StellarToml, ISSUER)).toBe(false);
  });
});

describe("tomlListsCode and code_template", () => {
  it("matches the exact code for the same issuer only", () => {
    expect(tomlListsCode(toml, ISSUER, "BENJI")).toBe(true);
    expect(tomlListsCode(toml, OTHER, "BENJI")).toBe(false);
    expect(tomlListsCode(toml, ISSUER, "OTHER")).toBe(false);
    expect(findCurrency(toml, ISSUER, "BENJI")?.anchor_asset).toBe("FOBXX");
  });

  it("supports SEP-1 code_template wildcards", () => {
    expect(codeTemplateMatches("CETES??", "CETES24")).toBe(true);
    expect(codeTemplateMatches("CETES??", "CETES2")).toBe(false);
    expect(codeTemplateMatches("CETES??", "BONOS24")).toBe(false);
    expect(tomlListsCode({ CURRENCIES: [{ code_template: "BOND??", issuer: OTHER }] }, OTHER, "BOND26")).toBe(true);
  });
});

describe("parseStellarToml", () => {
  it("parses valid TOML strictly", () => {
    expect(parseStellarToml(TEXT).parseMode).toBe("strict");
  });

  it("falls back to a line-based parse for a toml with a missing closing quote", () => {
    const broken = `ACCOUNTS=[\n"${OTHER}",\n"${ISSUER}\n]\nVERSION="2.0.0"\n\n[[CURRENCIES]]\ncode="CRDT"\nissuer="${ISSUER}"\ndisplay_decimals=7\n`;
    const { toml: parsed, parseMode } = parseStellarToml(broken);
    expect(parseMode).toBe("lenient");
    expect(parsed.ACCOUNTS).toEqual([OTHER, ISSUER]);
    expect(tomlListsAccount(parsed, ISSUER)).toBe(true);
    expect(tomlListsCode(parsed, ISSUER, "CRDT")).toBe(true);
  });

  describe("fallback never lists more than the file plainly states", () => {
    const BROKEN = `VERSION="2.0.0\n`; // unclosed string: forces the fallback
    const lenient = (body: string) => {
      const r = parseStellarToml(BROKEN + body);
      expect(r.parseMode).toBe("lenient");
      return r.toml;
    };

    it("(a) ignores issuer lines inside a multi-line string", () => {
      const t = lenient(`[[CURRENCIES]]\ncode="BENJI"\nissuer="${OTHER}"\ndesc="""note\nissuer="${ISSUER}"\n"""\n`);
      expect(tomlListsAccount(t, ISSUER)).toBe(false);
      expect(tomlListsCode(t, OTHER, "BENJI")).toBe(true);
    });

    it("(b) ignores an ACCOUNTS array inside a root multi-line string", () => {
      const t = lenient(`NOTE='\'\'\nACCOUNTS=["${ISSUER}"]\n'\'\'\nACCOUNTS=["${OTHER}"]\n`);
      expect(t.ACCOUNTS).toEqual([OTHER]);
    });

    it("(c) ignores accounts in comments", () => {
      const t = lenient(`ACCOUNTS=[\n"${OTHER}", # retired: ${ISSUER}\n]\n# ACCOUNTS=["${ISSUER}"]\n`);
      expect(t.ACCOUNTS).toEqual([OTHER]);
    });

    it("(d) ends an unclosed ACCOUNTS array at the next key or table", () => {
      const t = lenient(`ACCOUNTS=[\n"${OTHER}"\nSIGNING_KEY="${ISSUER}"\n[DOCUMENTATION]\nORG_NAME="x"\n`);
      expect(t.ACCOUNTS).toEqual([OTHER]);
      expect(tomlListsAccount(t, ISSUER)).toBe(false);
    });

    it("(e) drops a currency entry with conflicting duplicate keys", () => {
      const t = lenient(`[[CURRENCIES]]\ncode="BENJI"\nissuer="${OTHER}"\nissuer="${ISSUER}"\n[[CURRENCIES]]\ncode="USDY"\nissuer="${OTHER}"\n`);
      expect(tomlListsAccount(t, ISSUER)).toBe(false);
      expect(tomlListsCode(t, OTHER, "BENJI")).toBe(false);
      expect(tomlListsCode(t, OTHER, "USDY")).toBe(true);
    });

    it("keeps a # inside a quoted value", () => {
      const t = lenient(`[DOCUMENTATION]\nORG_NAME="Fund #1"\n`);
      expect((t.DOCUMENTATION as Record<string, string>).ORG_NAME).toBe("Fund #1");
    });
  });

  it("does not pick up account IDs outside ACCOUNTS or currency issuers in the fallback", () => {
    const broken = `ACCOUNTS=["${OTHER}]\n[DOCUMENTATION]\nORG_DESCRIPTION="see ${ISSUER}"\n`;
    const parsed = parseStellarToml(broken).toml;
    expect(tomlListsAccount(parsed, ISSUER)).toBe(false);
  });
});

describe("fetchStellarToml", () => {
  it("returns the parsed toml, the final URL, and the SHA-256 of the exact bytes", async () => {
    const { transport, calls } = fakeTransport({
      "https://franklintempleton.com/.well-known/stellar.toml": {
        status: 301,
        headers: { location: "https://www.franklintempleton.com/.well-known/stellar.toml" },
      },
      "https://www.franklintempleton.com/.well-known/stellar.toml": { body: TEXT },
    });
    const fetched = await fetchStellarToml("franklintempleton.com", { transport });
    expect(calls).toHaveLength(2);
    expect(fetched.finalUrl).toBe("https://www.franklintempleton.com/.well-known/stellar.toml");
    expect(fetched.sha256).toBe(createHash("sha256").update(TEXT).digest("hex"));
    expect(tomlListsAccount(fetched.toml, ISSUER)).toBe(true);
  });

  it("refuses a redirect to another site", async () => {
    const { transport } = fakeTransport({
      "https://franklintempleton.com/.well-known/stellar.toml": {
        status: 302,
        headers: { location: "https://franklintempleton.co.com/.well-known/stellar.toml" },
      },
    });
    await expect(fetchStellarToml("franklintempleton.com", { transport })).rejects.toThrow(/Redirect/);
  });

  it("only treats www and the bare domain as the same site", () => {
    expect(sameSiteWww("example.com", "www.example.com")).toBe(true);
    expect(sameSiteWww("www.example.com", "example.com")).toBe(true);
    expect(sameSiteWww("example.com", "cdn.example.com")).toBe(false);
  });
});
