import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import { Clock, Effect, Layer, Option } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import { CustomerAuthentication } from "@/features/account/backend/customer-authentication.service";
import { testSessionProfile } from "@/features/account/backend/customer-authentication.test-utils";
import type { CustomerAccountId } from "@/features/account/customer-account";
import { getConsentBannerRevision } from "@/features/legal/consent-banner-revision";
import { CurrentWorkspaceRequestHeaders } from "@/shared/backend/workspace-request-context";
import { workspaceFixtures } from "@/shared/testing/workspace-fixtures.test-utils";
import { connectWorkspacePostgresTestDatabase } from "@/shared/testing/workspace-postgres-test-database.test-utils";
import { AnalyticsConsentLedger } from "./analytics-consent-ledger";
import { recordSignedInDeviceAnalyticsConsent } from "./analytics-consent-mirror";

const testDatabase = await connectWorkspacePostgresTestDatabase();

const ledgerLayer = () =>
  AnalyticsConsentLedger.Default.pipe(
    Layer.provide(
      Layer.succeed(WorkspaceDatabase, WorkspaceDatabase.make(testDatabase!.db))
    )
  );

/** A clock fixed at the instant, to its nanosecond. */
const clockAt = (instant: Temporal.Instant): Clock.Clock => ({
  currentTimeMillisUnsafe: () => instant.epochMilliseconds,
  currentTimeMillis: Effect.sync(() => instant.epochMilliseconds),
  currentTimeNanosUnsafe: () => instant.epochNanoseconds,
  currentTimeNanos: Effect.sync(() => instant.epochNanoseconds),
  sleep: () => Effect.void,
});

const newAccount = () =>
  Effect.runPromise(
    workspaceFixtures(testDatabase!.db).account("analytics-mirror")
  ).then(({ accountId }) => accountId);

/** Records the account's withdrawal from preferences at `at`. */
const withdrawAt = (accountId: CustomerAccountId, at: string) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const ledger = yield* AnalyticsConsentLedger;
      return yield* ledger.record({
        accountId,
        decision: "withdraw",
        locale: "cs-CZ",
        source: "preference",
      });
    }).pipe(
      Effect.provideService(Clock.Clock, clockAt(Temporal.Instant.from(at))),
      Effect.provide(ledgerLayer())
    )
  );

/** A device that accepts analytics, its choice saved at `savedAt`. */
const acceptingDevice = (savedAt: string) =>
  `cc_cookie=${encodeURIComponent(
    JSON.stringify({
      revision: getConsentBannerRevision(),
      categories: ["necessary", "analytics"],
      lastConsentTimestamp: savedAt,
    })
  )}`;

/** Hydrates the device's signed-in session; the withdrawal it takes, if any. */
const hydrate = (accountId: CustomerAccountId, cookieHeader: string) =>
  Effect.runPromise(
    recordSignedInDeviceAnalyticsConsent({
      occasion: "hydration",
      locale: "cs-CZ",
    }).pipe(
      Effect.map(Option.map(String)),
      Effect.map(Option.getOrUndefined),
      Effect.provideService(
        CurrentWorkspaceRequestHeaders,
        new Headers({ cookie: cookieHeader })
      ),
      Effect.provide(
        Layer.succeed(CustomerAuthentication, {
          currentUser: Effect.succeed({
            accountId,
            deletionRequested: false,
            ...testSessionProfile,
            email: testEmailAddress("mirror"),
          }),
        })
      ),
      Effect.provideService(
        Clock.Clock,
        clockAt(Temporal.Instant.from("2026-11-08T12:00:00Z"))
      ),
      Effect.provide(ledgerLayer())
    )
  );

const currentDecisionOf = (accountId: CustomerAccountId) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const ledger = yield* AnalyticsConsentLedger;
      return yield* ledger.currentDecision(accountId);
    }).pipe(Effect.provide(ledgerLayer()))
  ).then(
    Option.map(({ decision, decidedAt, source }) => ({
      decision,
      decidedAt: decidedAt.toString(),
      source,
    }))
  );

describe.skipIf(!testDatabase)(
  "recordSignedInDeviceAnalyticsConsent with the ledger",
  () => {
    test("a device accepting analytics before the account's withdrawal takes it", async () => {
      const accountId = await newAccount();
      const withdrawnAt = await withdrawAt(
        accountId,
        "2026-11-05T10:00:00.123456Z"
      );

      expect(
        await hydrate(accountId, acceptingDevice("2026-11-02T09:30:00.000Z"))
      ).toBe(withdrawnAt.toString());
      expect(Option.getOrUndefined(await currentDecisionOf(accountId))).toEqual(
        {
          decision: "withdraw",
          decidedAt: "2026-11-05T10:00:00.123456Z",
          source: "preference",
        }
      );
    });

    test("a device whose choice is dated at the withdrawal's instant takes it", async () => {
      const accountId = await newAccount();
      await withdrawAt(accountId, "2026-11-05T10:00:00.123Z");

      expect(
        await hydrate(accountId, acceptingDevice("2026-11-05T10:00:00.123Z"))
      ).toBe("2026-11-05T10:00:00.123Z");
    });

    test("a device choice newer than the withdrawal becomes the account's grant and takes nothing", async () => {
      const accountId = await newAccount();
      await withdrawAt(accountId, "2026-11-01T10:00:00Z");

      expect(
        await hydrate(accountId, acceptingDevice("2026-11-02T09:30:00.000Z"))
      ).toBeUndefined();
      expect(Option.getOrUndefined(await currentDecisionOf(accountId))).toEqual(
        {
          decision: "grant",
          decidedAt: "2026-11-02T09:30:00Z",
          source: "hydration_mirror",
        }
      );
    });
  }
);
