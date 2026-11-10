import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import { asc, eq } from "drizzle-orm";
import { Clock, Effect, Layer, Option } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import { accountAnalyticsConsentDecisions } from "@/db/schema";
import { CustomerAuthentication } from "@/features/account/backend/customer-authentication.service";
import { testSessionProfile } from "@/features/account/backend/customer-authentication.test-utils";
import type { CustomerAccountId } from "@/features/account/customer-account";
import type { Locale } from "@/features/i18n";
import { getConsentBannerRevision } from "@/features/legal/consent-banner-revision";
import { getLegalDocumentVersion } from "@/features/legal/document-version";
import { CurrentWorkspaceRequestHeaders } from "@/shared/backend/workspace-request-context";
import { workspaceFixtures } from "@/shared/testing/workspace-fixtures.test-utils";
import { connectWorkspacePostgresTestDatabase } from "@/shared/testing/workspace-postgres-test-database.test-utils";
import { temporalInstantToIsoString } from "@/shared/utils/temporal";
import { AnalyticsConsentLedger } from "./analytics-consent-ledger";
import {
  recordSignedInDeviceAnalyticsConsent,
  syncAppAnalyticsConsent,
} from "./analytics-consent-mirror";

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

/** Records the account's decision from preferences at `at`, in `locale`. */
const decideAt = (
  accountId: CustomerAccountId,
  at: string,
  decision: "grant" | "withdraw",
  locale: Locale = "cs-CZ"
) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const ledger = yield* AnalyticsConsentLedger;
      return yield* ledger.record({
        accountId,
        decision,
        locale,
        source: "preference",
      });
    }).pipe(
      Effect.provideService(Clock.Clock, clockAt(Temporal.Instant.from(at))),
      Effect.provide(ledgerLayer())
    )
  );

/** Records the account's withdrawal from preferences at `at`. */
const withdrawAt = (accountId: CustomerAccountId, at: string) =>
  decideAt(accountId, at, "withdraw");

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

/** The account's stored decisions, oldest first. */
const storedDecisionsOf = (accountId: CustomerAccountId) =>
  Effect.runPromise(
    testDatabase!.db
      .select({
        decision: accountAnalyticsConsentDecisions.decision,
        decidedAt: accountAnalyticsConsentDecisions.decidedAt,
        source: accountAnalyticsConsentDecisions.source,
      })
      .from(accountAnalyticsConsentDecisions)
      .where(eq(accountAnalyticsConsentDecisions.accountId, accountId))
      .orderBy(asc(accountAnalyticsConsentDecisions.decidedAt))
  ).then((rows) =>
    rows.map(({ decidedAt, ...row }) => ({
      ...row,
      decidedAt: decidedAt.toString(),
    }))
  );

/** The locale and privacy notice of the account's stored decisions, oldest first. */
const storedNoticesOf = (accountId: CustomerAccountId) =>
  Effect.runPromise(
    testDatabase!.db
      .select({
        locale: accountAnalyticsConsentDecisions.locale,
        documentHash: accountAnalyticsConsentDecisions.documentHash,
      })
      .from(accountAnalyticsConsentDecisions)
      .where(eq(accountAnalyticsConsentDecisions.accountId, accountId))
      .orderBy(asc(accountAnalyticsConsentDecisions.decidedAt))
  );

/**
 * Syncs the app's choice (none, or analytics accepted or declined at an ISO
 * instant, as the app stores it, in `locale`) for the signed-in account.
 * Returns the account decision the app takes, its instant as the customer
 * API answers it.
 */
