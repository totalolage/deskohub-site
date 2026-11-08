import { describe, expect, test } from "bun:test";
import { analyticsDistinctId, identitySteps } from "./identity";

const account = (accountId: string) =>
  ({ kind: "authenticated", accountId, testAccount: false }) as const;

describe("analyticsDistinctId", () => {
  test("prefixes the account ID like the site", () => {
    expect(analyticsDistinctId("acc_1")).toBe("workspace-account:acc_1");
  });
});

describe("identitySteps", () => {
  test("identifies an anonymous client without resetting it", () => {
    expect(identitySteps(null, account("acc_1"))).toEqual([
      { kind: "identify", distinctId: "workspace-account:acc_1" },
    ]);
  });

  test("does nothing when the client already has that identity", () => {
    expect(identitySteps("workspace-account:acc_1", account("acc_1"))).toEqual(
      []
    );
    expect(identitySteps(null, { kind: "anonymous" })).toEqual([]);
  });

  test("resets before identifying a different account", () => {
    expect(identitySteps("workspace-account:acc_1", account("acc_2"))).toEqual([
      { kind: "reset" },
      { kind: "identify", distinctId: "workspace-account:acc_2" },
    ]);
  });

  test("resets on sign-out", () => {
    expect(
      identitySteps("workspace-account:acc_1", { kind: "anonymous" })
    ).toEqual([{ kind: "reset" }]);
  });
});
