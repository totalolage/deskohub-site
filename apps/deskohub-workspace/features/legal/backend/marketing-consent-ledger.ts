import "server-only";

import { and, eq, isNull, lt, or, type SQL, sql } from "drizzle-orm";
import { type AnyPgColumn, alias } from "drizzle-orm/pg-core";
import { Context, Data, Effect, Layer } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import { qualifiedColumn } from "@/db/qualified-column";
import { customerMarketingConsents } from "@/db/schema";
import type { Locale } from "@/features/i18n";
import { getLegalDocumentVersion } from "@/features/legal/document-version";
import type { MarketingConsentGrantSource } from "@/features/legal/marketing-consent-grant-source";
import type { MarketingConsentStatus } from "@/features/legal/marketing-consent-status";
import type { DotyposCustomerId } from "@/features/reservation/dotypos-customer";
import { currentInstant, currentPreciseInstant } from "@/shared/utils/temporal";

/** The marketing consent ledger could not be read or written. */
export class MarketingConsentUnavailable extends Data.TaggedError(
  "MarketingConsentUnavailable"
)<{ readonly cause: unknown }> {}

/**
 * A customer's marketing consent choice. An initial grant, such as a checked
 * reservation-form box, never overwrites a recorded consent or withdrawal. An
 * explicit grant, from account settings or the signed email link, renews the
 * consent and reactivates a withdrawn one, unless the withdrawal is newer.
 */
type MarketingConsentChoice =
  | {
      readonly choice: "grant";
      readonly mode: "initial" | "explicit";
      readonly channel: MarketingConsentGrantSource;
    }
  | { readonly choice: "withdraw" };

export type MarketingConsentRecord = {
  readonly customerId: DotyposCustomerId;
  /** The locale of the marketing document the customer was shown. */
  readonly locale: Locale;
} & MarketingConsentChoice;

export interface IMarketingConsentLedger {
  /**
   * Records the choice against the current marketing-communications document
   * of the locale, at the current instant. A withdrawal wins over any grant
   * that is not newer than it.
   */
  readonly record: (
    input: MarketingConsentRecord
  ) => Effect.Effect<void, MarketingConsentUnavailable>;
  readonly status: (
    customerId: DotyposCustomerId
  ) => Effect.Effect<MarketingConsentStatus, MarketingConsentUnavailable>;
  /**
   * Withdraws an active consent and reports whether it did. A withdrawn or
   * missing consent stays as it is, so repeating the request changes nothing.
   */
  readonly withdrawActive: (
    customerId: DotyposCustomerId
  ) => Effect.Effect<boolean, MarketingConsentUnavailable>;
}

/** A stored consent's state. A consent is active until it is withdrawn. */
const storedConsentState = (withdrawnAt: AnyPgColumn) =>
  sql<
    Exclude<MarketingConsentStatus, "absent">
  >`case when ${qualifiedColumn(withdrawnAt)} is null then 'active' else 'withdrawn' end`;

const consentOfCustomerAlias = "consent_of_customer";
const consentOfCustomer = alias(
  customerMarketingConsents,
  consentOfCustomerAlias
);

/**
 * The current marketing consent state of the customer whose Dotypos ID the
 * column holds, for a query over many customers. It is the one definition of
 * an active consent: campaign audiences, delivery and administration select
 * and filter by it inside their own queries. A query over the consent table
 * may pass its own key.
 */
export const marketingConsentState = (
  customerId: AnyPgColumn<{ data: DotyposCustomerId }>
): SQL<MarketingConsentStatus> =>
  sql<MarketingConsentStatus>`coalesce((
    select ${storedConsentState(consentOfCustomer.withdrawnAt)}
    from ${customerMarketingConsents} as ${sql.identifier(consentOfCustomerAlias)}
    where ${qualifiedColumn(consentOfCustomer.dotyposCustomerId)} = ${qualifiedColumn(customerId)}
  ), 'absent')`;

const unavailable = (cause: unknown) =>
  new MarketingConsentUnavailable({ cause });

/**
 * A customer's marketing consent: one row per Dotypos customer, holding the
 * version of the marketing document the current grant was given for, when and
 * where it was given, and when it was withdrawn.
 */
