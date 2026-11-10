import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";
import { asc, eq } from "drizzle-orm";
import { Clock, Effect, Layer, Option } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import { accountAnalyticsConsentDecisions } from "@/db/schema";
import { authUser } from "@/db/schema/auth";
import type { CustomerAccountId } from "@/features/account/customer-account";
import type { Locale } from "@/features/i18n";
import { getLegalDocument } from "@/features/legal/content";
import { hashLegalDocument } from "@/features/legal/document-version";
import { workspaceFixtures } from "@/shared/testing/workspace-fixtures.test-utils";
import { connectWorkspacePostgresTestDatabase } from "@/shared/testing/workspace-postgres-test-database.test-utils";
import {
  AnalyticsConsentLedger,
  type AnalyticsConsentMirrorRecord,
  type AnalyticsConsentUnavailable,
  type IAnalyticsConsentLedger,
} from "./analytics-consent-ledger";

const testDatabase = await connectWorkspacePostgresTestDatabase();

const ledgerLayer = () =>
  AnalyticsConsentLedger.Default.pipe(
    Layer.provide(
      Layer.succeed(WorkspaceDatabase, WorkspaceDatabase.make(testDatabase!.db))
    )
  );

/** The version the ledger must store: the published privacy notice's own hash. */
const privacyNoticeHash = (locale: Locale) =>
  hashLegalDocument(getLegalDocument(locale, "privacy-policy"));

/** A clock fixed at the instant, to its nanosecond. */
const clockAt = (instant: Temporal.Instant): Clock.Clock => ({
  currentTimeMillisUnsafe: () => instant.epochMilliseconds,
  currentTimeMillis: Effect.sync(() => instant.epochMilliseconds),
  currentTimeNanosUnsafe: () => instant.epochNanoseconds,
  currentTimeNanos: Effect.sync(() => instant.epochNanoseconds),
  sleep: () => Effect.void,
});

/** Runs the ledger operation with the clock at `at`. */
const runLedgerAt = <A>(
  at: string,
  operation: (
    ledger: IAnalyticsConsentLedger
  ) => Effect.Effect<A, AnalyticsConsentUnavailable>
): Promise<A> =>
  Effect.runPromise(
    Effect.gen(function* () {
      const ledger = yield* AnalyticsConsentLedger;
      return yield* operation(ledger);
    }).pipe(
      Effect.provideService(Clock.Clock, clockAt(Temporal.Instant.from(at))),
      Effect.provide(ledgerLayer())
    )
  );

const newAccount = () =>
  Effect.runPromise(
    workspaceFixtures(testDatabase!.db).account("analytics-consent")
  ).then(({ accountId }) => accountId);

const mirrorAt = (
  at: string,
  input: Omit<AnalyticsConsentMirrorRecord, "decidedAt" | "locale"> & {
    readonly decidedAt?: string;
    readonly locale?: Locale;
  }
) =>
  runLedgerAt(at, (ledger) =>
    ledger.mirror({
      locale: "cs-CZ",
      ...input,
      decidedAt: Option.map(
        Option.fromUndefinedOr(input.decidedAt),
        Temporal.Instant.from
      ),
    })
  );

/** The account's current decision as plain values. */
const currentDecisionOf = async (accountId: CustomerAccountId) => {
  const current = await runLedgerAt("2026-12-01T00:00:00Z", (ledger) =>
    ledger.currentDecision(accountId)
  );
  return Option.getOrUndefined(
    Option.map(current, ({ decidedAt, ...decision }) => ({
      ...decision,
      decidedAt: decidedAt.toString(),
    }))
  );
};

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
      .orderBy(asc(accountAnalyticsConsentDecisions.createdAt))
  ).then((rows) =>
    rows.map(({ decidedAt, ...row }) => ({
      ...row,
      decidedAt: decidedAt.toString(),
    }))
  );

