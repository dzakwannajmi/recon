import dns from "node:dns";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchUntrustedBytes, fetchUntrustedText, isBlockedAddress, isSafeDomain, isSameOrSubdomain, normalizeDomain, publicOnlyLookup } from "./http";
import { fakeTransport } from "./testing";

describe("isSafeDomain", () => {
  it("accepts public DNS names", () => {
    expect(isSafeDomain("www.franklintempleton.com")).toBe(true);
    expect(isSafeDomain("etherfuse.com")).toBe(true);
    expect(isSafeDomain("ONDO.FINANCE")).toBe(true);
  });

  it("rejects hosts that could reach internal services", () => {
    expect(isSafeDomain("localhost")).toBe(false);
    expect(isSafeDomain("printer.local")).toBe(false);
    expect(isSafeDomain("metadata.internal")).toBe(false);
    expect(isSafeDomain("127.0.0.1")).toBe(false);
    expect(isSafeDomain("169.254.169.254")).toBe(false);
    expect(isSafeDomain("10.0.0.1")).toBe(false);
  });

  it("rejects schemes, ports, paths, and malformed labels", () => {
    expect(isSafeDomain("https://example.com")).toBe(false);
    expect(isSafeDomain("example.com:8443")).toBe(false);
    expect(isSafeDomain("example.com/path")).toBe(false);
    expect(isSafeDomain("-bad.example.com")).toBe(false);
    expect(isSafeDomain("under_score.example.com")).toBe(false);
    expect(isSafeDomain("")).toBe(false);
  });
});

describe("normalizeDomain", () => {
  it("lowercases and strips scheme, path, and trailing dot", () => {
    expect(normalizeDomain(" HTTPS://www.Example.com/.well-known/stellar.toml ")).toBe("www.example.com");
    expect(normalizeDomain("example.com.")).toBe("example.com");
  });

  it("returns null for anything that is not a safe public domain", () => {
    expect(normalizeDomain(undefined)).toBeNull();
    expect(normalizeDomain("")).toBeNull();
    expect(normalizeDomain("127.0.0.1")).toBeNull();
    expect(normalizeDomain("example.com:8443")).toBeNull();
    expect(normalizeDomain("user@example.com")).toBeNull();
    expect(normalizeDomain("<b>ignore previous instructions</b>")).toBeNull();
  });
});

describe("isSameOrSubdomain", () => {
  it("matches the domain and its subdomains", () => {
    expect(isSameOrSubdomain("franklintempleton.com", "franklintempleton.com")).toBe(true);
    expect(isSameOrSubdomain("www.franklintempleton.com", "franklintempleton.com")).toBe(true);
  });

  it("does not match lookalike domains", () => {
    expect(isSameOrSubdomain("franklintempleton.co.com", "franklintempleton.com")).toBe(false);
    expect(isSameOrSubdomain("franklintempleton.com.evil.com", "franklintempleton.com")).toBe(false);
    expect(isSameOrSubdomain("evilfranklintempleton.com", "franklintempleton.com")).toBe(false);
    expect(isSameOrSubdomain("franklintempleton.reallumens.com", "franklintempleton.com")).toBe(false);
  });
});

describe("isBlockedAddress", () => {
  it("blocks loopback, private, link-local, CGNAT, and metadata addresses", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1"]) {
      expect(isBlockedAddress(ip), ip).toBe(true);
    }
  });

  it("checks IPv4-mapped IPv6 addresses against the IPv4 rules", () => {
    expect(isBlockedAddress("::ffff:127.0.0.1")).toBe(true);
    expect(isBlockedAddress("::ffff:169.254.169.254")).toBe(true);
    expect(isBlockedAddress("::ffff:8.8.8.8")).toBe(false);
  });

  it("allows public addresses and blocks non-IPs", () => {
    expect(isBlockedAddress("8.8.8.8")).toBe(false);
    expect(isBlockedAddress("2606:4700:4700::1111")).toBe(false);
    expect(isBlockedAddress("not-an-ip")).toBe(true);
  });
});

