import "@/shared/testing/workspace-test-env";

import { describe, expect, mock, test } from "bun:test";
import { Effect } from "effect";

mock.module("server-only", () => ({}));

const { getLegalAcceptanceSnapshot } = await import("./acceptance-snapshot");

describe("getLegalAcceptanceSnapshot", () => {
  test("returns the snapshot through the Effect success channel", async () => {
    const snapshot = await Effect.runPromise(
      getLegalAcceptanceSnapshot("en-US")
    );

    expect(snapshot.termsAndConditions.hashAlgorithm).toBe("sha256");
    expect(snapshot.operatingRules.hashAlgorithm).toBe("sha256");
    expect(snapshot.privacyPolicy.hashAlgorithm).toBe("sha256");
  });
});
