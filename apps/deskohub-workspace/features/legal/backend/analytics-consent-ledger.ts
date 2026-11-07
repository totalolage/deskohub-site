import "server-only";

import { and, desc, eq, gte, notExists, type SQL, sql } from "drizzle-orm";
import { Context, Data, Effect, Layer, Option } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import { accountAnalyticsConsentDecisions as decisions } from "@/db/schema";
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
export type StoredAnalyticsConsentDecision = {
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
   * privacy notice of the locale.
   */
  readonly record: (
    input: AnalyticsConsentDecisionRecord
  ) => Effect.Effect<void, AnalyticsConsentUnavailable>;
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
 */
export class AnalyticsConsentLedger extends Context.Service<
  AnalyticsConsentLedger,
  IAnalyticsConsentLedger
>()("@deskohub-workspace/legal/AnalyticsConsentLedger") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const { db } = yield* WorkspaceDatabase;

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
       * Appends the decision in one statement, unless the account already
       * holds a decision the condition matches.
       */
      const appendUnless = (
        decision: ReturnType<typeof storedDecision>,
        superseding: SQL | undefined
      ) =>
        db
          .insert(decisions)
          .select((qb) =>
            qb
              .select({
                id: sql<string>`uuid_generate_v7()::text`.as("id"),
                accountId: sql<string>`${decision.accountId}`.as("account_id"),
                decision: sql<string>`${decision.decision}`.as("decision"),
                documentHash: sql<string>`${decision.documentHash}`.as(
                  "document_hash"
                ),
                locale: sql<string>`${decision.locale}`.as("locale"),
                decidedAt: sql<string>`${sql.param(
                  decision.decidedAt,
                  decisions.decidedAt
                )}::timestamptz`.as("decided_at"),
                source: sql<string>`${decision.source}`.as("source"),
                createdAt: sql<string>`now()`.as("created_at"),
              })
              .from(sql`(select 1) as decision_candidate`)
              .where(
                notExists(
                  qb
                    .select({ found: sql`1` })
                    .from(decisions)
                    .where(
                      and(
                        eq(decisions.accountId, decision.accountId),
                        superseding
                      )
                    )
                )
              )
          )
          .returning({ id: decisions.id });

      return {
        record: Effect.fn("AnalyticsConsentLedger.record")(function* (input) {
          yield* db
            .insert(decisions)
            .values(storedDecision(input, yield* currentPreciseInstant));
        }, Effect.mapError(unavailable)),
        mirror: Effect.fn("AnalyticsConsentLedger.mirror")(function* (input) {
          const now = yield* currentPreciseInstant;
          // A future date would outrank every later decision, and dating it
          // now would let each replay of the same copy outrank them again.
          const decidedAt = Option.filter(
            input.decidedAt,
            (instant) => Temporal.Instant.compare(instant, now) <= 0
          );
          const appended = yield* Option.match(decidedAt, {
            // An undated decision seeds only an empty ledger.
            onNone: () => appendUnless(storedDecision(input, now), undefined),
            onSome: (dated) =>
              appendUnless(
                storedDecision(input, dated),
                gte(
                  decisions.decidedAt,
                  sql`${sql.param(dated, decisions.decidedAt)}::timestamptz`
                )
              ),
          });
          return appended.length > 0;
        }, Effect.mapError(unavailable)),
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
