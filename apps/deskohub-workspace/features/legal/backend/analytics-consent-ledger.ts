import "server-only";

import { desc, eq } from "drizzle-orm";
import { Context, Data, Effect, Layer, Option } from "effect";
import { WorkspaceDatabase, WorkspaceTransaction } from "@/db/database.service";
import { toStoredInstant } from "@/db/instant";
import { accountAnalyticsConsentDecisions as decisions } from "@/db/schema";
import type { DatabaseQueryError } from "@/db/sql-constraint";
import { WorkspaceLocks } from "@/db/workspace-locks";
import type { CustomerAccountId } from "@/features/account/customer-account";
import type { Locale } from "@/features/i18n";
import type {
  AnalyticsConsentDecision,
  AnalyticsConsentDecisionSource,
  AnalyticsConsentMirrorSource,
} from "@/features/legal/analytics-consent-decision";
import { getLegalDocumentVersion } from "@/features/legal/document-version";
import { currentPreciseInstant } from "@/shared/utils/temporal";

/** The analytics consent ledger could not be read or written. */
export class AnalyticsConsentUnavailable extends Data.TaggedError(
  "AnalyticsConsentUnavailable"
)<{ readonly cause: unknown }> {}

type AnalyticsConsentDecisionInput = {
  readonly accountId: CustomerAccountId;
  readonly decision: AnalyticsConsentDecision;
  /** The locale of the privacy notice the account was shown. */
  readonly locale: Locale;
};

/** A decision the account makes now, such as a banner save while signed in. */
export type AnalyticsConsentDecisionRecord = AnalyticsConsentDecisionInput & {
  readonly source: Exclude<
    AnalyticsConsentDecisionSource,
    AnalyticsConsentMirrorSource | "backfill"
  >;
};

/**
 * A decision copied from elsewhere, such as the device's banner choice,
 * dated when it was originally made.
 */
export type AnalyticsConsentMirrorRecord = AnalyticsConsentDecisionInput & {
  readonly source: AnalyticsConsentMirrorSource | "backfill";
  /**
   * When the choice was made; none when its origin holds no date, as a
   * consent cookie without a valid timestamp does.
   */
  readonly decidedAt: Option.Option<Temporal.Instant>;
};

/** A stored analytics consent decision. */
type StoredAnalyticsConsentDecision = {
  readonly decision: AnalyticsConsentDecision;
  /** The privacy notice version the decision was given under. */
  readonly documentHash: string;
  readonly locale: Locale;
  readonly decidedAt: Temporal.Instant;
  readonly source: AnalyticsConsentDecisionSource;
};

export interface IAnalyticsConsentLedger {
  /**
   * Appends the decision, made at the current instant, against the current
   * privacy notice of the locale. Returns the instant it stored, so a copy
   * of the decision, such as the device's consent cookie, can carry it.
   */
  readonly record: (
    input: AnalyticsConsentDecisionRecord
  ) => Effect.Effect<Temporal.Instant, AnalyticsConsentUnavailable>;
  /**
   * Appends the decision, against the current privacy notice of the locale,
   * only when it is newer than every decision the account made, so a stale
   * copy never overrides a later decision. An undated decision, and one
   * dated in the future, which no later decision could outrank, is recorded
   * at the current instant and only into an empty ledger. Reports whether it
   * appended the decision.
   */
  readonly mirror: (
    input: AnalyticsConsentMirrorRecord
  ) => Effect.Effect<boolean, AnalyticsConsentUnavailable>;
  /**
   * The account's current decision: its latest by decision time, so a later
   * grant restores a withdrawn consent. None when the account never decided.
   */
  readonly currentDecision: (
    accountId: CustomerAccountId
  ) => Effect.Effect<
    Option.Option<StoredAnalyticsConsentDecision>,
    AnalyticsConsentUnavailable
  >;
}

const unavailable = (cause: unknown) =>
  new AnalyticsConsentUnavailable({ cause });

/**
 * An account's analytics consent decisions, appended in the order they are
 * made known and never changed. The account's latest decision by its own
 * decision time is its current one; ties go to the decision recorded last.
 * Writes for one account take turns under its ledger lock.
 */
export class AnalyticsConsentLedger extends Context.Service<
  AnalyticsConsentLedger,
  IAnalyticsConsentLedger
