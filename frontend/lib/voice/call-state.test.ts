import { describe, expect, it } from "vitest";
import { CLOSED, callReducer, wantsMic, type CallEvent, type CallState } from "./call-state";

const run = (events: CallEvent[], from: CallState = CLOSED) => events.reduce(callReducer, from);

describe("call state machine", () => {
  it("starts closed and idle", () => {
    expect(CLOSED.open).toBe(false);
    expect(wantsMic(CLOSED)).toBe(false);
  });

  it("opens idle and asks for the mic", () => {
    const s = run([{ type: "open" }]);
    expect(s).toMatchObject({ open: true, phase: "idle", error: null });
    expect(wantsMic(s)).toBe(true);
  });

  it("goes idle -> listening -> thinking -> speaking -> idle", () => {
    let s = run([{ type: "open" }, { type: "mic_on" }]);
    expect(s.phase).toBe("listening");
    expect(wantsMic(s)).toBe(false);
    s = run([{ type: "interim", text: "check ust" }], s);
    expect(s.transcript).toBe("check ust");
    s = run([{ type: "heard", text: "check USTRY" }], s);
    expect(s).toMatchObject({ phase: "thinking", transcript: "check USTRY" });
    expect(wantsMic(s)).toBe(false);
    s = run([{ type: "answered", text: "It is OK." }], s);
    expect(s).toMatchObject({ phase: "speaking", reply: "It is OK." });
    s = run([{ type: "spoken" }], s);
    expect(s.phase).toBe("idle");
    expect(wantsMic(s)).toBe(true);
  });

  it("strips the wake words and keeps listening if nothing else was said", () => {
    let s = run([{ type: "open" }, { type: "mic_on" }, { type: "heard", text: "Hey Recon" }]);
    expect(s.phase).toBe("listening");
    s = run([{ type: "mic_off" }], s);
    expect(s.phase).toBe("idle");
    s = run([{ type: "mic_on" }, { type: "heard", text: "hey recon, what can you check?" }], s);
    expect(s).toMatchObject({ phase: "thinking", transcript: "what can you check?" });
  });

  it("returns to idle after a recoverable error and listens again", () => {
    const s = run([{ type: "open" }, { type: "mic_on" }, { type: "heard", text: "hi" }, { type: "fail", message: "Too many messages.", fatal: false }]);
    expect(s).toMatchObject({ phase: "idle", error: "Too many messages.", fatal: false });
    expect(wantsMic(s)).toBe(true);
    const next = run([{ type: "mic_on" }, { type: "heard", text: "hello" }], s);
    expect(next.error).toBeNull();
  });

  it("keeps the mic closed after a fatal error", () => {
    const s = run([{ type: "open" }, { type: "fail", message: "The microphone is blocked.", fatal: true }]);
    expect(s.fatal).toBe(true);
    expect(wantsMic(s)).toBe(false);
    expect(run([{ type: "mic_on" }], s).phase).toBe("idle");
  });

  it("ignores events that do not fit the phase", () => {
    const open = run([{ type: "open" }]);
    expect(run([{ type: "answered", text: "x" }], open)).toBe(open);
    expect(run([{ type: "heard", text: "x" }], open)).toBe(open);
    expect(run([{ type: "spoken" }], open)).toBe(open);
  });

  it("ignores everything once closed, including a late answer", () => {
    const thinking = run([{ type: "open" }, { type: "mic_on" }, { type: "heard", text: "hi" }]);
    const closed = run([{ type: "close" }], thinking);
    expect(closed).toEqual(CLOSED);
    expect(run([{ type: "answered", text: "late" }, { type: "mic_on" }], closed)).toEqual(CLOSED);
  });
});
