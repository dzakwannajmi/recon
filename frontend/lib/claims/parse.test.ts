import { describe, expect, it } from "vitest";
import { detectLocale, parseAmount, parseDate, parseNumberToken } from "./parse";

describe("detectLocale", () => {
  it("tells English and German documents apart and stays unsure on little text", () => {
    expect(detectLocale("The fund and the shares of the trust will be issued for the holders with this and that. ".repeat(5))).toBe("en");
    expect(detectLocale("Die Emittentin und der Anleger werden mit einer Schuldverschreibung für die Laufzeit von der Ausgabe ".repeat(5))).toBe("de");
    expect(detectLocale("BENJI token")).toBeNull();
  });
});

describe("parseNumberToken", () => {
  it("reads unambiguous separators in any locale", () => {
    expect(parseNumberToken("522,773,589.63")).toBe(522773589.63);
    expect(parseNumberToken("1.234.567,89")).toBe(1234567.89);
    expect(parseNumberToken("2,667,360")).toBe(2667360);
    expect(parseNumberToken("1.1487")).toBe(1.1487);
    expect(parseNumberToken("100 000")).toBe(100000);
  });

  it("uses the document locale for single-group numbers", () => {
    expect(parseNumberToken("1,234")).toBeNull();
    expect(parseNumberToken("1,234", "en")).toBe(1234);
    expect(parseNumberToken("1,234", "de")).toBe(1.234);
    expect(parseNumberToken("1.500")).toBeNull();
    expect(parseNumberToken("1.500", "de")).toBe(1500);
    expect(parseNumberToken("1.500", "en")).toBe(1.5);
    expect(parseNumberToken("3,5", "de")).toBe(3.5);
    expect(parseNumberToken("3,5", "en")).toBeNull();
    expect(parseNumberToken("2,667,360", "de")).toBeNull();
  });

  it("rejects malformed grouping", () => {
    expect(parseNumberToken("1,23,4")).toBeNull();
    expect(parseNumberToken("1.2.3")).toBeNull();
    expect(parseNumberToken("1,234,56.78")).toBeNull();
    expect(parseNumberToken("100 00")).toBeNull();
  });
});

describe("parseAmount", () => {
  it("handles currency symbols, codes, and scale words", () => {
    expect(parseAmount("$522,773,589.63")).toBe(522773589.63);
    expect(parseAmount("USD 1.2 billion")).toBe(1_200_000_000);
    expect(parseAmount("€ 3,5 Mio.", "de")).toBe(3_500_000);
    expect(parseAmount("100,000 shares", "en")).toBe(100000);
    expect(parseAmount("$2.30B")).toBe(2_300_000_000);
    expect(parseAmount("$450M")).toBe(450_000_000);
    expect(parseAmount("$5m")).toBe(5_000_000);
    expect(parseAmount("EUR 5M")).toBe(5_000_000);
    expect(parseAmount("5 millions")).toBe(5_000_000);
    expect(parseAmount("5 Mln")).toBe(5_000_000);
    expect(parseAmount("EUR 100.000.000,00")).toBe(100_000_000);
    expect(parseAmount("10 USD")).toBe(10);
    expect(parseAmount("1")).toBe(1);
    expect(parseAmount("EUR 5 Billionen", "de")).toBe(5e12);
    expect(parseAmount("EUR 5 Billion", "de")).toBe(5e12);
    expect(parseAmount("USD 5 Billion", "en")).toBe(5e9);
    expect(parseAmount("100,000 shares of the Fund", "en")).toBe(100000);
  });

  it("returns null instead of a wrong number", () => {
    for (const [text, locale] of [
      ["EUR 1.500", null], ["101,234 EUR", null], ["500 600", null], ["2025 2026", null], ["5, 6", null], ["12, 5", null],
      ["100,000 B shares", "en"], ["10,000 B-Shares", "en"], ["100 T-Bills", null], ["1,000 M-units", "en"], ["5 m", null],
      [".5", null], ["$ .5 million", null], ["-5", null], ["(1,234)", "en"], ["5%", null], ["one share", null], ["2026-08-31", null],
      ["5 mill.", null], ["5 lakh", null], ["5 crore", null], ["000", null], ["0123", null], ["10⁶", null], ["$100¹", null],
    ] as const) {
      expect(parseAmount(text, locale), text).toBeNull();
    }
  });
});

describe("parseAmount: digits inside alphanumeric codes", () => {
  it("never reads the digits of a code (BB1, USDY2, ISIN) as the amount", () => {
    for (const text of ["Ein BB1-Token", "1 BB1-Token", "USDY2", "US0378331005", "DE000A3G1234", "xUSD5", "BB1,000"]) {
      expect(parseAmount(text), text).toBeNull();
    }
  });

  it("does not turn period or tranche labels into amounts once a code was skipped", () => {
    for (const text of ["Q3 2026", "H1 2026", "Tranche A2 2027", "Class A1 Notes 500", "USDY2 1"]) {
      expect(parseAmount(text), text).toBeNull();
    }
    expect(parseAmount("Class A1 Notes $500")).toBe(500);
    expect(parseAmount("Q3 USD 5 million")).toBe(5_000_000);
  });

  it("requires a currency code to stand alone", () => {
    for (const text of ["BB1USD5", "-USD5", "_USD5", "USD1-Token", "USDC2", "USD5x", "USD1 holders"]) {
      expect(parseAmount(text, "en"), text).toBeNull();
    }
    expect(parseAmount("EUR5M", "en")).toBe(5_000_000);
    expect(parseAmount("USD1,000", "en")).toBe(1000);
  });

  it("detects codes in decomposed (NFD) text and fails closed on lowercase currency", () => {
    expect(parseAmount("Cafe\u0301" + "1")).toBeNull();
    expect(parseAmount("BB1".normalize("NFD") + " supply: 2,667,360 tokens")).toBe(2_667_360);
    expect(parseAmount("usd5")).toBeNull(); // CURRENCY_CODES is case-sensitive: fail closed
  });

  it("skips code digits but still reads a separate, unambiguous number", () => {
    // BB1 is skipped; 2,667,360 is the only number left and "tokens" is a unit word.
    expect(parseAmount("BB1 supply: 2,667,360 tokens")).toBe(2_667_360);
    expect(parseAmount("BB1 supply: 2,667,360 tokens", "en")).not.toBe(1);
  });

  it("treats digits right after a stand-alone currency code as a normal number", () => {
    expect(parseAmount("USD1,000", "en")).toBe(1000);
    expect(parseAmount("EUR5M")).toBe(5_000_000);
    expect(parseAmount("USD 1,000", "en")).toBe(1000);
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
    expect(parseDate("31/08/2026")).toBe("2026-08-31");
    expect(parseDate("31.08.2026")).toBe("2026-08-31");
    expect(parseDate("October 2, 2026 7:59:59pm EDT")).toBe("2026-10-02");
    expect(parseDate("October 2, 2026, 18:00")).toBe("2026-10-02");
  });

  it("rejects impossible, partial, or ambiguous dates", () => {
    expect(parseDate("February 30, 2026")).toBeNull();
    expect(parseDate("13/13/2026")).toBeNull();
    expect(parseDate("03/04/2026")).toBeNull();
    expect(parseDate("Q3 2026")).toBeNull();
    expect(parseDate("August 2026")).toBeNull();
  });
});
