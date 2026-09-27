import type { DotyposCustomerId } from "@deskohub/dotypos";
import { eq } from "drizzle-orm";
import { Context, Data, Effect, Layer } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import { customerCommunicationPreferences } from "@/db/schema";
import { customerAccountLinks } from "@/db/schema/customer-account-links";
import type { Locale } from "@/features/i18n";

/**
 * A linked account's reservation-email language read could not be completed,
 * or the linked account has no required preference row. Both are operational
 * failures the caller must distinguish from an unlinked guest reservation.
 */
export class CustomerEmailLocaleReadError extends Data.TaggedError(
  "CustomerEmailLocaleReadError"
)<{
  readonly code: "customer-email-locale.read" | "customer-email-locale.missing";
}> {}

/**
 * The reservation-email language of one reservation customer: an unlinked
 * guest keeps the reservation's own locale, while a linked account always
 * uses its required saved communication preference.
 */
export type CustomerEmailLocale =
  | { readonly kind: "guest" }
  | { readonly kind: "account"; readonly locale: Locale };

export interface ICustomerEmailLocaleService {
  readonly byDotyposCustomer: (
    dotyposCustomerId: DotyposCustomerId
  ) => Effect.Effect<CustomerEmailLocale, CustomerEmailLocaleReadError>;
}

/**
 * Resolves the durable communication-language fact behind reservation
 * customer emails through the durable Dotypos customer link and the required
 * preference row, without exposing account, session, or profile data.
 */
export class CustomerEmailLocaleService extends Context.Service<
  CustomerEmailLocaleService,
  ICustomerEmailLocaleService
>()("@deskohub-workspace/account/CustomerEmailLocaleService") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const { db } = yield* WorkspaceDatabase;

      const byDotyposCustomer = (dotyposCustomerId: DotyposCustomerId) =>
        db
          .select({ locale: customerCommunicationPreferences.locale })
          .from(customerAccountLinks)
          .leftJoin(
            customerCommunicationPreferences,
            eq(
              customerCommunicationPreferences.customerAccountId,
              customerAccountLinks.customerAccountId
            )
          )
          .where(eq(customerAccountLinks.dotyposCustomerId, dotyposCustomerId))
          .limit(1)
          .pipe(
            Effect.mapError(
              () =>
                new CustomerEmailLocaleReadError({
                  code: "customer-email-locale.read",
                })
            ),
            Effect.flatMap((rows) => {
              const row = rows[0];
              if (!row) {
                return Effect.succeed({ kind: "guest" } as const);
              }
              if (!row.locale) {
                return new CustomerEmailLocaleReadError({
                  code: "customer-email-locale.missing",
                }) as Effect.Effect<
                  CustomerEmailLocale,
                  CustomerEmailLocaleReadError
                >;
              }
              return Effect.succeed({
                kind: "account",
                locale: row.locale,
              } as const);
            })
          );

      return { byDotyposCustomer } satisfies ICustomerEmailLocaleService;
    })
  );

  static Live = this.Default.pipe(Layer.provide(WorkspaceDatabase.Default));
}
