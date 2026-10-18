import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const getUser = vi.fn();
vi.mock("@supabase/ssr", () => ({ createServerClient: () => ({ auth: { getUser } }) }));

const req = (path: string, cookie?: string) => new NextRequest(`http://localhost${path}`, cookie ? { headers: { cookie } } : undefined);
const setUp = () => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://abc.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon");
};

async function run(r: NextRequest) {
  vi.resetModules();
  return (await import("./proxy")).proxy(r);
}

describe("proxy: fact sheets need a signed-in user when sign-in is required", () => {
  beforeEach(() => getUser.mockReset());
  afterEach(() => vi.unstubAllEnvs());

  it("sends a visitor without a session from a fact sheet page to /login", async () => {
    setUp();
    getUser.mockResolvedValue({ data: { user: null }, error: { message: "no session" } });
    for (const path of ["/en/assets", "/en/assets/BB1", "/id/assets/USTRY"]) {
      const res = await run(req(path));
      expect(res.status, path).toBe(307);
      expect(new URL(res.headers.get("location")!).pathname).toBe("/login");
    }
  });

  it("lets a signed-in user through", async () => {
    setUp();
    getUser.mockResolvedValue({ data: { user: { id: "u" } }, error: null });
    const res = await run(req("/en/assets/BB1", "sb-abc-auth-token=x"));
    expect(res.status).toBe(200);
  });

  it("leaves the landing page, /login, /privacy and /agent alone without looking up a user", async () => {
    setUp();
    for (const path of ["/", "/login", "/privacy", "/agent"]) expect((await run(req(path))).status, path).toBe(200);
    expect(getUser).not.toHaveBeenCalled();
  });

  it("does not gate when AUTH_REQUIRED is false or sign-in is not set up", async () => {
    setUp();
    vi.stubEnv("AUTH_REQUIRED", "false");
    expect((await run(req("/en/assets/BB1"))).status).toBe(200);
    vi.stubEnv("AUTH_REQUIRED", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    expect((await run(req("/en/assets/BB1"))).status).toBe(200);
    expect(getUser).not.toHaveBeenCalled();
  });
});
