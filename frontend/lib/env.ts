/**
 * Read a positive integer from the environment.
 * A missing or invalid value (e.g. "200k", "0", "-5") falls back to the default,
 * so a typo can never switch a cost guard off.
 */
export function positiveInt(name: string, fallback: number) {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  if (Number.isInteger(value) && value > 0) return value;
  console.warn(`${name} must be a positive integer; using ${fallback}.`);
  return fallback;
}
