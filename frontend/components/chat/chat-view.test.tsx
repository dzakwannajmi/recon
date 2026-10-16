import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ChatView } from "./chat-view";
import { EXAMPLES, type Message } from "./types";

const render = (props: Partial<React.ComponentProps<typeof ChatView>> = {}) =>
  renderToStaticMarkup(
    <ChatView messages={[]} thinking={false} ready onPick={() => {}} composer={<div id="slot">composer</div>} {...props} />
  );

describe("ChatView", () => {
  it("shows the example prompts as chips and the composer slot when empty", () => {
    const out = render();
    for (const e of EXAMPLES) expect(out).toContain(e.replace("'", "&#x27;"));
    expect(out).toContain('id="slot"');
    expect(out).toContain("Agent ready");
  });

  it("disables the chips and shows the key hint when not ready", () => {
    const out = render({ ready: false });
    expect(out).toContain("Add your API key to start.");
    expect(out).toContain("Agent not ready");
    expect(out).toContain("disabled");
  });

  it("renders a user message and an agent answer as markdown, without the empty state", () => {
    const messages: Message[] = [
      { role: "user", text: "check USTRY" },
      { role: "agent", text: "**USTRY** is fine.", steps: [{ tool: "get_asset_status", args: {}, result: {} }], elapsed: 3 },
    ];
    const out = render({ messages });
    expect(out).toContain("check USTRY");
    expect(out).toMatch(/<strong[^>]*>USTRY<\/strong>/);
    expect(out).toContain("get_asset_status");
    expect(out).not.toContain(EXAMPLES[0]);
  });

  it("shows the working line while thinking", () => {
    const out = render({ messages: [{ role: "user", text: "hi" }], thinking: true });
    expect(out).toContain("Working");
  });

  it("keeps agent text inert and renders in compact mode with the header actions", () => {
    const out = render({ compact: true, headerActions: <button>act</button>, messages: [{ role: "agent", text: "<script>x</script>" }] });
    expect(out).not.toContain("<script");
    expect(out).toContain("act");
  });

  it("puts a brand slot in the header and the column classes around the messages and composer", () => {
    const out = render({ brand: <a href="/" aria-label="Back to home">home</a>, column: "max-w-[760px]" });
    expect(out).toContain('aria-label="Back to home"');
    expect(out).not.toContain("/logo-mark.svg");
    expect(out.match(/max-w-\[760px\]/g)?.length).toBe(2);
  });
});
