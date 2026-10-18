import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(path.join(__dirname, "../../../supabase/migrations/001_init.sql"), "utf8");
const tables = [...sql.matchAll(/create table public\.(\w+)/g)].map((m) => m[1]);

describe("001_init.sql", () => {
  it("creates the three tables", () => {
    expect(tables).toEqual(["chat_sessions", "chat_messages", "paid_evidence"]);
  });

  it.each(tables)("%s has row level security enabled and owner-only policies for every command", (t) => {
    expect(sql).toContain(`alter table public.${t} enable row level security;`);
    const policies = [...sql.matchAll(new RegExp(`create policy "[^"]+" on public\\.${t} for (\\w+) to authenticated\\s+([^;]+);`, "g"))];
    expect(policies.map((p) => p[1]).sort()).toEqual(["delete", "insert", "select", "update"]);
    for (const p of policies) expect(p[2]).toContain("auth.uid() = user_id");
  });

  it("has no public read: no policy for anon or public, and anon is revoked", () => {
    expect(sql).not.toMatch(/to\s+(anon|public)\b/i);
    expect(sql).not.toMatch(/using\s*\(\s*true\s*\)/i);
    expect(sql).toMatch(/revoke all on [^;]*from anon;/);
  });

  it("only lets a message join a session the same user owns", () => {
    expect(sql).toMatch(/exists \(select 1 from public\.chat_sessions s where s\.id = session_id and s\.user_id = auth\.uid\(\)\)/);
  });

  it("cascades from the user and from the session", () => {
    expect(sql.match(/references auth\.users \(id\) on delete cascade/g)).toHaveLength(3);
    expect(sql).toContain("references public.chat_sessions (id) on delete cascade");
  });

  it("enforces the size caps and the unique key", () => {
    expect(sql).toContain("between 1 and 4000");
    expect(sql).toContain("octet_length(steps::text) <= 200000");
    expect(sql).toContain("octet_length(bundle::text) <= 1000000");
    expect(sql).toContain("unique (user_id, asset_code, issuer, settlement_tx)");
    expect(sql).toContain("role in ('user', 'agent')");
  });

  it("uses no service role and no function that bypasses row level security", () => {
    expect(sql).not.toMatch(/service_role|security definer|bypassrls/i);
  });
});
