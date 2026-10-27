import "@/shared/testing/workspace-test-env";

import { describe, expect, mock, test } from "bun:test";
import { Context, Effect, Layer } from "effect";
import type { Locale } from "@/features/i18n";
import { mockAdministratorAccess } from "../server/administrator-access.test-utils";

const access = mockAdministratorAccess("roster-page-actor");
const actor = access.administrator;
let requestLocale: Locale = "cs-CZ";

class StubAdministratorRoster extends Context.Service<
  StubAdministratorRoster,
  { readonly list: Effect.Effect<ReadonlyArray<unknown>> }
>()("@test/AdministratorRoster") {}

mock.module(
  "@/features/administrators/backend/administrator-roster.service",
  () => ({
    AdministratorRoster: Object.assign(StubAdministratorRoster, {
      Live: Layer.succeed(
        StubAdministratorRoster,
        StubAdministratorRoster.of({
          list: Effect.succeed([
            {
              accountId: actor.accountId,
              email: actor.email,
              grantedBy: null,
              grantedAt: Temporal.Instant.from("2026-10-01T08:00:00Z"),
            },
          ]),
        })
      ),
    }),
  })
);

mock.module("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, getAll: () => [] }),
  headers: async () => new Headers(),
}));
mock.module("next/server", () => ({
  after: () => undefined,
  connection: () => Promise.resolve(),
}));

mock.module("next/root-params", () => ({
  locale: async () => requestLocale,
}));

mock.module("@/instrumentation", () => ({
  postHogLoggerProvider: {
    forceFlush: () => Promise.resolve(),
    getLogger: () => ({ emit: () => undefined }),
  },
}));

const { loadAdministrators } = await import("./page-data.server");

describe("loadAdministrators", () => {
  test.each([
    ["cs-CZ", "1. 10. 2026 10:00"],
    ["en-US", "Oct 1, 2026, 10:00 AM"],
  ] as const)(
    "labels grant times in the %s route locale and the site's time zone",
    async (locale, label) => {
      requestLocale = locale;

      const { actorAccountId, administrators } = await loadAdministrators();

      expect(actorAccountId).toBe(actor.accountId);
      expect(administrators[0]?.grantedAt).toBe("2026-10-01T08:00:00Z");
      expect(administrators[0]?.grantedAtLabel.replace(/\s/gu, " ")).toBe(
        label
      );
    }
  );
});
