import { afterEach, describe, expect, it, vi } from "vitest";
import { authRequired, supabaseConfig } from "./config";
import { signInGate } from "./gate";
import { initialOf, toAuthUser } from "./user";

afterEach(() => vi.unstubAllEnvs());

const setUp = () => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://abc.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon");
};

describe("signInGate", () => {
  it("lets everyone through, without looking up a user, when AUTH_REQUIRED is false or sign-in is not set up", async () => {
    const lookup = vi.fn();
    setUp();
    vi.stubEnv("AUTH_REQUIRED", "false");
    expect(await signInGate(lookup)).toBeNull();
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("AUTH_REQUIRED", "true");
    expect(await signInGate(lookup)).toBeNull();
    expect(lookup).not.toHaveBeenCalled();
  });

  it("answers 401 with the sign-in message when it is on and nobody is signed in", async () => {
    setUp();
    const res = await signInGate(async () => null);
    expect(res?.status).toBe(401);
    expect(await res?.json()).toEqual({ error: "Sign in with GitHub to use the agent." });
    expect(res?.headers.get("Cache-Control")).toBe("no-store");
  });

  it("lets a signed-in user through", async () => {
    setUp();
    expect(await signInGate(async () => "user-1")).toBeNull();
  });

  it("fails closed when the lookup throws", async () => {
    setUp();
    const res = await signInGate(async () => {
      throw new Error("network");
    });
    expect(res?.status).toBe(401);
  });
});

describe("config", () => {
  it("authRequired is on when sign-in is set up, unless AUTH_REQUIRED is exactly false", () => {
    expect(authRequired()).toBe(false);
    setUp();
    expect(authRequired()).toBe(true);
    vi.stubEnv("AUTH_REQUIRED", "0");
    expect(authRequired()).toBe(true);
    vi.stubEnv("AUTH_REQUIRED", "false");
    expect(authRequired()).toBe(false);
  });

  it("supabaseConfig needs both public values and an https URL", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");
    expect(supabaseConfig()).toBeNull();
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://abc.supabase.co");
    expect(supabaseConfig()).toBeNull();
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon");
    expect(supabaseConfig()).toEqual({ url: "https://abc.supabase.co", anonKey: "anon" });
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://abc.supabase.co");
    expect(supabaseConfig()).toBeNull();
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "not a url");
    expect(supabaseConfig()).toBeNull();
  });
});

describe("toAuthUser", () => {
  it("needs an id and prefers the profile name, then the email", () => {
    expect(toAuthUser(null)).toBeNull();
    expect(toAuthUser({ id: "" })).toBeNull();
    expect(toAuthUser({ id: "u", email: "a@b.c", user_metadata: { full_name: "Ada L" } })).toEqual({ id: "u", label: "Ada L" });
    expect(toAuthUser({ id: "u", email: "a@b.c" })).toEqual({ id: "u", label: "a@b.c" });
    expect(toAuthUser({ id: "u" })).toEqual({ id: "u", label: "Account" });
    expect(toAuthUser({ id: "u", user_metadata: { name: "x".repeat(100) } })?.label).toHaveLength(60);
  });

  it("keeps the GitHub login and picture only when they look right", () => {
    const avatar = "https://avatars.githubusercontent.com/u/1?v=4";
    expect(toAuthUser({ id: "u", user_metadata: { user_name: "ada-l", avatar_url: avatar } })).toEqual({ id: "u", label: "ada-l", handle: "ada-l", avatarUrl: avatar });
    expect(toAuthUser({ id: "u", user_metadata: { name: "Ada", user_name: "bad name!", avatar_url: "https://evil.example/a.png" } })).toEqual({ id: "u", label: "Ada" });
    expect(toAuthUser({ id: "u", user_metadata: { avatar_url: "http://avatars.githubusercontent.com/u/1" } })).toEqual({ id: "u", label: "Account" });
    expect(toAuthUser({ id: "u", user_metadata: { avatar_url: "https://user:pw@avatars.githubusercontent.com/u/1" } })?.avatarUrl).toBeUndefined();
  });

  it("takes one uppercase initial", () => {
    expect(initialOf("ada")).toBe("A");
    expect(initialOf("")).toBe("?");
    expect(Object.keys(toAuthUser({ id: "u", user_metadata: { avatar_url: "https://x/y.png", name: "N" } })!)).toEqual(["id", "label"]);
  });
});
