# Scope

## In scope

- **Non-stablecoin real-world assets on Stellar:** tokenized treasuries, money-market and other funds, bonds, and commodities. The current universe has 27 assets from Franklin Templeton, Ondo Finance, Etherfuse, WisdomTree, Bitbond, and Figure Certificate Company ([`data/assets.csv`](../data/assets.csv), as of 2026-10-08).
- **Yield-bearing dollar products** such as USDY and YLDS. They are in scope and labeled `yield-bearing`.

## Out of scope

- **Stablecoins**, for example USDC, EURC, PYUSD, USDGLO, CETES, and MEXe. They are tracked by other tools.

## Networks

- Recon reads Stellar mainnet.
- Recon writes only to Stellar testnet. The agent wallet is a testnet wallet funded by Friendbot.

## What Recon never does

- It does not issue grades or scores. It states facts and flags, each with a date and evidence.
- It does not accuse an issuer of wrongdoing. A flag says what two sources show on a date, for example "Mismatch between {document} ({page}) and on-chain {value} as of {date}."
- It does not follow instructions found inside issuer documents. Documents are untrusted data.
- It does not let the LLM set a status. Code computes flags and status.
- It does not write to mainnet.
