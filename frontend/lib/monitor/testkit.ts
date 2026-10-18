/** Fixtures shared by the Monitor tests and the demo. Test support only. */
import type { HorizonOp } from "./types";

export const ETHERFUSE = "GCRYUGD5NVARGXT56XEZI5CIFCQETYHAPQQTHO2O3IQZTHDH4LATMYWC";
export const ETHERFUSE_CODES = ["USTRY", "TESOURO", "EUROB", "KTB", "GILTS"];
export const FRANKLIN = "GAGICV3VBJSKKH5H5MQQIUTUP462YVHC23KUHZY6FJERRJFBDIVZBM5C";
export const HOLDER = "GAATSWH6REDGTWRV6V2LFJDRGUKTGSDJEVPYGIXWTTOESSE7JWBUXARW";
export const SIGNER = "GAQW5UGB7IFES4R4HZ7PGEX5ZJ336QYX5LKQ6N7K7DPXMJZGKNXB4UHG";

/** A paging token for ledger `ledger` (TOID: ledger << 32 | tx << 12 | op). */
export const token = (ledger: number, n = 1) => (BigInt(ledger) * 2n ** 32n + BigInt(n)).toString();

let counter = 0;
/** A successful op at `ledger`, with fields merged over the common ones. */
export function op(type: string, ledger: number, at: string, fields: Record<string, unknown> = {}): HorizonOp {
  const t = token(ledger, ++counter);
  return {
    id: t, paging_token: t, type, transaction_successful: true, source_account: ETHERFUSE, created_at: at,
    transaction_hash: `${(ledger * 1000 + counter).toString(16).padStart(64, "0")}`, ...fields,
  } as HorizonOp;
}

export const payment = (ledger: number, at: string, code: string, issuer: string, from: string, to: string, amount: string) =>
  op("payment", ledger, at, { asset_type: "credit_alphanum12", asset_code: code, asset_issuer: issuer, from, to, amount, source_account: from });
