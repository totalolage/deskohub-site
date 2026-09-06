import { describe, expect, test } from "bun:test";
import {
  classifyWorkspaceE2EAccountState,
  type WorkspaceE2EAccountState,
} from "./auth-rows";

describe("workspace account e2e account state classification", () => {
  test("classifies an absent synthetic account as missing", () => {
    expect(
      classifyWorkspaceE2EAccountState({
        authUserId: undefined,
        linkedDotyposCustomerId: undefined,
      })
    ).toBe("missing");
  });

  test("classifies a verified account without a link as unlinked", () => {
    expect(
      classifyWorkspaceE2EAccountState({
        authUserId: "auth-user-1",
        linkedDotyposCustomerId: undefined,
      })
    ).toBe("unlinked");
  });

  test("classifies a completed profile completion as linked", () => {
    expect(
      classifyWorkspaceE2EAccountState({
        authUserId: "auth-user-1",
        linkedDotyposCustomerId: "dotypos-customer-1",
      })
    ).toBe("linked");
  });

  test("keeps the state values fixed and low-cardinality", () => {
    const states: readonly WorkspaceE2EAccountState[] = [
      "linked",
      "missing",
      "unlinked",
    ];
    expect([...states].sort()).toEqual(["linked", "missing", "unlinked"]);
  });
});
