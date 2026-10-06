/**
 * THE AGENT'S TOOLS
 *
 * A tool is a plain function the agent may call. The model reads the
 * `description` to decide WHEN to use it and `parameters` (JSON Schema)
 * to know WHAT to pass. `agent/llm.ts` turns these into model tools,
 * so this file stays independent of the LLM provider.
 *
 * Tool results are data, never instructions (CLAUDE.md, golden rule 3).
 */
import { getAssetFacts } from "@/lib/chain/asset";
import { listIssuers } from "@/lib/chain/horizon";
import { checkIssuerIdentity } from "@/lib/chain/identity";
import { loadUniverse } from "@/lib/chain/universe";
import { isAccountId, isAssetCode } from "@/lib/chain/validate";
import { NETWORK, explorerUrl, fundWallet, getWalletAddress, getWalletBalances } from "./wallet";

const ISSUERS_TO_CHECK = 5;

/** Passed to every tool. `abortSignal` fires when the request is cancelled or the budget runs out. */
export type ToolContext = { abortSignal?: AbortSignal };

export type Tool = {
  name: string;
  description: string;
  /** JSON Schema describing the inputs. */
  parameters: object;
  /** The code that runs when the agent calls this tool. */
  run: (args: any, ctx: ToolContext) => Promise<unknown>;
};

export const tools: Tool[] = [
  {
    name: "get_my_wallet",
    description: "Get the agent's own Stellar testnet wallet: address, balances, and an explorer link.",
    parameters: { type: "object", properties: {} },
    run: async () => {
      const address = getWalletAddress();
      if (!address) return { address: null, note: "No wallet yet. The user can click 'Create wallet'." };
      return { address, balances: await getWalletBalances(), network: NETWORK, explorer: explorerUrl(address) };
    },
  },
  {
    name: "fund_my_wallet",
    description: "Fund the agent's Stellar testnet wallet with Friendbot (free test XLM). Testnet only.",
    parameters: { type: "object", properties: {} },
    run: async () => fundWallet(),
  },
  {
    name: "check_asset",
    description:
      "Check a tokenized asset on Stellar mainnet (read-only). With an issuer: whether that issuer verifies against the official domain pinned for the asset, plus total supply, authorized trustlines, funded holders, flags, and the largest holder's share. Without an issuer: list the issuers using this code (most authorized trustlines first) and whether each one verifies.",
    parameters: {
      type: "object",
      properties: {
        asset_code: { type: "string", description: "Asset code, e.g. BENJI" },
        issuer: { type: "string", description: "Optional issuer account ID (G...)" },
      },
      required: ["asset_code"],
    },
    run: async ({ asset_code, issuer }: { asset_code: unknown; issuer?: unknown }, { abortSignal }) => {
      if (!isAssetCode(asset_code)) return { error: "asset_code must be 1-12 letters or digits." };
      if (issuer !== undefined && issuer !== "" && !isAccountId(issuer)) {
        return { error: "issuer must be a valid Stellar account ID (G..., 56 characters)." };
      }
      const signal = abortSignal;
      const universe = loadUniverse();

      if (!issuer) {
        const { records, truncated } = await listIssuers(asset_code, signal);
        const checked = await Promise.all(
          records.slice(0, ISSUERS_TO_CHECK).map(async (a) => {
            const id = await checkIssuerIdentity(asset_code, a.asset_issuer, universe, { signal });
            return {
              issuer: a.asset_issuer,
              authorized_trustlines: a.accounts.authorized,
              home_domain: id.homeDomain,
              status: id.status,
              severity: id.severity,
              reason: id.reason,
            };
          }),
        );
        return {
          asset_code,
          issuers_seen: records.length,
          issuers_seen_is_partial: truncated,
          checked,
          note: `Showing the ${checked.length} issuers with the most authorized trustlines.`,
        };
      }

      const [identity, facts] = await Promise.all([
        checkIssuerIdentity(asset_code, issuer, universe, { signal }),
        getAssetFacts(asset_code, issuer, { signal }),
      ]);
      return {
        asset_code,
        issuer,
        identity: {
          status: identity.status,
          severity: identity.severity,
          reason: identity.reason,
          home_domain: identity.homeDomain,
          official_domains: identity.officialDomains,
          code_listed_in_toml: identity.codeListed,
          toml_sha256: identity.tomlSha256,
          toml_parse_mode: identity.tomlParseMode,
        },
        facts: facts.exists
          ? {
              total_supply: facts.supply,
              authorized_trustlines: facts.authorizedTrustlines,
              funded_holders: facts.fundedHolders,
              flags: facts.flags,
              largest_holder_share_percent: facts.largestHolder?.sharePercent ?? null,
              sac_contract_id: facts.sacContractId,
            }
          : { exists: false },
        checked_at: facts.checkedAt,
        sources: [...new Set([...identity.sources, ...facts.sources])],
      };
    },
  },
];
