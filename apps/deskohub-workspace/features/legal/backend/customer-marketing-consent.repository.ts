import "server-only";

import { and, eq, isNull, lt, or, sql } from "drizzle-orm";
import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import { Context, Effect, Layer } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import { customerMarketingConsents } from "@/db/schema";
import type { CustomerMarketingConsent } from "@/db/schema/customer-marketing-consents";
import type { Locale } from "@/features/i18n";
import type { MarketingConsentGrantSource } from "@/features/legal/marketing-consent-grant-source";
import type { DotyposCustomerId } from "@/features/reservation/dotypos-customer";

export type WithdrawCustomerMarketingConsentInput = {
  readonly dotyposCustomerId: DotyposCustomerId;
  readonly documentHash: string;
  readonly locale: Locale;
  readonly grantedAt: Temporal.Instant;
};

export type GrantCustomerMarketingConsentInput =
  WithdrawCustomerMarketingConsentInput & {
    readonly source: MarketingConsentGrantSource;
  };

export interface ICustomerMarketingConsentRepository {
  readonly grantInitial: (
    input: GrantCustomerMarketingConsentInput
  ) => Effect.Effect<void, EffectDrizzleQueryError>;
  readonly grant: (
    input: GrantCustomerMarketingConsentInput
  ) => Effect.Effect<void, EffectDrizzleQueryError>;
  readonly get: (
    customerId: DotyposCustomerId
  ) => Effect.Effect<CustomerMarketingConsent | null, EffectDrizzleQueryError>;
  readonly withdraw: (
    input: WithdrawCustomerMarketingConsentInput
  ) => Effect.Effect<void, EffectDrizzleQueryError>;
  /**
   * Withdraws an active consent and reports whether it did. A withdrawn or
   * missing consent stays as it is, so repeating the request changes nothing.
   */
  readonly withdrawActive: (input: {
    readonly dotyposCustomerId: DotyposCustomerId;
    readonly withdrawnAt: Temporal.Instant;
  }) => Effect.Effect<boolean, EffectDrizzleQueryError>;
}

export class CustomerMarketingConsentRepository extends Context.Service<
  CustomerMarketingConsentRepository,
  ICustomerMarketingConsentRepository
>()("@deskohub-workspace/legal/CustomerMarketingConsentRepository") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const { db } = yield* WorkspaceDatabase;

      return {
        grantInitial: Effect.fn(
          "CustomerMarketingConsentRepository.grantInitial"
        )(function* ({ source, ...input }) {
          yield* db
            .insert(customerMarketingConsents)
            .values({ ...input, grantSource: source })
            .onConflictDoNothing();
        }),
        grant: Effect.fn("CustomerMarketingConsentRepository.grant")(
          function* ({ source, ...input }) {
            yield* db
              .insert(customerMarketingConsents)
              .values({ ...input, grantSource: source })
              .onConflictDoUpdate({
                target: customerMarketingConsents.dotyposCustomerId,
                set: {
                  documentHash: input.documentHash,
                  locale: input.locale,
                  grantedAt: input.grantedAt,
                  withdrawnAt: null,
                  grantSource: source,
                },
                // A withdrawal wins over a grant that is not newer than it, so
                // a delayed grant cannot undo the customer's latest withdrawal.
                setWhere: or(
                  isNull(customerMarketingConsents.withdrawnAt),
                  lt(
                    customerMarketingConsents.withdrawnAt,
                    sql.param(
                      input.grantedAt,
                      customerMarketingConsents.grantedAt
                    )
                  )
                ),
              });
          }
        ),
        get: Effect.fn("CustomerMarketingConsentRepository.get")(
          function* (customerId) {
            const [consent] = yield* db
              .select()
              .from(customerMarketingConsents)
              .where(
                eq(customerMarketingConsents.dotyposCustomerId, customerId)
              )
              .limit(1);
            return consent ?? null;
          }
        ),
        withdraw: Effect.fn("CustomerMarketingConsentRepository.withdraw")(
          function* (input) {
            yield* db
              .insert(customerMarketingConsents)
              .values({
                ...input,
                withdrawnAt: input.grantedAt,
              })
              .onConflictDoUpdate({
                target: customerMarketingConsents.dotyposCustomerId,
                set: {
                  withdrawnAt: sql`greatest(
                    ${customerMarketingConsents.grantedAt},
                    coalesce(
                      ${customerMarketingConsents.withdrawnAt},
                      ${customerMarketingConsents.grantedAt}
                    ),
                    ${sql.param(input.grantedAt, customerMarketingConsents.grantedAt)}
                  )`,
                },
              });
          }
        ),
        withdrawActive: Effect.fn(
          "CustomerMarketingConsentRepository.withdrawActive"
        )(function* (input) {
          const withdrawn = yield* db
            .update(customerMarketingConsents)
            .set({ withdrawnAt: input.withdrawnAt })
            .where(
              and(
                eq(
                  customerMarketingConsents.dotyposCustomerId,
                  input.dotyposCustomerId
                ),
                isNull(customerMarketingConsents.withdrawnAt)
              )
            )
            .returning({
              dotyposCustomerId: customerMarketingConsents.dotyposCustomerId,
            });
          return withdrawn.length > 0;
        }),
      } satisfies ICustomerMarketingConsentRepository;
    })
  );

  static Live = this.Default.pipe(Layer.provide(WorkspaceDatabase.Default));
}
