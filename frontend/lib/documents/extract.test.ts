import { describe, expect, it } from "vitest";
import { PAGE_BREAK, detectKind, extractText, htmlToText } from "./extract";

const enc = (s: string) => new TextEncoder().encode(s);

/** A minimal valid PDF with one text line per page. */
function makePdf(pages: string[]) {
  const objects: string[] = [];
  const kids = pages.map((_, i) => `${3 + i * 2} 0 R`).join(" ");
  const font = 3 + pages.length * 2;
  objects.push("<< /Type /Catalog /Pages 2 0 R >>");
  objects.push(`<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`);
  pages.forEach((text, i) => {
    const stream = `BT /F1 12 Tf 20 100 Td (${text}) Tj ET`;
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] /Contents ${4 + i * 2} 0 R /Resources << /Font << /F1 ${font} 0 R >> >> >>`);
    objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  });
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  let body = "%PDF-1.4\n";
  const offsets = objects.map((obj, i) => {
    const offset = body.length;
    body += `${i + 1} 0 obj\n${obj}\nendobj\n`;
    return offset;
  });
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  body += offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("");
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return enc(body);
}

describe("detectKind", () => {
  it("uses magic bytes first, then the content type", () => {
    expect(detectKind(enc("%PDF-1.7 ..."), "application/octet-stream")).toBe("pdf");
    expect(detectKind(enc("<!DOCTYPE html><html>"), "")).toBe("html");
    expect(detectKind(enc('<?xml version="1.0"?><a/>'), "")).toBe("xml");
    expect(detectKind(enc("plain"), "text/plain; charset=utf-8")).toBe("text");
  });

  it("refuses images, including SVG", () => {
    expect(detectKind(enc("\x89PNG"), "image/png")).toBeNull();
    expect(detectKind(enc("<svg xmlns='http://www.w3.org/2000/svg'/>"), "image/svg+xml")).toBeNull();
    expect(detectKind(enc("<svg/>"), "")).toBeNull();
  });
});

describe("htmlToText", () => {
  it("keeps visible text and drops scripts, styles, comments, and the doctype", () => {
    const html = `<!DOCTYPE html><html><head><style>.a{}</style><script>var x = "secret";</script></head>
      <body><!-- hidden --><h1>Fund   facts</h1><p>NAV is <b>1.00</b> per share.</p><noscript>enable js</noscript></body></html>`;
    expect(htmlToText(html)).toBe("Fund facts\nNAV is 1.00 per share.");
  });

  it("is deterministic for the same input", () => {
    const html = "<div><p>a</p><p>b</p></div>";
    expect(htmlToText(html)).toBe(htmlToText(html));
  });
});

describe("extractText", () => {
  it("extracts PDF text per page, separated by a form feed", async () => {
    const r = await extractText(makePdf(["Shares outstanding 100", "Net assets 100"]), "application/pdf");
    expect(r?.kind).toBe("pdf");
    expect(r?.pages).toBe(2);
    expect(r?.value.split(PAGE_BREAK).map((p) => p.trim())).toEqual(["Shares outstanding 100", "Net assets 100"]);
  });

  it("keeps XML as is and returns null for unsupported types", async () => {
    expect((await extractText(enc("<?xml version='1.0'?><n>1</n>"), "application/xml"))?.value).toBe("<?xml version='1.0'?><n>1</n>");
    expect(await extractText(enc("GIF89a"), "image/gif")).toBeNull();
  });
});
