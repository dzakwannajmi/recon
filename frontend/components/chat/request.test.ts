import { describe, expect, it } from "vitest";
import { agentRequestBody } from "./request";
import type { Message } from "./types";

const BUNDLE_MARK = "ISSUER-QUOTE-FROM-PAID-BUNDLE";

describe("agentRequestBody", () => {
  it("sends only role and text, never steps, bundles or extras", () => {
    const messages = [
      { role: "user", text: "check USTRY" },
      {
        role: "agent",
        text: "Here is the result.",
        steps: [{ tool: "get_evidence_bundle", args: {}, result: { premium: true, quote: BUNDLE_MARK } }],
        // Fields a saved or paid message could carry must not leak into the request either.
        bundle: { quote: BUNDLE_MARK },
        raw: BUNDLE_MARK,
        autoPayId: "x",
      },
      { role: "user", text: "and again" },
    ] as unknown as Message[];
    const body = agentRequestBody(messages, "fast");
    expect(body).not.toContain(BUNDLE_MARK);
    expect(JSON.parse(body)).toEqual({
      messages: [{ role: "user", text: "check USTRY" }, { role: "agent", text: "Here is the result." }, { role: "user", text: "and again" }],
      model: "fast",
    });
  });

  it("drops error messages and omits the model when none is chosen", () => {
    const body = JSON.parse(agentRequestBody([{ role: "user", text: "a" }, { role: "agent", text: "boom", error: true }]));
    expect(body).toEqual({ messages: [{ role: "user", text: "a" }] });
  });
});
