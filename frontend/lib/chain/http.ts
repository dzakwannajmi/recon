/**
 * Safe HTTP for chain data.
 *
 * Domains come from on-chain `home_domain` values, which anyone can set,
 * so they are untrusted input. Untrusted fetches:
 * - are https-only, to public DNS names (no IPs, localhost, .local, .internal);
 * - resolve DNS at connect time and refuse any non-public address (the checked
 *   IP is the one used, so a record can't be swapped between check and connect);
 * - follow a redirect only if the caller allows it, re-checking every hop;
 * - share one overall deadline and stop reading past a size cap.
 */
import dns from "node:dns";
import net from "node:net";
import { Agent, fetch as undiciFetch } from "undici";

const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 3;
const USER_AGENT = "recon-checker/0.1";

const DOMAIN_PATTERN = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:[a-z]{2,63}|xn--[a-z0-9-]{1,59})$/;
const BLOCKED_SUFFIXES = [".localhost", ".local", ".localdomain", ".internal", ".home.arpa", ".lan"];

/** A public DNS name like `www.example.com`: no scheme, port, path, IP literal, or local-only name. */
export function isSafeDomain(domain: string) {
  const d = domain.toLowerCase();
  return DOMAIN_PATTERN.test(d) && !BLOCKED_SUFFIXES.some((s) => d.endsWith(s));
}

/** Lowercase, strip a scheme, path, and trailing dot; return null unless the result is a safe domain. */
export function normalizeDomain(input: string | undefined | null) {
  if (!input) return null;
  const d = input.trim().toLowerCase().replace(/^[a-z][a-z0-9+.-]*:\/\//, "").split(/[/?#]/)[0].replace(/\.$/, "");
  return isSafeDomain(d) ? d : null;
}

/** True when `host` is `domain` itself or a subdomain of it (never a lookalike such as `domain.evil.com`). */
export function isSameOrSubdomain(host: string, domain: string) {
  const h = host.toLowerCase();
  const d = domain.toLowerCase();
  return h === d || h.endsWith(`.${d}`);
}

const blockList = new net.BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16],
  ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15],
  ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
] as const) blockList.addSubnet(address, prefix, "ipv4");
for (const [address, prefix] of [
  ["::", 128], ["::1", 128], ["fc00::", 7], ["fe80::", 10], ["ff00::", 8], ["64:ff9b::", 96], ["2001:db8::", 32],
] as const) blockList.addSubnet(address, prefix, "ipv6");

/** Loopback, private, link-local, CGNAT, multicast, reserved, or metadata addresses. IPv4-mapped IPv6 is checked as IPv4. */
export function isBlockedAddress(address: string) {
  const family = net.isIP(address);
  if (family === 0) return true;
  return blockList.check(address, family === 4 ? "ipv4" : "ipv6");
}

export class FetchError extends Error {}

type LookupCallback = (err: Error | null, address?: string | dns.LookupAddress[], family?: number) => void;

function publicOnlyLookup(hostname: string, options: { all?: boolean } | number | undefined, callback: LookupCallback) {
  dns.lookup(hostname, { all: true, verbatim: true }, (err, addresses) => {
    if (err) return callback(err);
    if (addresses.length === 0 || addresses.some((a) => isBlockedAddress(a.address))) {
      return callback(new FetchError(`${hostname} resolves to a non-public address.`));
    }
    if (typeof options === "object" && options?.all) return callback(null, addresses);
    callback(null, addresses[0].address, addresses[0].family);
  });
}

const publicOnlyAgent = new Agent({ connect: { lookup: publicOnlyLookup as never } });

export type HttpResponse = {
  status: number;
  ok: boolean;
  headers: { get(name: string): string | null };
  body: ReadableStream<Uint8Array> | null;
};
export type Transport = (url: URL, init: { redirect: "manual"; signal: AbortSignal; headers: Record<string, string> }) => Promise<HttpResponse>;

const defaultTransport: Transport = (url, init) =>
  undiciFetch(url, { ...init, dispatcher: publicOnlyAgent }) as unknown as Promise<HttpResponse>;

/** One deadline for the whole call, also ended by the caller's signal. */
export function deadline(timeoutMs: number, signal?: AbortSignal) {
  const timer = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timer]) : timer;
}

async function discard(res: HttpResponse) {
  await res.body?.cancel().catch(() => {});
}

async function readCapped(res: HttpResponse, maxBytes: number) {
  const declared = Number(res.headers.get("content-length") ?? 0);
  if (declared > maxBytes) {
    await discard(res);
    throw new FetchError(`Response is larger than ${maxBytes} bytes.`);
  }
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new FetchError(`Response is larger than ${maxBytes} bytes.`);
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

export type UntrustedFetchOptions = {
  maxBytes: number;
  timeoutMs?: number;
  signal?: AbortSignal;
  /** Decide whether a redirect from one host to another may be followed. Default: never. */
  allowRedirect?: (fromHost: string, toHost: string) => boolean;
  transport?: Transport;
};

/** GET a text resource on an untrusted domain. Returns the text and the final URL it came from. */
export async function fetchUntrustedText(url: string, opts: UntrustedFetchOptions) {
  const signal = deadline(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS, opts.signal);
  const transport = opts.transport ?? defaultTransport;
  let current = new URL(url);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (current.protocol !== "https:" || current.port || !isSafeDomain(current.hostname)) {
      throw new FetchError("Refusing to fetch: only https on public domain names is allowed.");
    }
    const res = await transport(current, { redirect: "manual", signal, headers: { "User-Agent": USER_AGENT } });
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      await discard(res);
      if (!location) throw new FetchError("Redirect without a location.");
      const next = new URL(location, current);
      if (!opts.allowRedirect?.(current.hostname, next.hostname)) throw new FetchError("Redirect to another site was refused.");
      current = next;
      continue;
    }
    if (!res.ok) {
      await discard(res);
      throw new FetchError(`HTTP ${res.status}.`);
    }
    return { text: await readCapped(res, opts.maxBytes), finalUrl: current.toString() };
  }
  throw new FetchError("Too many redirects.");
}

/** GET JSON from a fixed, trusted API (Horizon, StellarExpert). */
export async function fetchTrustedJson<T>(url: string, opts: { timeoutMs?: number; signal?: AbortSignal } = {}): Promise<T> {
  const res = await fetch(url, {
    signal: deadline(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS, opts.signal),
    headers: { "User-Agent": USER_AGENT },
  });
  if (!res.ok) {
    await res.body?.cancel().catch(() => {});
    if (res.status === 404) throw new FetchError("Not found.");
    throw new FetchError(`HTTP ${res.status} from ${new URL(url).origin}.`);
  }
  return (await res.json()) as T;
}
