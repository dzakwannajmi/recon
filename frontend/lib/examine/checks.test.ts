import { describe, expect, it } from "vitest";
import { checkFiledShares, checkMaxIssuance, checkTomlFixedNumber, checkTomlMaxNumber, type Reference } from "./checks";

const ref = (value: number, overrides: Partial<Reference> = {}): Reference => ({
  kind: "toml", label: "stellar.toml", value, unit: "tokens", as_of: null, source_url: "https://x.com/.well-known/stellar.toml",
  quote: `fixed_number=${value}`, where: "[[CURRENCIES]] BB1", snapshot_sha256: "s", ...overrides,
});
const AS_OF = "2026-10-07T00:00:00.000Z";

describe("toml supply checks", () => {
  it("requires the supply to equal fixed_number exactly, in stroops", () => {
    const ok = checkTomlFixedNumber("BB1:G", "2667360.0000000", AS_OF, ref(2667360));
    expect(ok.status).toBe("consistent");
    const off = checkTomlFixedNumber("BB1:G", "2668351.5866776", AS_OF, ref(2667360));
    expect(off.status).toBe("mismatch");
    expect(off.difference).toBe("991.5866776");
    expect(off.statement).toBe("Mismatch between stellar.toml, [[CURRENCIES]] BB1 (fixed_number 2,667,360) and on-chain supply 2668351.5866776 as of 2026-10-07.");
    expect(checkTomlFixedNumber("BB1:G", "2667359.9999999", AS_OF, ref(2667360)).difference).toBe("-0.0000001");
  });

  it("allows supply up to max_number", () => {
    expect(checkTomlMaxNumber("X:G", "100.0000000", AS_OF, ref(100)).status).toBe("consistent");
    expect(checkTomlMaxNumber("X:G", "100.0000001", AS_OF, ref(100)).status).toBe("mismatch");
  });
});

describe("checkFiledShares", () => {
  const filed = ref(686637083.58, { kind: "filing", label: "SEC N-MFP3 filed 2026-09-04", unit: "shares", as_of: "2026-08-31" });
  const ratio = ref(1, { kind: "claim", unit: null });

  it("is consistent while Stellar holds a part of the class", () => {
    const r = checkFiledShares("BENJI:G", "522774020.6259489", AS_OF, filed, ratio);
    expect(r.status).toBe("consistent");
    expect(r.statement).toContain("76.14%");
  });

  it("flags Stellar supply above the filed shares beyond the tolerance", () => {
    expect(checkFiledShares("BENJI:G", "800000000", AS_OF, filed, ratio).status).toBe("mismatch");
    expect(checkFiledShares("BENJI:G", "700000000", AS_OF, filed, ratio).status).toBe("consistent"); // within 10% of flows
  });

  it("is not comparable without a stated token ratio", () => {
    expect(checkFiledShares("WTGX:G", "2197284.7", AS_OF, filed, null).status).toBe("not_comparable");
  });
});

describe("checkMaxIssuance", () => {
  const max = ref(100_000_000, { kind: "claim", unit: "EUR", label: "issuer document", where: "page 48" });

  it("converts a currency maximum with a ratio in the same currency", () => {
    expect(checkMaxIssuance("BB1:G", "2668351.5866776", AS_OF, max, ref(1, { unit: "EUR" })).status).toBe("consistent");
    expect(checkMaxIssuance("BB1:G", "200000000", AS_OF, max, ref(1, { unit: "EUR" })).status).toBe("mismatch");
  });

  it("refuses to compare across units", () => {
    expect(checkMaxIssuance("BB1:G", "1", AS_OF, max, ref(1, { unit: "USD" })).status).toBe("not_comparable");
    expect(checkMaxIssuance("BB1:G", "1", AS_OF, max, null).status).toBe("not_comparable");
  });
});
