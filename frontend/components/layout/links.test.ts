import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { FEED_CONTRACT_ID, FEED_URL } from "./links";

describe("feed link", () => {
  it("points at the contract in data/feed/deployment.json", () => {
    const d = JSON.parse(fs.readFileSync(path.join(process.cwd(), "..", "data", "feed", "deployment.json"), "utf8"));
    expect(FEED_CONTRACT_ID).toBe(d.contract_id);
    expect(FEED_URL).toBe(`https://stellar.expert/explorer/testnet/contract/${d.contract_id}`);
  });
});
