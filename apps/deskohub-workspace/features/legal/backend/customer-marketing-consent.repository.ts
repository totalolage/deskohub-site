import "server-only";

import { eq, sql } from "drizzle-orm";
import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import { Context, Effect, Layer } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import { customerMarketingConsents } from "@/db/schema";
import type { CustomerMarketingConsent } from "@/db/schema/customer-marketing-consents";
import type { Locale } from "@/features/i18n";
import type { DotyposCustomerId } from "@/features/reservation/dotypos-customer";

export type GrantCustomerMarketingConsentInput = {
  readonly dotyposCustomerId: DotyposCustomerId;
  readonly documentHash: string;
  readonly locale: Locale;
  readonly grantedAt: Temporal.Instant;
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
    input: GrantCustomerMarketingConsentInput
  ) => Effect.Effect<void, EffectDrizzleQueryError>;
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
        )(function* (input) {
          yield* db
            .insert(customerMarketingConsents)
            .values(input)
            .onConflictDoNothing();
        }),
        grant: Effect.fn("CustomerMarketingConsentRepository.grant")(
          function* (input) {
            yield* db
              .insert(customerMarketingConsents)
              .values(input)
              .onConflictDoUpdate({
                target: customerMarketingConsents.dotyposCustomerId,
                set: {
                  documentHash: input.documentHash,
                  locale: input.locale,
                  grantedAt: input.grantedAt,
                  withdrawnAt: null,
                },
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
      } satisfies ICustomerMarketingConsentRepository;
    })
  );
}
