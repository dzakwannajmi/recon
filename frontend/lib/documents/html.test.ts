import { describe, expect, it } from "vitest";
import { scanHtml } from "./html";

describe("scanHtml", () => {
  it("returns visible text with block elements on their own lines", () => {
    const html = `<!DOCTYPE html><html><head><title>Fund</title><style>p{color:red}</style><script>var a = "<p>no</p>";</script></head>
      <body><!-- hidden --><h1>Fund &amp; facts</h1><p>NAV is <b>1.00</b>&nbsp;per share.</p><table><tr><td>A</td><td>B</td></tr></table>
      <noscript>enable js</noscript><svg><text>logo</text></svg></body></html>`;
    expect(scanHtml(html).text).toBe("Fund\nFund & facts\nNAV is 1.00 per share.\nA B");
  });

  it("collects links with their labels and decoded hrefs", () => {
    const { links } = scanHtml(`<a href="/a.pdf?x=1&amp;y=2">Annual <b>report</b></a> <A HREF='b.html'>B</A><a name="x">no href</a><a href=c.pdf>C`);
    expect(links).toEqual([
      { href: "/a.pdf?x=1&y=2", label: "Annual report" },
      { href: "b.html", label: "B" },
      { href: "c.pdf", label: "C" },
    ]);
  });

  it("treats a stray < as text and stops at an unterminated tag", () => {
    expect(scanHtml("1 < 2 and 3 <b>bold</b> <div unterminated").text).toBe("1 < 2 and 3 bold");
  });

  it("does not leak script content when the close tag has odd casing or spacing", () => {
    expect(scanHtml("<SCRIPT>secret()</Script >after").text).toBe("after");
    expect(scanHtml("<script>never closed").text).toBe("");
  });
});
