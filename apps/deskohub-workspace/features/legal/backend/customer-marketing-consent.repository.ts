import "server-only";

import { isNotNull } from "drizzle-orm";
import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import { Context, Effect, Layer } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import { customerMarketingConsents } from "@/db/schema";
import type { Locale } from "@/features/i18n";
import type { DotyposCustomerId } from "@/features/reservation/dotypos-customer";

export type GrantCustomerMarketingConsentInput = {
  readonly dotyposCustomerId: DotyposCustomerId;
  readonly documentHash: string;
  readonly locale: Locale;
  readonly grantedAt: Temporal.Instant;
};

export interface ICustomerMarketingConsentRepository {
  readonly grant: (
    input: GrantCustomerMarketingConsentInput
  ) => Effect.Effect<void, EffectDrizzleQueryError>;
}

export class CustomerMarketingConsentRepository extends Context.Service<
  CustomerMarketingConsentRepository,
  ICustomerMarketingConsentRepository
>()("@deskohub-workspace/legal/CustomerMarketingConsentRepository") {
  static Live = Layer.effect(
    this,
    Effect.gen(function* () {
      const { db } = yield* WorkspaceDatabase;

      return {
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
                setWhere: isNotNull(customerMarketingConsents.withdrawnAt),
              });
          }
        ),
      } satisfies ICustomerMarketingConsentRepository;
    })
  );
}
