export const GITHUB_URL = "https://github.com/dzakwannajmi/recon";
export const DEMO_HREF = "/agent";
export const FACT_SHEETS_HREF = "/en/assets";

export const NAV_LINKS = [
  { label: "Why Recon", href: "/#why-recon" },
  { label: "How it works", href: "/#how-it-works" },
  { label: "Key features", href: "/#key-features" },
] as const;

/** The feed contract on Stellar testnet, on the public explorer. The id must match data/feed/deployment.json (links.test.ts). */
export const FEED_CONTRACT_ID = "CAXEHTAMDRASNGUPGRRPZZAUAOOB5MMAUNLLA5O43KH3BQWZ4LQSX2PR";
export const FEED_URL = `https://stellar.expert/explorer/testnet/contract/${FEED_CONTRACT_ID}`;