>()("@deskohub-workspace/legal/AnalyticsConsentLedger") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const { db, transaction } = yield* WorkspaceDatabase;

      const storedDecision = (
        input: AnalyticsConsentDecisionInput & {
          readonly source: AnalyticsConsentDecisionSource;
        },
        decidedAt: Temporal.Instant
      ) => ({
        accountId: input.accountId,
        decision: input.decision,
        documentHash: getLegalDocumentVersion(input.locale, "privacy-policy"),
        locale: input.locale,
        decidedAt,
        source: input.source,
      });

      /**
       * Runs `write` under the account's ledger lock, so writes for one
       * account take turns. The instant is read after the lock, so a write
       * that waited is never dated before the one it waited for.
       */
      const underLedgerLock = <A>(
        accountId: CustomerAccountId,
        write: (
          now: Temporal.Instant
        ) => Effect.Effect<A, DatabaseQueryError, WorkspaceTransaction>
      ) =>
        transaction(
          Effect.gen(function* () {
            yield* WorkspaceLocks.analyticsConsentLedger(accountId);
            return yield* write(yield* currentPreciseInstant);
          })
        );

      const append = Effect.fnUntraced(function* (
        decision: ReturnType<typeof storedDecision>
      ) {
        const { db } = yield* WorkspaceTransaction;
        yield* db.insert(decisions).values(decision);
      });

      /** When the account's latest decision was made, if it made one. */
      const latestDecisionTime = Effect.fnUntraced(function* (
        accountId: CustomerAccountId
      ) {
        const { db } = yield* WorkspaceTransaction;
        const [latest] = yield* db
          .select({ decidedAt: decisions.decidedAt })
          .from(decisions)
          .where(eq(decisions.accountId, accountId))
          .orderBy(desc(decisions.decidedAt))
          .limit(1);
        return Option.fromNullishOr(latest?.decidedAt);
      });

      return {
        record: Effect.fn("AnalyticsConsentLedger.record")(
          (input) =>
            underLedgerLock(input.accountId, (now) => {
              const decidedAt = toStoredInstant(now);
              return append(storedDecision(input, decidedAt)).pipe(
                Effect.as(decidedAt)
              );
            }),
          Effect.mapError(unavailable)
        ),
        mirror: Effect.fn("AnalyticsConsentLedger.mirror")(
          (input) =>
            underLedgerLock(
              input.accountId,
              Effect.fnUntraced(function* (now) {
                const latest = yield* latestDecisionTime(input.accountId);
                // A future date would outrank every later decision, and
                // dating it now would let each replay of the same copy
                // outrank them again, so it counts as undated.
                // A date is checked against now as given, then compared as
                // the database stores it, so a stored decision and a copy of
                // its own instant compare equal.
                const decidedAt = Option.match(
                  Option.map(
                    Option.filter(
                      input.decidedAt,
                      (instant) => Temporal.Instant.compare(instant, now) <= 0
                    ),
                    toStoredInstant
                  ),
                  {
                    // An undated decision seeds only an empty ledger.
                    onNone: () =>
                      Option.isNone(latest) ? Option.some(now) : Option.none(),
                    onSome: (dated) =>
                      // Only a decision newer than every recorded one is taken.
                      !Option.exists(
                        latest,
                        (made) => Temporal.Instant.compare(dated, made) <= 0
                      )
                        ? Option.some(dated)
                        : Option.none(),
                  }
                );
                if (Option.isNone(decidedAt)) return false;
                yield* append(storedDecision(input, decidedAt.value));
                return true;
              })
            ),
          Effect.mapError(unavailable)
        ),
        currentDecision: Effect.fn("AnalyticsConsentLedger.currentDecision")(
          function* (accountId) {
            const [current] = yield* db
              .select({
                decision: decisions.decision,
                documentHash: decisions.documentHash,
                locale: decisions.locale,
                decidedAt: decisions.decidedAt,
                source: decisions.source,
              })
              .from(decisions)
              .where(eq(decisions.accountId, accountId))
              .orderBy(
                desc(decisions.decidedAt),
                desc(decisions.createdAt),
                desc(decisions.id)
              )
              .limit(1);
            return Option.fromNullishOr(current);
          },
          Effect.mapError(unavailable)
        ),
      } satisfies IAnalyticsConsentLedger;
    })
  );

  static Live = this.Default.pipe(Layer.provide(WorkspaceDatabase.Default));
}