const syncApp = (
  accountId: CustomerAccountId,
  choice?: { readonly analytics: boolean; readonly decidedAt: string },
  locale: Locale = "en-US"
) =>
  Effect.runPromise(
    syncAppAnalyticsConsent({
      choice: Option.map(Option.fromUndefinedOr(choice), (made) => ({
        decision: made.analytics ? ("grant" as const) : ("withdraw" as const),
        locale,
        decidedAt: Option.some(Temporal.Instant.from(made.decidedAt)),
      })),
    }).pipe(
      Effect.map(
        Option.map(({ decision, decidedAt }) => ({
          decision,
          decidedAt: temporalInstantToIsoString(decidedAt),
        }))
      ),
      Effect.map(Option.getOrUndefined),
      Effect.provide(
        Layer.succeed(CustomerAuthentication, {
          currentUser: Effect.succeed({
            accountId,
            deletionRequested: false,
            email: testEmailAddress("app-mirror"),
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

describe.skipIf(!testDatabase)(
  "syncAppAnalyticsConsent with the ledger",
  () => {
    test("the app's choice becomes the account's decision as an app mirror, dated when the app made it", async () => {
      const accountId = await newAccount();

      expect(
        await syncApp(accountId, {
          analytics: true,
          decidedAt: "2026-11-02T09:30:00.123Z",
        })
      ).toBeUndefined();
      expect(await storedDecisionsOf(accountId)).toEqual([
        {
          decision: "grant",
          decidedAt: "2026-11-02T09:30:00.123Z",
          source: "app_mirror",
        },
      ]);
    });

    test("an app choice older than or equal to the account's decision changes nothing", async () => {
      const accountId = await newAccount();
      await withdrawAt(accountId, "2026-11-05T10:00:00.123Z");

      await syncApp(accountId, {
        analytics: false,
        decidedAt: "2026-11-04T10:00:00.000Z",
      });
      await syncApp(accountId, {
        analytics: false,
        decidedAt: "2026-11-05T10:00:00.123Z",
      });
      await syncApp(accountId, {
        analytics: true,
        decidedAt: "2026-11-05T10:00:00.123Z",
      });

      expect(await storedDecisionsOf(accountId)).toEqual([
        {
          decision: "withdraw",
          decidedAt: "2026-11-05T10:00:00.123Z",
          source: "preference",
        },
      ]);
    });

    test("an accepting app takes the newer withdrawal, and the instant it stores never outranks it", async () => {
      const accountId = await newAccount();
      await withdrawAt(accountId, "2026-11-05T10:00:00.123456Z");
      const storedBefore = await storedDecisionsOf(accountId);

      // The app's grant falls in the withdrawal's millisecond, before it.
      const taken = await syncApp(accountId, {
        analytics: true,
        decidedAt: "2026-11-05T10:00:00.123Z",
      });
      expect(taken).toEqual({
        decision: "withdraw",
        decidedAt: "2026-11-05T10:00:00.123Z",
      });

      // The app stores the withdrawal at the answered instant: its next sync
      // appends nothing.
      expect(
        await syncApp(accountId, {
          analytics: false,
          decidedAt: taken!.decidedAt,
        })
      ).toBeUndefined();
      // A grant at that instant still doesn't outrank the withdrawal.
      expect(
        await syncApp(accountId, {
          analytics: true,
          decidedAt: taken!.decidedAt,
        })
      ).toEqual(taken);
      expect(await storedDecisionsOf(accountId)).toEqual(storedBefore);
    });

    test("an app grant made after the withdrawal becomes the account's grant and takes nothing", async () => {
      const accountId = await newAccount();
      await withdrawAt(accountId, "2026-11-05T10:00:00.123456Z");

      expect(
        await syncApp(accountId, {
          analytics: true,
          decidedAt: "2026-11-06T08:00:00.000Z",
        })
      ).toBeUndefined();
      expect((await storedDecisionsOf(accountId)).at(-1)).toEqual({
        decision: "grant",
        decidedAt: "2026-11-06T08:00:00Z",
        source: "app_mirror",
      });
    });

    test("an app without a choice takes the account's current-notice grant, and storing it appends nothing", async () => {
      const accountId = await newAccount();
      await decideAt(accountId, "2026-11-05T10:00:00.123456Z", "grant");
      const storedBefore = await storedDecisionsOf(accountId);

      const taken = await syncApp(accountId);
      expect(taken).toEqual({
        decision: "grant",
        decidedAt: "2026-11-05T10:00:00.123Z",
      });

      expect(
        await syncApp(accountId, {
          analytics: true,
          decidedAt: taken!.decidedAt,
        })
      ).toBeUndefined();
      expect(await storedDecisionsOf(accountId)).toEqual(storedBefore);
    });

    test("an app choice in a locale added after Czech and English is stored under that locale's privacy notice", async () => {
      const accountId = await newAccount();

      await syncApp(
        accountId,
        { analytics: true, decidedAt: "2026-11-02T09:30:00.123Z" },
        "sk-SK"
      );

      expect(await storedNoticesOf(accountId)).toEqual([
        {
          locale: "sk-SK",
          documentHash: getLegalDocumentVersion("sk-SK", "privacy-policy"),
        },
      ]);
    });

    test("an app without a choice takes a grant given under the current privacy notice of a locale added after Czech and English", async () => {
      const accountId = await newAccount();
      await decideAt(
        accountId,
        "2026-11-05T10:00:00.123456Z",
        "grant",
        "de-DE"
      );

      expect(await syncApp(accountId)).toEqual({
        decision: "grant",
        decidedAt: "2026-11-05T10:00:00.123Z",
      });
    });

    test("an app without a choice takes nothing from the account's withdrawal", async () => {
      const accountId = await newAccount();
      await withdrawAt(accountId, "2026-11-05T10:00:00.123456Z");

      expect(await syncApp(accountId)).toBeUndefined();
      expect(await storedDecisionsOf(accountId)).toHaveLength(1);
    });
  }
);
