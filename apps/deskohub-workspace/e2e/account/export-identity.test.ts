import { describe, expect, test } from "bun:test";

import {
  classifyWorkspaceE2EExportIdentityMatch,
  exportIdentityVerdictFailureMessage,
} from "./export-identity";

describe("classifyWorkspaceE2EExportIdentityMatch", () => {
  test("reports a match only when both the account id and the email match", () => {
    expect(
      classifyWorkspaceE2EExportIdentityMatch({
        accountIdMatches: true,
        emailMatches: true,
      })
    ).toBe("match");
  });

  test("splits an account-id match with an email mismatch into the email divergence verdict", () => {
    expect(
      classifyWorkspaceE2EExportIdentityMatch({
        accountIdMatches: true,
        emailMatches: false,
      })
    ).toBe("email-mismatch");
  });

  test("splits an account-id mismatch into the session divergence verdict regardless of the email", () => {
    expect(
      classifyWorkspaceE2EExportIdentityMatch({
        accountIdMatches: false,
        emailMatches: false,
      })
    ).toBe("account-mismatch");
    expect(
      classifyWorkspaceE2EExportIdentityMatch({
        accountIdMatches: false,
        emailMatches: true,
      })
    ).toBe("account-mismatch");
  });
});

describe("exportIdentityVerdictFailureMessage", () => {
    test("never names a verdict-specific fact for a match", () => {
      expect(() => exportIdentityVerdictFailureMessage("match")).not.toThrow();
    });

  test("carries the discriminating fact for each divergence verdict", () => {
    expect(exportIdentityVerdictFailureMessage("account-mismatch")).toContain(
      "journaled"
    );
    expect(exportIdentityVerdictFailureMessage("email-mismatch")).toContain(
      "email"
    );
  });
});
