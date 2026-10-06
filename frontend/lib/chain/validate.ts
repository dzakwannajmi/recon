/**
 * Input validation for asset codes and account IDs coming from the model or users.
 */
import { StrKey } from "@stellar/stellar-sdk";

const ASSET_CODE = /^[A-Za-z0-9]{1,12}$/;

export function isAssetCode(value: unknown): value is string {
  return typeof value === "string" && ASSET_CODE.test(value);
}

/** A valid Stellar account ID (G..., checksum verified). */
export function isAccountId(value: unknown): value is string {
  return typeof value === "string" && StrKey.isValidEd25519PublicKey(value);
}
