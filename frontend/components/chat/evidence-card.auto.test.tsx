/**
 * The `/evidence CODE` auto-pay wiring in the card (spec W4.7). Effects run on the server render here (React's
 * useEffect is replaced by a call), and the payer hook is a stub, so there is no browser and no network.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SPENT } from "@/lib/browser-payer/auto";

vi.mock("react", async (importOriginal) => ({ ...(await importOriginal<typeof import("react")>()), useEffect: (f: () => void) => void f() }));

const payFor = vi.fn(async () => {});
let payer: Record<string, unknown>;
vi.mock("./use-payer", () => ({ usePayer: () => payer }));

import { EvidenceCard } from "./evidence-card";

const G = "GBHNGLLIE3KWGKCHIKMHJ5HVZHYIK7WTBE4QF5PLAKL4CJGSEU7HZIW5";
const offer = { available: true, assetCode: "USTRY", issuer: G, url: `/api/check/detail?asset_code=USTRY&issuer=${G}` };
const ready = () => ({ address: "GAAA", kept: true, snap: {}, state: "ready", settled: true, busy: null, notice: null, pay: { kind: "idle" }, bundle: null, raw: null, payFor, create: vi.fn(), fund: vi.fn(), trust: vi.fn(), refresh: vi.fn(), forget: vi.fn(), acknowledge: vi.fn() });

beforeEach(() => {
  payFor.mockClear();
  SPENT.clear();
  payer = ready();
});

describe("EvidenceCard auto pay", () => {
  it("pays once for a typed command when the wallet is ready, however often it renders", () => {
    for (let i = 0; i < 3; i++) renderToStaticMarkup(<EvidenceCard offer={offer} autoPayId="cmd-1" />);
    expect(payFor).toHaveBeenCalledTimes(1);
    expect(payFor).toHaveBeenCalledWith(offer.url);
  });

  it("never pays for a card without a typed command (what the model offered)", () => {
    renderToStaticMarkup(<EvidenceCard offer={offer} />);
    expect(payFor).not.toHaveBeenCalled();
    expect(renderToStaticMarkup(<EvidenceCard offer={offer} />)).toContain("Pay and unlock");
  });

  it("shows the setup card and does not pay when the wallet is not ready, even if it becomes ready later", () => {
    payer = { ...ready(), state: "no_usdc" };
    const html = renderToStaticMarkup(<EvidenceCard offer={offer} autoPayId="cmd-2" />);
    expect(html).toContain("has no test USDC yet");
    payer = ready();
    renderToStaticMarkup(<EvidenceCard offer={offer} autoPayId="cmd-2" />);
    expect(payFor).not.toHaveBeenCalled();
  });

  it("waits while the wallet is still being read", () => {
    payer = { ...ready(), settled: false };
    renderToStaticMarkup(<EvidenceCard offer={offer} autoPayId="cmd-3" />);
    expect(payFor).not.toHaveBeenCalled();
    payer = ready();
    renderToStaticMarkup(<EvidenceCard offer={offer} autoPayId="cmd-3" />);
    expect(payFor).toHaveBeenCalledTimes(1);
  });

  it("is blocked by an unknown outcome and when paid detail is not offered", () => {
    payer = { ...ready(), pay: { kind: "unknown", tx: null } };
    renderToStaticMarkup(<EvidenceCard offer={offer} autoPayId="cmd-4" />);
    payer = ready();
    renderToStaticMarkup(<EvidenceCard offer={{ ...offer, available: false, url: null }} autoPayId="cmd-5" />);
    expect(payFor).not.toHaveBeenCalled();
  });
});
