import { parseMarkdown, type Block, type Inline } from "@/components/chat/markdown-parse";

/** Plain text of an inline run: link labels without their URLs, code as written. */
function inlineText(nodes: Inline[]): string {
  return nodes
    .map((n) => {
      switch (n.t) {
        case "text":
        case "code":
          return n.text;
        case "br":
          return " ";
        default:
          return inlineText(n.children);
      }
    })
    .join("");
}

function blockText(blocks: Block[], out: string[]) {
  for (const b of blocks) {
    switch (b.t) {
      case "heading":
      case "p":
        out.push(inlineText(b.children));
        break;
      case "quote":
        blockText(b.blocks, out);
        break;
      case "list":
        for (const item of b.items) blockText(item, out);
        break;
      default:
        // Fenced code and rules are not read aloud.
        break;
    }
  }
}

/** Longest reply read aloud; a longer one is cut at a word boundary. The full text stays on screen. */
export const MAX_SPOKEN_CHARS = 1500;

/** Markdown from the agent as plain text for speechSynthesis: no symbols, no URLs, no code blocks. */
export function markdownToSpeech(markdown: string): string {
  const parts: string[] = [];
  blockText(parseMarkdown(markdown), parts);
  const text = parts.map((p) => p.replace(/\s+/g, " ").trim()).filter(Boolean).join(". ").replace(/([.!?:;])\.(\s|$)/g, "$1$2");
  if (text.length <= MAX_SPOKEN_CHARS) return text;
  const cut = text.slice(0, MAX_SPOKEN_CHARS);
  return cut.slice(0, Math.max(cut.lastIndexOf(" "), 1)).trimEnd();
}

/** Splits text into sentence-sized pieces so one long utterance cannot stall (some browsers stop after about 15 seconds). */
export function splitForSpeech(text: string, max = 220): string[] {
  const sentences = text.match(/[^.!?]+[.!?]*\s*/g) ?? [text];
  const chunks: string[] = [];
  let cur = "";
  for (const s of sentences) {
    if (cur && cur.length + s.length > max) {
      chunks.push(cur.trim());
      cur = "";
    }
    cur += s;
    while (cur.length > max) {
      const at = cur.lastIndexOf(" ", max);
      const i = at > 0 ? at : max;
      chunks.push(cur.slice(0, i).trim());
      cur = cur.slice(i);
    }
  }
  if (cur.trim()) chunks.push(cur.trim());
  return chunks.filter(Boolean);
}
