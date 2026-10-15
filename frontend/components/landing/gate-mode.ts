export type GateMode = "full" | "light" | "static";

/**
 * How much of a WebGL effect to run. Reduced motion or no WebGL 2 always gives the static fallback.
 * On a narrow screen the effect is either lighter or static, as the caller chose.
 */
export function gateMode(env: { reducedMotion: boolean; webgl: boolean; narrow: boolean }, narrowMode: "light" | "static"): GateMode {
  if (env.reducedMotion || !env.webgl) return "static";
  return env.narrow ? narrowMode : "full";
}