describe.skipIf(!testDatabase)("AnalyticsConsentLedger", () => {
  test("holds no current decision for an account that never decided", async () => {
    expect(await currentDecisionOf(await newAccount())).toBeUndefined();
  });

  test("records a decision made now against the locale's current privacy notice", async () => {
    const accountId = await newAccount();

    await runLedgerAt("2026-11-07T10:00:00.123456Z", (ledger) =>
      ledger.record({
        accountId,
        decision: "grant",
        locale: "en-US",
        source: "banner",
      })
    );

    expect(await currentDecisionOf(accountId)).toEqual({
      decision: "grant",
      documentHash: privacyNoticeHash("en-US"),
      locale: "en-US",
      decidedAt: "2026-11-07T10:00:00.123456Z",
      source: "banner",
    });
  });

  test("returns the instant it stored, truncated to the microsecond the database holds", async () => {
    const accountId = await newAccount();

    const recordedAt = await runLedgerAt(
      "2026-11-07T10:00:00.123456789Z",
      (ledger) =>
        ledger.record({
          accountId,
          decision: "withdraw",
          locale: "cs-CZ",
          source: "preference",
        })
    );

    expect(recordedAt.toString()).toBe("2026-11-07T10:00:00.123456Z");
    expect(await storedDecisionsOf(accountId)).toEqual([
      {
        decision: "withdraw",
        decidedAt: recordedAt.toString(),
        source: "preference",
      },
    ]);
  });

  test("keeps every decision and takes the latest as current, so a later grant restores consent", async () => {
    const accountId = await newAccount();
    const decide = (at: string, decision: "grant" | "withdraw") =>
      runLedgerAt(at, (ledger) =>
        ledger.record({
          accountId,
          decision,
          locale: "cs-CZ",
          source: "preference",
        })
      );

    await decide("2026-11-01T10:00:00Z", "grant");
    await decide("2026-11-02T10:00:00Z", "withdraw");
    expect((await currentDecisionOf(accountId))?.decision).toBe("withdraw");

    await decide("2026-11-03T10:00:00Z", "grant");
    expect(await currentDecisionOf(accountId)).toMatchObject({
      decision: "grant",
      documentHash: privacyNoticeHash("cs-CZ"),
      decidedAt: "2026-11-03T10:00:00Z",
    });
    expect(await storedDecisionsOf(accountId)).toHaveLength(3);
  });

  test("ranks decisions by when they were made, not when they were recorded", async () => {
    const accountId = await newAccount();
    const store = (decision: "grant" | "withdraw", decidedAt: string) =>
      Effect.runPromise(
        testDatabase!.db.insert(accountAnalyticsConsentDecisions).values({
          accountId,
          decision,
          documentHash: privacyNoticeHash("cs-CZ"),
          locale: "cs-CZ",
          decidedAt: Temporal.Instant.from(decidedAt),
          source: "backfill",
        })
      );

    await store("withdraw", "2026-11-05T10:00:00Z");
    await store("grant", "2026-11-01T10:00:00Z");

    expect(await currentDecisionOf(accountId)).toMatchObject({
      decision: "withdraw",
      decidedAt: "2026-11-05T10:00:00Z",
    });
    expect(
      await mirrorAt("2026-11-07T10:00:00Z", {
        accountId,
        decision: "grant",
        source: "backfill",
        decidedAt: "2026-11-03T10:00:00Z",
      })
    ).toBe(false);
  });

  describe("mirror", () => {
    test("seeds an empty ledger with the device's dated choice", async () => {
      const accountId = await newAccount();

      expect(
        await mirrorAt("2026-11-07T10:00:00Z", {
          accountId,
          decision: "grant",
          source: "sign_in_mirror",
          decidedAt: "2026-11-02T09:30:00.000Z",
        })
      ).toBe(true);
      expect(await currentDecisionOf(accountId)).toEqual({
        decision: "grant",
        documentHash: privacyNoticeHash("cs-CZ"),
        locale: "cs-CZ",
        decidedAt: "2026-11-02T09:30:00Z",
        source: "sign_in_mirror",
      });
    });

    test("appends a newer choice, which becomes current", async () => {
      const accountId = await newAccount();
      await runLedgerAt("2026-11-02T10:00:00Z", (ledger) =>
        ledger.record({
          accountId,
          decision: "grant",
          locale: "cs-CZ",
          source: "banner",
        })
      );

      expect(
        await mirrorAt("2026-11-07T10:00:00Z", {
          accountId,
          decision: "withdraw",
          source: "hydration_mirror",
          decidedAt: "2026-11-03T10:00:00Z",
        })
      ).toBe(true);
      expect(await currentDecisionOf(accountId)).toMatchObject({
        decision: "withdraw",
        decidedAt: "2026-11-03T10:00:00Z",
        source: "hydration_mirror",
      });
    });

    test("never lets a stale or same-instant choice override a later decision", async () => {
      const accountId = await newAccount();
      await runLedgerAt("2026-11-05T10:00:00Z", (ledger) =>
        ledger.record({
          accountId,
          decision: "withdraw",
          locale: "cs-CZ",
          source: "banner",
        })
      );

      for (const decidedAt of [
        "2026-11-04T10:00:00Z",
        "2026-11-05T10:00:00Z",
      ]) {
        expect(
          await mirrorAt("2026-11-07T10:00:00Z", {
            accountId,
            decision: "grant",
            source: "hydration_mirror",
            decidedAt,
          })
        ).toBe(false);
      }
      expect(await storedDecisionsOf(accountId)).toEqual([
        {
          decision: "withdraw",
          decidedAt: "2026-11-05T10:00:00Z",
          source: "banner",
        },
      ]);
    });

    test("mirrors the same cookie once", async () => {
      const accountId = await newAccount();
      const mirrorCookie = () =>
        mirrorAt("2026-11-07T10:00:00Z", {
          accountId,
          decision: "grant",
          source: "hydration_mirror",
          decidedAt: "2026-11-02T09:30:00Z",
        });

      expect(await mirrorCookie()).toBe(true);
      expect(await mirrorCookie()).toBe(false);
      expect(await storedDecisionsOf(accountId)).toHaveLength(1);
    });

    test("seeds only an empty ledger with an undated choice, dated now", async () => {
      const accountId = await newAccount();
      const mirrorUndated = (at: string, decision: "grant" | "withdraw") =>
        mirrorAt(at, { accountId, decision, source: "sign_in_mirror" });

      expect(await mirrorUndated("2026-11-07T10:00:00Z", "grant")).toBe(true);
      expect(await mirrorUndated("2026-11-08T10:00:00Z", "withdraw")).toBe(
        false
      );
      expect(await storedDecisionsOf(accountId)).toEqual([
        {
          decision: "grant",
          decidedAt: "2026-11-07T10:00:00Z",
          source: "sign_in_mirror",
        },
      ]);
    });

    test("treats a choice dated in the future as undated, so replaying it never outranks a later decision", async () => {
      const accountId = await newAccount();
      const mirrorSkewedCookie = (at: string) =>
        mirrorAt(at, {
          accountId,
          decision: "grant",
          source: "hydration_mirror",
          decidedAt: "2027-01-01T00:00:00Z",
        });

      expect(await mirrorSkewedCookie("2026-11-07T10:00:00Z")).toBe(true);
      expect((await currentDecisionOf(accountId))?.decidedAt).toBe(
        "2026-11-07T10:00:00Z"
      );

      await runLedgerAt("2026-11-08T10:00:00Z", (ledger) =>
        ledger.record({
          accountId,
          decision: "withdraw",
          locale: "cs-CZ",
          source: "banner",
        })
      );
      expect(await mirrorSkewedCookie("2026-11-09T10:00:00Z")).toBe(false);
      expect((await currentDecisionOf(accountId))?.decision).toBe("withdraw");
    });

    test("waits for a decision being recorded, so an undated choice never seeds past it", async () => {
      const accountId = await newAccount();
      const holder = await testDatabase!.pool.connect();
      const waitingForLedgerLock = async () => {
        const { rows } = await testDatabase!.pool.query(
          "select count(*)::int as waiting from pg_locks where locktype = 'advisory' and not granted"
        );
        return (rows[0]?.waiting as number) > 0;
      };
      try {
        // Another request holds the ledger lock while recording a
        // withdrawal it has not committed yet.
        await holder.query("begin");
        await holder.query(
          "select pg_advisory_xact_lock(hashtext('analytics-consent-ledger'), hashtext($1))",
          [accountId]
        );
        await holder.query(
          `insert into account_analytics_consent_decisions
             (account_id, decision, document_hash, locale, decided_at, source)
           values ($1, 'withdraw', $2, 'cs-CZ', now(), 'banner')`,
          [accountId, privacyNoticeHash("cs-CZ")]
        );

        const seeding = mirrorAt("2099-01-01T00:00:00Z", {
          accountId,
          decision: "grant",
          source: "sign_in_mirror",
        });
        while (!(await waitingForLedgerLock())) await Bun.sleep(10);
        await holder.query("commit");

        expect(await seeding).toBe(false);
      } finally {
        holder.release(true);
      }
      expect((await currentDecisionOf(accountId))?.decision).toBe("withdraw");
    });

    test("compares a sub-microsecond date as the database stores it", async () => {
      const accountId = await newAccount();
      // Stored as ...00.123456Z, after this older grant's instant.
      await runLedgerAt("2026-11-05T10:00:00.123456999Z", (ledger) =>
        ledger.record({
          accountId,
          decision: "withdraw",
          locale: "cs-CZ",
          source: "banner",
        })
      );
      const mirrorPrecise = (decidedAt: string) =>
        mirrorAt("2026-11-07T10:00:00Z", {
          accountId,
          decision: "grant",
          source: "hydration_mirror",
          decidedAt,
        });

      expect(await mirrorPrecise("2026-11-05T10:00:00.123456789Z")).toBe(false);
      expect(await mirrorPrecise("2026-11-06T10:00:00.000000789Z")).toBe(true);
      expect(await mirrorPrecise("2026-11-06T10:00:00.000000789Z")).toBe(false);
      expect(await storedDecisionsOf(accountId)).toEqual([
        {
          decision: "withdraw",
          decidedAt: "2026-11-05T10:00:00.123456Z",
          source: "banner",
        },
        {
          decision: "grant",
          decidedAt: "2026-11-06T10:00:00Z",
          source: "hydration_mirror",
        },
      ]);
    });

    test("treats a date in the future by less than a microsecond as undated", async () => {
      const accountId = await newAccount();
      await runLedgerAt("2026-11-05T10:00:00Z", (ledger) =>
        ledger.record({
          accountId,
          decision: "withdraw",
          locale: "cs-CZ",
          source: "banner",
        })
      );

      expect(
        await mirrorAt("2026-11-07T10:00:00.123456100Z", {
          accountId,
          decision: "grant",
          source: "hydration_mirror",
          decidedAt: "2026-11-07T10:00:00.123456999Z",
        })
      ).toBe(false);
      expect((await currentDecisionOf(accountId))?.decision).toBe("withdraw");
    });

    test("keeps each account's decisions apart", async () => {
      const decided = await newAccount();
      const other = await newAccount();
      await runLedgerAt("2026-11-05T10:00:00Z", (ledger) =>
        ledger.record({
          accountId: decided,
          decision: "withdraw",
          locale: "cs-CZ",
          source: "banner",
        })
      );

      expect(
        await mirrorAt("2026-11-07T10:00:00Z", {
          accountId: other,
          decision: "grant",
          source: "sign_in_mirror",
          decidedAt: "2026-11-01T10:00:00Z",
        })
      ).toBe(true);
      expect((await currentDecisionOf(decided))?.decision).toBe("withdraw");
      expect((await currentDecisionOf(other))?.decision).toBe("grant");
    });
  });

  test("deletes the account's decisions with its login", async () => {
    const accountId = await newAccount();
    const kept = await newAccount();
    for (const id of [accountId, kept]) {
      await runLedgerAt("2026-11-05T10:00:00Z", (ledger) =>
        ledger.record({
          accountId: id,
          decision: "grant",
          locale: "cs-CZ",
          source: "banner",
        })
      );
    }

    await Effect.runPromise(
      testDatabase!.db.delete(authUser).where(eq(authUser.id, accountId))
    );

    expect(await storedDecisionsOf(accountId)).toEqual([]);
    expect(await storedDecisionsOf(kept)).toHaveLength(1);
  });

  test("stores only the known decisions and sources", async () => {
    const accountId = await newAccount();
    const insert = (row: Record<string, string>) =>
      Effect.runPromise(
        testDatabase!.db.insert(accountAnalyticsConsentDecisions).values({
          accountId,
          decision: "grant",
          documentHash: privacyNoticeHash("cs-CZ"),
          locale: "cs-CZ",
          decidedAt: Temporal.Instant.from("2026-11-05T10:00:00Z"),
          source: "banner",
          ...row,
        } as typeof accountAnalyticsConsentDecisions.$inferInsert)
      );

    for (const source of [
      "banner",
      "sign_in_mirror",
      "hydration_mirror",
      "backfill",
      "preference",
      "app_mirror",
    ]) {
      await insert({ source });
    }
    await expect(insert({ decision: "accept" })).rejects.toThrow();
    await expect(insert({ source: "cookie" })).rejects.toThrow();
    await expect(insert({ locale: "fr-FR" })).rejects.toThrow();
  });
});
