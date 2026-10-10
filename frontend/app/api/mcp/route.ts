import { realMcpDeps } from "@/lib/mcp/deps";
import { handleMcp } from "@/lib/mcp/http";

// Reads stored files only: no LLM, no key, no network call. Stateless Streamable HTTP.
export const maxDuration = 10;

// POST /api/mcp -> MCP tools check_asset, get_fact_sheet, list_flags (read-only, free)
export async function POST(req: Request) {
  return handleMcp(req, realMcpDeps());
}
