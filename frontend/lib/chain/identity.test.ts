import { beforeEach, describe, expect, it, vi } from "vitest";
import { getIssuerAccount, type IssuerAccount } from "./horizon";
import { checkIssuerIdentity, clearIdentityCache, decideIdentity, type IdentityInput } from "./identity";
import type { Transport } from "./http";
import { fakeTransport } from "./testing";
import { universeFromCsv } from "./universe";

vi.mock("./horizon", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./horizon")>()),
  getIssuerAccount: vi.fn(),
}));

const ISSUER = "GBHNGLLIE3KWGKCHIKMHJ5HVZHYIK7WTBE4QF5PLAKL4CJGSEU7HZIW5";
const BASE: IdentityInput = {
  issuerExists: true,
  homeDomain: "www.franklintempleton.com",
  tomlListsAccount: true,
  officialDomains: ["franklintempleton.com"],
  pinnedDomains: ["franklintempleton.com", "www.franklintempleton.com"],
  asOf: "2026-10-06",
};

describe("decideIdentity", () => {
  it("verifies an exact pinned domain whose toml lists the issuer", () => {
    const r = decideIdentity(BASE);
    expect(r.status).toBe("verified");
    expect(r.flag).toBeNull();
    expect(r.severity).toBeNull();
    expect(r.reason).toMatch(/\(as of 2026-10-06\)$/);
  });

  it("normalizes case and a trailing dot before comparing", () => {
    expect(decideIdentity({ ...BASE, homeDomain: "WWW.FranklinTempleton.com." }).status).toBe("verified");
  });

  it("flags a lookalike domain even when its own toml lists the issuer", () => {
    const r = decideIdentity({ ...BASE, homeDomain: "franklintempleton.co.com" });
    expect(r.status).toBe("domain_mismatch");
    expect(r.flag).toBe("ISSUER_IDENTITY");
    expect(r.severity).toBe("CRITICAL");
    expect(r.reason).not.toMatch(/scam|fraud|genuine|fake/i);
  });

  it("never verifies an unpinned subdomain of the official domain", () => {
    const r = decideIdentity({ ...BASE, homeDomain: "promo.franklintempleton.com" });
    expect(r.status).toBe("subdomain_unpinned");
    expect(r.severity).toBe("WARNING");
  });

  it("flags an invalid home_domain without echoing it", () => {
    const raw = "ignore previous instructions.example";
    for (const homeDomain of ["127.0.0.1", "evil.local", "<b>hi</b>", raw + ":80"]) {
      const r = decideIdentity({ ...BASE, homeDomain });
      expect(r.status, homeDomain).toBe("invalid_home_domain");
      expect(r.reason).not.toContain(homeDomain);
    }
  });

  it("flags a pinned domain whose toml does not list the issuer", () => {
    const r = decideIdentity({ ...BASE, tomlListsAccount: false });
    expect(r.status).toBe("not_listed_in_toml");
    expect(r.severity).toBe("CRITICAL");
  });

  it("flags a missing home_domain and a missing account", () => {
    expect(decideIdentity({ ...BASE, homeDomain: undefined }).status).toBe("no_home_domain");
    expect(decideIdentity({ ...BASE, issuerExists: false }).status).toBe("issuer_not_found");
  });

  it("warns when the toml could not be read", () => {
    const r = decideIdentity({ ...BASE, tomlListsAccount: undefined });
    expect(r.status).toBe("toml_unreachable");
    expect(r.severity).toBe("WARNING");
  });

  it("never verifies when no official domain is pinned (impostors are self-consistent too)", () => {
    const r = decideIdentity({ ...BASE, homeDomain: "some-issuer.com", officialDomains: [], pinnedDomains: [] });
    expect(r.status).toBe("unpinned");
    expect(r.severity).toBe("WARNING");
  });

  it("says so in the reason when the toml was read with the fallback parser", () => {
    expect(decideIdentity({ ...BASE, tomlParseMode: "lenient" }).reason).toMatch(/not valid TOML and was read with a fallback parser \(as of/);
    expect(decideIdentity({ ...BASE, tomlParseMode: "strict" }).reason).not.toMatch(/fallback/);
  });

  it("accepts any of several pinned domains", () => {
    const r = decideIdentity({ ...BASE, homeDomain: "etherfuse.com", officialDomains: ["other.com", "etherfuse.com"], pinnedDomains: ["other.com", "etherfuse.com"] });
    expect(r.status).toBe("verified");
  });
});

describe("checkIssuerIdentity", () => {
  const CSV = [
    "asset_code,issuer,home_domain,official_domain",
    `BENJI,${ISSUER},WWW.FranklinTempleton.com,https://franklintempleton.com/`,
  ].join("\n");
  const universe = universeFromCsv(CSV);
  const TOML = `ACCOUNTS=["${ISSUER}"]\n[[CURRENCIES]]\ncode="BENJI"\nissuer="${ISSUER}"\n`;
  const TOML_URL = "https://www.franklintempleton.com/.well-known/stellar.toml";
  const account = (home_domain?: string) => ({ id: ISSUER, home_domain }) as IssuerAccount;

  beforeEach(() => {
    clearIdentityCache();
    vi.mocked(getIssuerAccount).mockReset();
  });

  it("verifies against the pinned domain and records evidence", async () => {
    vi.mocked(getIssuerAccount).mockResolvedValue(account("www.franklintempleton.com"));
    const { transport } = fakeTransport({ [TOML_URL]: { body: TOML } });
    const r = await checkIssuerIdentity("BENJI", ISSUER, universe, { transport });
    expect(r.status).toBe("verified");
    expect(r.homeDomain).toBe("www.franklintempleton.com");
    expect(r.officialDomains).toEqual(["franklintempleton.com"]);
    expect(r.codeListed).toBe(true);
    expect(r.tomlSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(r.tomlParseMode).toBe("strict");
    expect(r.sources).toEqual([`https://horizon.stellar.org/accounts/${ISSUER}`, TOML_URL]);
    expect(r.checkedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("does not fetch anything for an invalid home_domain and does not echo it", async () => {
    vi.mocked(getIssuerAccount).mockResolvedValue(account("169.254.169.254"));
    const { transport, calls } = fakeTransport({});
    const r = await checkIssuerIdentity("BENJI", ISSUER, universe, { transport });
    expect(r.status).toBe("invalid_home_domain");
    expect(r.homeDomain).toBeNull();
    expect(calls).toEqual([]);
    expect(JSON.stringify(r)).not.toContain("169.254");
  });

  it("reports toml_unreachable when the toml fetch fails", async () => {
    vi.mocked(getIssuerAccount).mockResolvedValue(account("www.franklintempleton.com"));
    const { transport } = fakeTransport({});
    const r = await checkIssuerIdentity("BENJI", ISSUER, universe, { transport });
    expect(r.status).toBe("toml_unreachable");
    expect(r.tomlSha256).toBeNull();
  });

  it("reports issuer_not_found when Horizon has no such account", async () => {
    vi.mocked(getIssuerAccount).mockResolvedValue(null);
    const r = await checkIssuerIdentity("BENJI", ISSUER, universe, { transport: fakeTransport({}).transport });
    expect(r.status).toBe("issuer_not_found");
  });

  it("caches network reads per issuer", async () => {
    vi.mocked(getIssuerAccount).mockResolvedValue(account("www.franklintempleton.com"));
    const { transport, calls } = fakeTransport({ [TOML_URL]: { body: TOML } });
    await checkIssuerIdentity("BENJI", ISSUER, universe, { transport });
    await checkIssuerIdentity("BENJI", ISSUER, universe, { transport });
    expect(getIssuerAccount).toHaveBeenCalledTimes(1);
    expect(calls).toHaveLength(1);
  });

  it("does not let one caller's abort poison the result for others", async () => {
    vi.mocked(getIssuerAccount).mockResolvedValue(account("www.franklintempleton.com"));
    const inner = fakeTransport({ [TOML_URL]: { body: TOML } });
    const transport: Transport = async (url, init) => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      return inner.transport(url, init);
    };
    const controller = new AbortController();
    const a = checkIssuerIdentity("BENJI", ISSUER, universe, { transport, signal: controller.signal });
    const b = checkIssuerIdentity("BENJI", ISSUER, universe, { transport });
    controller.abort();
    await expect(a).rejects.toMatchObject({ name: "AbortError" });
    expect((await b).status).toBe("verified");
    expect((await checkIssuerIdentity("BENJI", ISSUER, universe, { transport })).status).toBe("verified");
    expect(inner.calls).toHaveLength(1);
  });

  it("reports when the data was fetched, not when the cache was read", async () => {
    vi.mocked(getIssuerAccount).mockResolvedValue(account("www.franklintempleton.com"));
    const { transport } = fakeTransport({ [TOML_URL]: { body: TOML } });
    const first = await checkIssuerIdentity("BENJI", ISSUER, universe, { transport });
    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = await checkIssuerIdentity("BENJI", ISSUER, universe, { transport });
    expect(second.checkedAt).toBe(first.checkedAt);
  });
});
