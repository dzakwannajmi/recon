/**
 * The environment handed to the `stellar` child process. The CLI asks stellar-cli for the payer's
 * secret, so the child gets only what it needs to find its keystore, never the rest of the process
 * environment (API keys, the agent secret, X402_* values, ...). Pure.
 */
export const STELLAR_CHILD_ENV_NAMES = [
  "PATH",
  "HOME",
  "USER",
  "LOGNAME",
  "LANG",
  "TMPDIR",
  "XDG_CONFIG_HOME",
  "XDG_DATA_HOME",
  "STELLAR_CONFIG_HOME",
  "STELLAR_DATA_HOME",
] as const;

export function stellarChildEnv(env: Record<string, string | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of STELLAR_CHILD_ENV_NAMES) {
    const v = env[name];
    if (typeof v === "string" && v !== "") out[name] = v;
  }
  return out;
}
