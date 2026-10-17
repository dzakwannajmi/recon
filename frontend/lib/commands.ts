/**
 * Slash commands the user types (spec: chat commands). Pure and shared by the page and the server.
 *
 * Each command runs a chat tool directly, with no model. `/evidence` only looks up whether paid detail exists (the
 * tool moves no money); the payment itself is started by the page's own code, and only for text the user typed
 * (golden rule 1, lib/browser-payer/auto.ts). Everything here is an allowlist: a command name that is not listed is
 * not a command, and the asset code is checked with the same rule the tools use.
 */

export const COMMANDS = ["status", "flags", "claims", "check", "evidence"] as const;
export type Command = (typeof COMMANDS)[number];
export type TypedCommand = { command: Command; code: string };

/** The tool each command runs. `/flags` reads the same stored status as `/status`. */
export const COMMAND_TOOL: Record<Command, string> = {
  status: "get_asset_status",
  flags: "get_asset_status",
  claims: "get_verified_claims",
  check: "check_asset",
  evidence: "get_evidence_bundle",
};

/** The same rule as isAssetCode (lib/chain/validate.ts), kept here so the page does not load the Stellar SDK for it. */
const CODE = /^[A-Za-z0-9]{1,12}$/;
const isAssetCode = (v: unknown): v is string => typeof v === "string" && CODE.test(v);

const TYPED = /^\/(status|flags|claims|check|evidence)[ \t]+([A-Za-z0-9]{1,12})$/;

/** `/status USTRY` and the like, exactly: one command, one asset code, nothing else. Anything else is plain text for the model. */
export function parseTyped(text: string): TypedCommand | null {
  const m = TYPED.exec(text.trim());
  return m ? { command: m[1] as Command, code: m[2] } : null;
}

/** What POST /api/command accepts: a command name from the allowlist and a valid asset code. Nothing else. */
export function parseCommandBody(body: unknown): TypedCommand | null {
  if (body === null || typeof body !== "object" || Array.isArray(body)) return null;
  const { command, code } = body as { command?: unknown; code?: unknown };
  if (typeof command !== "string" || !(COMMANDS as readonly string[]).includes(command)) return null;
  if (!isAssetCode(code)) return null;
  return { command: command as Command, code };
}

const obj = (v: unknown): Record<string, unknown> => (v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const str = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export const NO_MODEL_NOTE = "No model was used for this command.";

/**
 * A short plain-text line or two for a command, computed from the tool result. Flag statements and statuses
 * are relayed as stored; issuer quotes are not repeated here (they stay in the collapsed tool result).
 */
export function summarize(command: Command, code: string, result: unknown): string {
  const r = obj(result);
  const error = str(r.error);
  if (error) return `${error} ${NO_MODEL_NOTE}`;
  const body = ((): string => {
    if (command === "status" || command === "flags") {
      if (r.found !== true) return str(r.note) ?? `No stored status for ${code}.`;
      const assets = Array.isArray(r.assets) ? r.assets.map(obj) : [];
      return assets
        .map((a) => {
          const flags = Array.isArray(a.raised_flags) ? a.raised_flags.map(obj) : [];
          const head = `${str(a.code) ?? code}: stored status ${str(a.status) ?? "none yet"} as of ${str(a.as_of) ?? "an unknown date"}.`;
          if (command === "status") return `${head} ${plural(flags.length, "flag")} raised, ${plural(Number(a.not_evaluated_count) || 0, "check")} not evaluated.`;
          if (flags.length === 0) return `${head} No flags are raised.`;
          return [head, ...flags.map((f) => `- ${str(f.statement) ?? str(f.code) ?? "flag"} (as of ${str(f.as_of) ?? "an unknown date"})`)].join("\n");
        })
        .join("\n\n");
    }
    if (command === "evidence") {
      return r.available === true
        ? `Paid evidence exists for ${code}. The card below unlocks it with your own testnet wallet; the model does not pay and does not see the evidence.`
        : `Paid evidence is not available for ${code} right now.`;
    }
    if (command === "claims") {
      const total = Number(r.total_matching) || 0;
      const returned = Number(r.returned) || 0;
      if (total === 0) return `No verified claims are on file for ${code}.`;
      return `${plural(total, "verified claim")} on file for ${code}${returned < total ? ` (showing ${returned})` : ""}. Open the tool result for the quotes and sources.`;
    }
    const checked = Array.isArray(r.checked) ? r.checked.length : null;
    if (checked !== null) return `Checked ${code} on Stellar mainnet (read only): ${plural(Number(r.issuers_seen) || 0, "issuer")} seen, ${checked} checked. Open the tool result for each issuer's status.`;
    return `Checked ${code} on Stellar mainnet (read only). Open the tool result for the details.`;
  })();
  return `${body}\n\n${NO_MODEL_NOTE}`;
}
