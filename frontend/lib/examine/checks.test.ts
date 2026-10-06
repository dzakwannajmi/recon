import { describe, expect, it } from "vitest";
import { checkFiledShares, checkMaxIssuance, checkTomlFixedNumber, checkTomlMaxNumber, type Reference } from "./checks";

const ref = (value: number, overrides: Partial<Reference> = {}): Reference => ({
  kind: "toml", label: "bitbondsto.com stellar.toml", value, unit: "tokens", as_of: null, source_url: "https://bitbondsto.com/.well-known/stellar.toml",
  quote: `fixed_number=${value}`, where: "[[CURRENCIES]] BB1, line 9", snapshot_sha256: "s", ...overrides,
});
const AS_OF = "2026-10-06T00:00:00.000Z";

describe("toml supply checks", () => {
  it("requires the supply to equal fixed_number exactly, in stroops, and names whose toml it is", () => {
    expect(checkTomlFixedNumber("BB1:G", "2667360.0000000", AS_OF, ref(2667360)).status).toBe("consistent");
    const off = checkTomlFixedNumber("BB1:G", "2668351.5866776", AS_OF, ref(2667360));
    expect(off.status).toBe("mismatch");
    expect(off.difference).toBe("991.5866776");
    expect(off.threshold_tokens).toBe("2667360");
    expect(off.statement).toBe(
      "Mismatch between bitbondsto.com stellar.toml ([[CURRENCIES]] BB1, line 9, fixed_number 2,667,360) and on-chain supply 2668351.5866776 as of 2026-10-06.",
    );
    expect(checkTomlFixedNumber("BB1:G", "2667359.9999999", AS_OF, ref(2667360)).difference).toBe("-0.0000001");
  });

  it("allows supply up to max_number", () => {
    expect(checkTomlMaxNumber("X:G", "100.0000000", AS_OF, ref(100)).status).toBe("consistent");
    expect(checkTomlMaxNumber("X:G", "100.0000001", AS_OF, ref(100)).status).toBe("mismatch");
  });
});

describe("checkFiledShares", () => {
  const filed = ref(686637083.58, { kind: "filing", label: "SEC N-MFP3 filed 2026-09-04", unit: "shares", as_of: "2026-08-31", where: "classLevelInfo C000215714" });
  const one = ref(1, { kind: "claim", unit: null });
  const recent = ref(686637083.58, { ...filed, as_of: "2026-09-30" });

  it("is consistent while Stellar holds a part of the class, and records the ratio and threshold", () => {
    const r = checkFiledShares("BENJI:G", "522774020.6259489", AS_OF, filed, [one]);
    expect(r.status).toBe("consistent");
    expect(r.statement).toContain("76.14%");
    expect(r.ratio).toBe(one);
    expect(r.threshold_tokens).toBe("686637083.5800000");
  });

  it("flags an excess over a recent filing, but not over an old one", () => {
    expect(checkFiledShares("BENJI:G", "800000000", AS_OF, recent, [one]).status).toBe("mismatch");
    expect(checkFiledShares("BENJI:G", "800000000", AS_OF, filed, [one]).status).toBe("not_comparable"); // 36 days old
    expect(checkFiledShares("BENJI:G", "700000000", AS_OF, recent, [one]).status).toBe("consistent"); // within 10%
  });

  it("only uses a single, stated 1:1 token-to-share ratio", () => {
    expect(checkFiledShares("WTGX:G", "1", AS_OF, filed, []).status).toBe("not_comparable");
    expect(checkFiledShares("X:G", "1", AS_OF, filed, [ref(1, { unit: "USD" })]).status).toBe("not_comparable");
    expect(checkFiledShares("X:G", "1", AS_OF, filed, [ref(100, { unit: null })]).status).toBe("not_comparable");
    expect(checkFiledShares("X:G", "1", AS_OF, filed, [one, ref(2, { unit: null })]).status).toBe("not_comparable");
  });
});

describe("checkMaxIssuance", () => {
  const max = ref(100_000_000, { kind: "claim", unit: "EUR", label: "issuer document", where: "page 48" });

  it("converts a currency maximum with a ratio in the same currency", () => {
    const r = checkMaxIssuance("BB1:G", "2668351.5866776", AS_OF, max, ref(1, { unit: "EUR" }));
    expect(r.status).toBe("consistent");
    expect(r.threshold_tokens).toBe("100000000.0000000");
    expect(r.difference).toBe("-97331648.4133224");
    expect(checkMaxIssuance("BB1:G", "200000000", AS_OF, max, ref(1, { unit: "EUR" })).status).toBe("mismatch");
  });

  it("refuses to compare across units", () => {
    expect(checkMaxIssuance("BB1:G", "1", AS_OF, max, ref(1, { unit: "USD" })).status).toBe("not_comparable");
    expect(checkMaxIssuance("BB1:G", "1", AS_OF, max, null).status).toBe("not_comparable");
  });
});
