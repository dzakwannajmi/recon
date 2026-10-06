/**
 * Test helpers: a fake HTTP transport so tests never touch the network.
 */
import type { HttpResponse, Transport } from "./http";

export type FakeRoute = { status?: number; body?: string; headers?: Record<string, string> };

/** Serve fixed responses by exact URL; anything else is a 404. `calls` records every requested URL. */
export function fakeTransport(routes: Record<string, FakeRoute>) {
  const calls: string[] = [];
  const transport: Transport = async (url) => {
    calls.push(url.toString());
    const route = routes[url.toString()];
    const res = route
      ? new Response(route.body ?? null, { status: route.status ?? 200, headers: route.headers })
      : new Response("not found", { status: 404 });
    return res as unknown as HttpResponse;
  };
  return { transport, calls };
}
