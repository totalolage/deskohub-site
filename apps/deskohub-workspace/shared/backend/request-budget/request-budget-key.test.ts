import { describe, expect, test } from "bun:test";
import { budgetKeyDigest } from "./request-budget-key";

describe("budgetKeyDigest", () => {
  test("keeps the digests of keys already stored", () => {
    expect(
      budgetKeyDigest(
        "deskohub-workspace/agent-tool-budget",
        "account",
        "account-1"
      )
    ).toBe("w2cTZ5iBpXZ13DxqHl2AKNeM-Urh3DbR");
    expect(
      budgetKeyDigest(
        "deskohub-workspace/agent-tool-budget",
        "grant",
        "account-1",
        "client-1"
      )
    ).toBe("Kta0XbCNq--pY02T6b421dIk0GuJcpZV");
    expect(
      budgetKeyDigest(
        "deskohub-workspace/customer-api-budget",
        "account",
        "account-1"
      )
    ).toBe("1qg-TxNDujTt4y69fEUBUCSGBRA6Q_NN");
  });

  test("separates domains and part boundaries", () => {
    const digests = [
      budgetKeyDigest("domain-a", "account", "1"),
      budgetKeyDigest("domain-b", "account", "1"),
      budgetKeyDigest("domain-a", "account1"),
      budgetKeyDigest("domain-a", "account", "2"),
    ];

    expect(new Set(digests).size).toBe(digests.length);
    expect(digests.every((digest) => /^[\w-]{32}$/.test(digest))).toBe(true);
  });
});
