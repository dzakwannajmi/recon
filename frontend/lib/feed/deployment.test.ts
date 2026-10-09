import fs from "fs";
import os from "os";
import path from "path";
import { describe, expect, it } from "vitest";
import { loadDeployment, parseDeployment } from "./deployment";
import { DEPLOYMENT } from "./testkit";

describe("deployment.json", () => {
  it("accepts the documented shape", () => {
    expect(parseDeployment(DEPLOYMENT)).toEqual(DEPLOYMENT);
  });

  it("accepts the committed data/feed/deployment.json", () => {
    expect(loadDeployment()).toMatchObject({ network: "testnet", contract_id: "CA7EM3I32XOCWMXA2U5TQWWBCQ32N4ARTRQWUQPDYFPFQZDL4D5MVYIO", sdk: "29.0.0" });
  });

  it("refuses any network but testnet", () => {
    expect(() => parseDeployment({ ...DEPLOYMENT, network: "mainnet" })).toThrow(/network/);
    expect(() => parseDeployment({ ...DEPLOYMENT, network: "public" })).toThrow(/network/);
  });

  it("refuses a bad contract ID, hash, address, time, or an extra field", () => {
    expect(() => parseDeployment({ ...DEPLOYMENT, contract_id: DEPLOYMENT.admin })).toThrow(/contract_id/);
    expect(() => parseDeployment({ ...DEPLOYMENT, wasm_hash: "xyz" })).toThrow(/wasm_hash/);
    expect(() => parseDeployment({ ...DEPLOYMENT, deploy_tx: "AB".repeat(32) })).toThrow(/deploy_tx/);
    expect(() => parseDeployment({ ...DEPLOYMENT, publisher: DEPLOYMENT.contract_id })).toThrow(/publisher/);
    expect(() => parseDeployment({ ...DEPLOYMENT, deployed_at: "today" })).toThrow(/deployed_at/);
    expect(() => parseDeployment({ ...DEPLOYMENT, secret: "S..." })).toThrow();
    const { sdk: _sdk, ...missing } = DEPLOYMENT;
    expect(() => parseDeployment(missing)).toThrow(/sdk/);
  });

  it("loads from a file and says so when it is missing", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "deploy-"));
    try {
      const file = path.join(dir, "deployment.json");
      expect(() => loadDeployment(file)).toThrow(/does not exist/);
      fs.writeFileSync(file, JSON.stringify(DEPLOYMENT));
      expect(loadDeployment(file)).toEqual(DEPLOYMENT);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