export class MarketingConsentLedger extends Context.Service<
  MarketingConsentLedger,
  IMarketingConsentLedger
>()("@deskohub-workspace/legal/MarketingConsentLedger") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const { db } = yield* WorkspaceDatabase;

      const grantInitial = (
        consent: typeof customerMarketingConsents.$inferInsert
      ) =>
        db
          .insert(customerMarketingConsents)
          .values(consent)
          .onConflictDoNothing();

      const grant = (consent: typeof customerMarketingConsents.$inferInsert) =>
        db
          .insert(customerMarketingConsents)
          .values(consent)
          .onConflictDoUpdate({
            target: customerMarketingConsents.dotyposCustomerId,
            set: {
              documentHash: consent.documentHash,
              locale: consent.locale,
              grantedAt: consent.grantedAt,
              withdrawnAt: null,
              grantSource: consent.grantSource,
            },
            // A withdrawal wins over a grant that is not newer than it, so a
            // delayed grant cannot undo the customer's latest withdrawal.
            setWhere: or(
              isNull(customerMarketingConsents.withdrawnAt),
              lt(
                customerMarketingConsents.withdrawnAt,
                sql.param(
                  consent.grantedAt,
                  customerMarketingConsents.grantedAt
                )
              )
            ),
          });

      const withdraw = (
        consent: Omit<
          typeof customerMarketingConsents.$inferInsert,
          "grantSource" | "withdrawnAt"
        >
      ) =>
        db
          .insert(customerMarketingConsents)
          .values({ ...consent, withdrawnAt: consent.grantedAt })
          .onConflictDoUpdate({
            target: customerMarketingConsents.dotyposCustomerId,
            set: {
              withdrawnAt: sql`greatest(
                ${customerMarketingConsents.grantedAt},
                coalesce(
                  ${customerMarketingConsents.withdrawnAt},
                  ${customerMarketingConsents.grantedAt}
                ),
                ${sql.param(consent.grantedAt, customerMarketingConsents.grantedAt)}
              )`,
            },
          });

      return {
        record: Effect.fn("MarketingConsentLedger.record")(function* (input) {
          // The instant is read once, before the statement, so waiting on
          // a concurrent write cannot make a grant look newer than it was.
          const consent = {
            dotyposCustomerId: input.customerId,
            documentHash: getLegalDocumentVersion(
              input.locale,
              "marketing-communications"
            ),
            locale: input.locale,
            grantedAt: yield* currentPreciseInstant,
          };
          if (input.choice === "withdraw") {
            yield* withdraw(consent);
          } else if (input.mode === "initial") {
            yield* grantInitial({ ...consent, grantSource: input.channel });
          } else {
            yield* grant({ ...consent, grantSource: input.channel });
          }
        }, Effect.mapError(unavailable)),
        status: Effect.fn("MarketingConsentLedger.status")(function* (
          customerId
        ) {
          const [consent] = yield* db
            .select({
              state: storedConsentState(customerMarketingConsents.withdrawnAt),
            })
            .from(customerMarketingConsents)
            .where(eq(customerMarketingConsents.dotyposCustomerId, customerId))
            .limit(1);
          return consent?.state ?? "absent";
        }, Effect.mapError(unavailable)),
        withdrawActive: Effect.fn("MarketingConsentLedger.withdrawActive")(
          function* (customerId) {
            // One-click unsubscribe has always recorded the millisecond.
            const withdrawnAt = yield* currentInstant;
            const withdrawn = yield* db
              .update(customerMarketingConsents)
              .set({ withdrawnAt })
              .where(
                and(
                  eq(customerMarketingConsents.dotyposCustomerId, customerId),
                  eq(
                    storedConsentState(customerMarketingConsents.withdrawnAt),
                    "active"
                  )
                )
              )
              .returning({
                dotyposCustomerId: customerMarketingConsents.dotyposCustomerId,
              });
            return withdrawn.length > 0;
          },
          Effect.mapError(unavailable)
        ),
      } satisfies IMarketingConsentLedger;
    })
  );

  static Live = this.Default.pipe(Layer.provide(WorkspaceDatabase.Default));
}
