import { describe, expect, it } from "vitest";
import { STALE_WINDOWS, flagStaleAttestation, type ReportDate } from "./stale";

const report = (date: string, form: string | null = "N-MFP3", over: Partial<ReportDate> = {}): ReportDate => ({
  date, form, label: form ? `SEC ${form} filed ${date}` : "issuer document", source_url: "https://example.com/r",
  evidence: { kind: form ? "source_fact" : "claim", ref: `r-${date}`, quote: "q" }, ...over,
});
const run = (reports: ReportDate[], assetType = "fund", asOf = "2026-10-08") => flagStaleAttestation({ assetType, reports, asOf });

describe("flagStaleAttestation", () => {
  it("exports the windows", () => {
    expect(STALE_WINDOWS).toEqual({ "N-MFP3": 45, "NPORT-P": 160, issuer_document: 45 });
  });

  it("applies only to funds and yield-bearing assets", () => {
    expect(run([report("2026-01-01")], "bond")).toMatchObject({ outcome: "not_evaluated", reason: "No periodic attestation window is defined for asset type bond in v1" });
    expect(run([], "commodity").outcome).toBe("not_evaluated");
    expect(run([report("2026-09-30", null)], "yield-bearing").outcome).toBe("clear");
  });

  it("is not evaluated without a usable report date, naming future dates", () => {
    expect(run([])).toMatchObject({ outcome: "not_evaluated", reason: "No report date found in filings or verified issuer claims" });
    expect(run([report("2026-10-09")])).toMatchObject({ outcome: "not_evaluated", reason: expect.stringContaining("ignored 1 report date after 2026-10-08: 2026-10-09") });
    expect(run([report("2026-09-01", "10-K")]).outcome).toBe("not_evaluated"); // unknown form skipped
    expect(run([report("not a date")]).outcome).toBe("not_evaluated");
  });

  it("rejects dates that are not real calendar days, naming them only when nothing usable remains", () => {
    const bad = run([report("2026-02-30")]);
    expect(bad).toMatchObject({ outcome: "not_evaluated", reason: "No report date found in filings or verified issuer claims (invalid date 2026-02-30 ignored)" });
    expect(run([report("2026-02-30"), report("2026-10-09")])).toMatchObject({
      outcome: "not_evaluated", reason: expect.stringContaining("invalid date 2026-02-30 ignored; ignored 1 report date after 2026-10-08: 2026-10-09"),
    });
    expect(run([report("2026-02-30"), report("2026-09-30")]).outcome).toBe("clear");
  });

  it("is clear at exactly the window and raised one day later (N-MFP3, 45 days)", () => {
    expect(run([report("2026-08-24")])).toMatchObject({ outcome: "clear", reason: "Newest report date 2026-08-24 (SEC N-MFP3 filed 2026-08-24) is 45 days before 2026-10-08, inside the 45-day window for N-MFP3." });
    const late = run([report("2026-08-23")]);
    expect(late).toMatchObject({ outcome: "raised", severity: "WARNING" });
    expect(late.outcome === "raised" && late.statement).toBe(
      "The newest report date found is 2026-08-23 (SEC N-MFP3 filed 2026-08-23, https://example.com/r), 46 days before 2026-10-08; the window for N-MFP3 is 45 days.",
    );
  });

  it("uses 160 days for NPORT-P, and /A is handled by the caller as the same form", () => {
    expect(run([report("2026-05-01", "NPORT-P")]).outcome).toBe("clear"); // 160 days
    expect(run([report("2026-04-30", "NPORT-P")]).outcome).toBe("raised"); // 161 days
  });

  it("ignores future dates when an older one exists", () => {
    const e = run([report("2026-12-31"), report("2026-09-30")]);
    expect(e).toMatchObject({ outcome: "clear", as_of: "2026-10-08" });
    expect(e.outcome === "clear" && e.reason).toContain("2026-09-30");
  });

  it("is clear when any report is inside its own window, even if a newer one is a different kind", () => {
    const e = run([report("2026-06-30", "NPORT-P"), report("2026-09-01", null)]);
    expect(e.outcome === "clear" && e.reason).toContain("2026-09-01");
    expect(e.outcome === "clear" && e.reason).toContain("issuer documents");
  });

  it("names the newest report overall when all are outside their windows", () => {
    const e = run([report("2026-01-01", null), report("2026-03-01", "NPORT-P"), report("2026-02-01", "NPORT-P")]);
    expect(e.outcome === "raised" && e.statement).toContain("2026-03-01");
    expect(e.outcome === "raised" && e.evidence).toEqual([expect.objectContaining({ ref: "r-2026-03-01" })]);
  });
});
