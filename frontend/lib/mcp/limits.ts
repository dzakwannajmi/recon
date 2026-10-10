/** Limits of the MCP endpoint (spec 3 and 7.1). All per server instance. */
export const MAX_BODY_BYTES = 65_536;
export const MAX_RESPONSE_BYTES = 524_288;
export const MAX_TOOL_INPUT_ELEMENTS = 16;
export const DEFAULT_RATE_PER_IP_PER_MIN = 60;
export const DEFAULT_RATE_GLOBAL_PER_MIN = 240;

/** `fact-sheet/1` bounds. */
export const MAX_EVIDENCE_PER_FLAG = 10;
export const MAX_QUOTE_CODE_POINTS = 1000;
export const MAX_FACT_SHEET_BYTES = 49_152;

/** `flag-list/1` bound. */
export const MAX_RAISED_ITEMS = 100;

export const SERVER_INFO = { name: "recon", title: "Recon", version: "0.1.0" } as const;
