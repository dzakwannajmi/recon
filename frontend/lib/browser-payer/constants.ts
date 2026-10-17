/**
 * Pinned testnet values for the browser payer. Duplicated from lib/gateway/payment-config.ts and lib/payer/policy.ts
 * on purpose: the browser bundle must not import the server paywall (lib/gateway/guard.test.ts), and constants.test.ts
 * fails if the two copies drift.
 */
export const NETWORK = "stellar:testnet" as const;
export const NETWORK_PASSPHRASE = "Test SDF Network ; September 2015";
export const USDC_TESTNET_SAC = "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";
export const USDC_CODE = "USDC";
export const USDC_TESTNET_ISSUER = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
export const DECIMALS = 7;

export const HORIZON_TESTNET = "https://horizon-testnet.stellar.org";
export const FRIENDBOT = "https://friendbot.stellar.org";
export const EXPLORER_ACCOUNT = "https://stellar.expert/explorer/testnet/account";
export const EXPLORER_TX = "https://stellar.expert/explorer/testnet/tx";
export const DETAIL_SCHEMA = "check-detail/1";

export const STORAGE_KEY = "testnet-payer-secret";
export const UNKNOWN_KEY = "testnet-payer-unknown-outcome";
