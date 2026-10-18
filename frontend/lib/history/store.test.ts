import { describe, expect, it } from "vitest";
import type { Db } from "./store";
import { appendMessages, createSession, deleteMyData, listEvidence, listSessions, loadMessages, renameSession, saveEvidence, setPinned } from "./store";

type Call = { table: string; ops: [string, unknown[]][] };

/** A chainable stand-in for the Supabase query builder: records every call, answers with `result`, never touches the network. */
function fake(result: { data?: unknown; error?: unknown } = { data: [], error: null }) {
  const calls: Call[] = [];
  const db = {
    from(table: string) {
      const call: Call = { table, ops: [] };
      calls.push(call);
      const chain: unknown = new Proxy(() => {}, {
        get: (_t, op: string) => {
          if (op === "then") return (res: (v: unknown) => void) => res({ data: null, error: null, ...result });
          return (...args: unknown[]) => {
            call.ops.push([op, args]);
            return chain;
          };
        },
      });
      return chain;
    },
  } as unknown as Db;
  return { db, calls };
}

const G = "GBHNGLLIE3KWGKCHIKMHJ5HVZHYIK7WTBE4QF5PLAKL4CJGSEU7HZIW5";

describe("deleteMyData", () => {
  it("deletes this user's saved evidence and chats (messages follow by cascade), scoped by user id", async () => {
    const { db, calls } = fake();
    await deleteMyData(db, "u1");
    expect(calls.map((c) => c.table)).toEqual(["paid_evidence", "chat_sessions"]);
    for (const c of calls) expect(c.ops).toEqual([["delete", []], ["eq", ["user_id", "u1"]]]);
  });

  it("throws when a delete fails", async () => {
    await expect(deleteMyData(fake({ error: { message: "x" } }).db, "u1")).rejects.toThrow("Could not delete your data.");
  });
});

describe("chats", () => {
  it("creates a chat with the user id, a title from the first message, and the model", async () => {
    const { db, calls } = fake();
    await createSession(db, "u1", "s1", [{ role: "user", text: "Check USTRY" }, { role: "agent", text: "ok" }], "fast");
    expect(calls[0]).toEqual({ table: "chat_sessions", ops: [["insert", [{ id: "s1", user_id: "u1", title: "Check USTRY", model: "fast" }]]] });
  });

  it("appends messages with the owner's id, skips error messages, and bumps updated_at", async () => {
    const { db, calls } = fake();
    await appendMessages(db, "u1", "s1", [
      { id: "m1", message: { role: "user", text: "hi" } },
      { id: "m2", message: { role: "agent", text: "boom", error: true } },
      { id: "m3", message: { role: "agent", text: "answer" } },
    ]);
    expect(calls[0].table).toBe("chat_messages");
    const rows = calls[0].ops[0][1][0] as { id: string; user_id: string; session_id: string }[];
    expect(rows.map((r) => r.id)).toEqual(["m1", "m3"]);
    expect(rows.every((r) => r.user_id === "u1" && r.session_id === "s1")).toBe(true);
    expect(calls[1].table).toBe("chat_sessions");
    expect(calls[1].ops.map((o) => o[0])).toEqual(["update", "eq"]);
  });

  it("writes nothing when every message is skipped", async () => {
    const { db, calls } = fake();
    await appendMessages(db, "u1", "s1", [{ id: "m", message: { role: "agent", text: "x", error: true } }]);
    expect(calls).toEqual([]);
  });

  it("loads messages in order and maps them", async () => {
    const { db } = fake({ data: [{ role: "user", text: "q", steps: null }, { role: "bogus", text: "x" }, { role: "agent", text: "a", steps: null }] });
    expect(await loadMessages(db, "s1")).toEqual([{ role: "user", text: "q" }, { role: "agent", text: "a" }]);
  });
});

describe("evidence", () => {
  it("upserts on the unique key and ignores a repeat of the same settlement", async () => {
    const { db, calls } = fake();
    const row = { user_id: "u1", asset_code: "USTRY", issuer: G, bundle: {}, settlement_tx: "ab" };
    await saveEvidence(db, row);
    expect(calls[0].ops).toEqual([["upsert", [row, { onConflict: "user_id,asset_code,issuer,settlement_tx", ignoreDuplicates: true }]]]);
  });

  it("filters a lookup by asset and issuer", async () => {
    const { db, calls } = fake();
    await listEvidence(db, { assetCode: "USTRY", issuer: G });
    const ops = calls[0].ops.map((o) => o[0]);
    expect(ops).toEqual(["select", "eq", "eq", "order", "limit"]);
    expect(calls[0].ops[1][1]).toEqual(["asset_code", "USTRY"]);
  });
});

describe("rename and pin", () => {
  it("renames with a cleaned title, scoped by the chat id", async () => {
    const { db, calls } = fake();
    await renameSession(db, "s1", "  My   chat \n name ");
    expect(calls[0]).toEqual({ table: "chat_sessions", ops: [["update", [{ title: "My chat name" }]], ["eq", ["id", "s1"]]] });
  });

  it("refuses an empty title without calling the database", async () => {
    const { db, calls } = fake();
    await expect(renameSession(db, "s1", "   ")).rejects.toThrow("Could not rename the chat.");
    expect(calls).toHaveLength(0);
  });

  it("pins and unpins", async () => {
    const { db, calls } = fake();
    await setPinned(db, "s1", true);
    await setPinned(db, "s1", false);
    expect(calls.map((c) => c.ops[0])).toEqual([["update", [{ pinned: true }]], ["update", [{ pinned: false }]]]);
  });

  it("lists pinned chats first, then the newest", async () => {
    const { db, calls } = fake();
    await listSessions(db);
    expect(calls[0].ops.filter(([op]) => op === "order")).toEqual([["order", ["pinned", { ascending: false }]], ["order", ["updated_at", { ascending: false }]]]);
  });

  it("a failed update is an error", async () => {
    await expect(setPinned(fake({ error: { message: "x" } }).db, "s1", true)).rejects.toThrow("Could not pin the chat.");
  });
});
