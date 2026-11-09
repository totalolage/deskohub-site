import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";
import { Effect, Logger } from "effect";
import { CurrentWorkspaceRequestHeaders } from "@/shared/backend/workspace-request-context";
import { CustomerAccountAccessError } from "../customer-account";
import {
  makeFakeSavedLocalePreference,
  syntheticSessionCookie,
} from "./saved-locale-preference.test-utils";

const read = async (
  reader: ReturnType<typeof makeFakeSavedLocalePreference>,
  cookie?: string
) => {
  const warnings: unknown[] = [];
  const captureLogger = Logger.make((options) => {
    if (options.logLevel === "Warn") warnings.push(options.message);
  });
  const preference = await reader.savedLocalePreference.pipe(
    Effect.provideService(
      CurrentWorkspaceRequestHeaders,
      new Headers(cookie ? { cookie } : {})
    ),
    Effect.provide(Logger.layer([captureLogger])),
    Effect.runPromise
  );
  return { preference, warnings };
};

describe("saved locale preference through the session read", () => {
  test.each(["unauthenticated", "unverified-email", "not-configured"] as const)(
    "treats a %s session read as a guest without a warning",
    async (reason) => {
      const reader = makeFakeSavedLocalePreference();
      reader.fake.savedPreference = "cs-CZ";
      reader.fake.sessionReadFailure = new CustomerAccountAccessError({
        reason,
      });

      const { preference, warnings } = await read(
        reader,
        syntheticSessionCookie
      );

      expect(preference).toBeUndefined();
      expect(warnings).toEqual([]);
    }
  );

  test("falls back to no preference with one warning when the session read is unavailable", async () => {
    const reader = makeFakeSavedLocalePreference();
    reader.fake.savedPreference = "cs-CZ";
    reader.fake.sessionReadFailure = new CustomerAccountAccessError({
      reason: "unavailable",
    });

    const { preference, warnings } = await read(reader, syntheticSessionCookie);

    expect(preference).toBeUndefined();
    expect(warnings).toHaveLength(1);
  });
});
