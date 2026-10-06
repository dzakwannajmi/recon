import { describe, expect, it } from "vitest";
import { parseAmount, parseDate, parseNumberToken } from "./parse";

describe("parseNumberToken", () => {
  it("reads US and EU separators", () => {
    expect(parseNumberToken("522,773,589.63")).toBe(522773589.63);
    expect(parseNumberToken("1.234.567,89")).toBe(1234567.89);
    expect(parseNumberToken("3,5")).toBe(3.5);
    expect(parseNumberToken("1,234")).toBe(1234);
    expect(parseNumberToken("1.234.567")).toBe(1234567);
    expect(parseNumberToken("100 000")).toBe(100000);
  });

  it("rejects ambiguous or malformed numbers", () => {
    expect(parseNumberToken("1,23,4")).toBeNull();
    expect(parseNumberToken("1.2.3")).toBeNull();
    expect(parseNumberToken("abc")).toBeNull();
  });
});

describe("parseAmount", () => {
  it("handles currency symbols, codes, and scale words", () => {
    expect(parseAmount("$522,773,589.63")).toBe(522773589.63);
    expect(parseAmount("USD 1.2 billion")).toBe(1_200_000_000);
    expect(parseAmount("€ 3,5 Mio.")).toBe(3_500_000);
    expect(parseAmount("100,000 shares")).toBe(100000);
    expect(parseAmount("$25 million")).toBe(25_000_000);
    expect(parseAmount("1")).toBe(1);
    expect(parseAmount("$2.30B")).toBe(2_300_000_000);
    expect(parseAmount("$450M")).toBe(450_000_000);
    expect(parseAmount("12K holders")).toBe(12_000);
    expect(parseAmount("5 m")).toBe(5);
  });

  it("refuses text with no number or several numbers", () => {
    expect(parseAmount("one share")).toBeNull();
    expect(parseAmount("between 10 and 20")).toBeNull();
    expect(parseAmount("2026-08-31")).toBeNull();
  });
});

describe("parseDate", () => {
  it("reads common English, German, and numeric formats", () => {
    expect(parseDate("August 31, 2026")).toBe("2026-08-31");
    expect(parseDate("Aug. 31, 2026")).toBe("2026-08-31");
    expect(parseDate("31 August 2026")).toBe("2026-08-31");
    expect(parseDate("31. Juli 2026")).toBe("2026-07-31");
    expect(parseDate("2026-08-31")).toBe("2026-08-31");
    expect(parseDate("08/31/2026")).toBe("2026-08-31");
    expect(parseDate("31.08.2026")).toBe("2026-08-31");
    expect(parseDate("October 2, 2026 7:59:59pm EDT")).toBe("2026-10-02");
    expect(parseDate("October 2, 2026, 18:00")).toBe("2026-10-02");
  });

  it("rejects impossible or partial dates", () => {
    expect(parseDate("February 30, 2026")).toBeNull();
    expect(parseDate("13/13/2026")).toBeNull();
    expect(parseDate("Q3 2026")).toBeNull();
    expect(parseDate("August 2026")).toBeNull();
  });
});