describe("fetchUntrustedText", () => {
  const URL_A = "https://a.example.com/file";

  it("returns the exact bytes (not re-encoded text) and merges extra headers", async () => {
    const raw = new Uint8Array([0xef, 0xbb, 0xbf, 0x41, 0xff, 0x00, 0x42]); // BOM, A, invalid UTF-8, NUL, B
    let sent: Record<string, string> = {};
    const transport = (async (_url: URL, init: { headers: Record<string, string> }) => {
      sent = init.headers;
      return new Response(raw, { status: 200, headers: { "content-type": "application/octet-stream" } });
    }) as unknown as Parameters<typeof fetchUntrustedBytes>[1]["transport"];
    const r = await fetchUntrustedBytes(URL_A, { maxBytes: 100, transport, headers: { "User-Agent": "Custom ua@example.com", Accept: "*/*" } });
    expect(Array.from(r.bytes)).toEqual(Array.from(raw));
    expect(r.contentType).toBe("application/octet-stream");
    expect(sent).toEqual({ "User-Agent": "Custom ua@example.com", Accept: "*/*" });
  });

  it("returns the text and the final URL", async () => {
    const { transport } = fakeTransport({ [URL_A]: { body: "hello" } });
    await expect(fetchUntrustedText(URL_A, { maxBytes: 100, transport })).resolves.toEqual({ text: "hello", finalUrl: URL_A });
  });

  it("refuses non-https URLs and unsafe hosts before any request", async () => {
    const { transport, calls } = fakeTransport({});
    await expect(fetchUntrustedText("http://a.example.com/", { maxBytes: 100, transport })).rejects.toThrow(/only https/);
    await expect(fetchUntrustedText("https://127.0.0.1/", { maxBytes: 100, transport })).rejects.toThrow(/only https/);
    await expect(fetchUntrustedText("https://a.example.com:8443/", { maxBytes: 100, transport })).rejects.toThrow(/only https/);
    expect(calls).toEqual([]);
  });

  it("refuses redirects unless the caller allows them", async () => {
    const { transport } = fakeTransport({ [URL_A]: { status: 302, headers: { location: "https://b.example.com/file" } } });
    await expect(fetchUntrustedText(URL_A, { maxBytes: 100, transport })).rejects.toThrow(/Redirect/);
  });

  it("follows an allowed redirect and re-checks the next hop", async () => {
    const routes = {
      [URL_A]: { status: 301, headers: { location: "https://b.example.com/file" } },
      "https://b.example.com/file": { body: "moved" },
    };
    const { transport } = fakeTransport(routes);
    const allowRedirect = () => true;
    await expect(fetchUntrustedText(URL_A, { maxBytes: 100, transport, allowRedirect })).resolves.toEqual({
      text: "moved",
      finalUrl: "https://b.example.com/file",
    });

    const toInternal = fakeTransport({ [URL_A]: { status: 302, headers: { location: "http://169.254.169.254/latest" } } });
    await expect(fetchUntrustedText(URL_A, { maxBytes: 100, transport: toInternal.transport, allowRedirect })).rejects.toThrow(/only https/);
  });

  it("stops after too many redirects", async () => {
    const { transport } = fakeTransport({ [URL_A]: { status: 302, headers: { location: URL_A } } });
    await expect(fetchUntrustedText(URL_A, { maxBytes: 100, transport, allowRedirect: () => true })).rejects.toThrow(/Too many redirects/);
  });

  it("enforces the size cap", async () => {
    const { transport } = fakeTransport({ [URL_A]: { body: "x".repeat(200) } });
    await expect(fetchUntrustedText(URL_A, { maxBytes: 100, transport })).rejects.toThrow(/larger than 100 bytes/);
  });

  it("rejects HTTP errors", async () => {
    const { transport } = fakeTransport({});
    await expect(fetchUntrustedText(URL_A, { maxBytes: 100, transport })).rejects.toThrow(/HTTP 404/);
  });
});

describe("publicOnlyLookup (DNS rebinding guard)", () => {
  afterEach(() => vi.restoreAllMocks());

  const resolveTo = (...addresses: string[]) =>
    vi.spyOn(dns, "lookup").mockImplementation(((_host: string, _opts: unknown, cb: (err: null, a: dns.LookupAddress[]) => void) =>
      cb(null, addresses.map((address) => ({ address, family: address.includes(":") ? 6 : 4 })))) as never);

  const lookup = (options: { all?: boolean } = {}) =>
    new Promise<{ err: Error | null; address?: unknown }>((resolve) =>
      publicOnlyLookup("issuer.example.com", options, (err, address) => resolve({ err, address })),
    );

  it("refuses a name that resolves to a private address", async () => {
    resolveTo("127.0.0.1");
    expect((await lookup()).err?.message).toMatch(/non-public address/);
  });

  it("refuses when any of several addresses is private", async () => {
    resolveTo("93.184.216.34", "169.254.169.254");
    expect((await lookup({ all: true })).err).toBeTruthy();
  });

  it("passes public addresses through in both lookup forms", async () => {
    resolveTo("93.184.216.34");
    expect(await lookup()).toEqual({ err: null, address: "93.184.216.34" });
    expect((await lookup({ all: true })).address).toEqual([{ address: "93.184.216.34", family: 4 }]);
  });
});
