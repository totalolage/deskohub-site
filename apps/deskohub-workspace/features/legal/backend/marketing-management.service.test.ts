import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";
import { MarketingManagementError } from "./marketing-management.service";

describe("MarketingManagementError", () => {
  test("is a closed sanitized tagged error", () => {
    const invalid = new MarketingManagementError({
      reason: "invalid_credential",
    });
    const unavailable = new MarketingManagementError({
      reason: "unavailable",
    });

    expect(invalid._tag).toBe("MarketingManagementError");
    expect(invalid.reason).toBe("invalid_credential");
    expect(unavailable.reason).toBe("unavailable");
    expect("cause" in invalid).toBe(false);
    expect("token" in invalid).toBe(false);
    expect("payload" in unavailable).toBe(false);
  });
});
