import type { DotyposCustomerId } from "@deskohub/dotypos";
import { eq } from "drizzle-orm";
import { Context, Data, Effect, Layer } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import { customerAccounts } from "@/db/schema";
import { authUser } from "@/db/schema/auth";
import type { Locale } from "@/features/i18n";

/**
 * A linked account's reservation-email language read could not be completed.
 * The caller must distinguish it from a reservation that has no saved
 * preference.
 */
class CustomerEmailLocaleReadError extends Data.TaggedError(
  "CustomerEmailLocaleReadError"
)<{
  readonly code: "customer-email-locale.read";
}> {}

/**
 * The reservation-email language of one reservation customer: a linked
 * account with a saved language preference uses it, while an unlinked
 * guest or an account without a preference keeps the reservation's own
 * locale.
 */
type CustomerEmailLocale =
  | { readonly kind: "guest" }
  | { readonly kind: "account"; readonly locale: Locale };

export interface ICustomerEmailLocaleService {
  readonly byDotyposCustomer: (
    dotyposCustomerId: DotyposCustomerId
  ) => Effect.Effect<CustomerEmailLocale, CustomerEmailLocaleReadError>;
}

/**
 * Resolves the customer's saved locale preference behind reservation
 * customer emails through the durable Dotypos customer link and the
 * account's locale field, without exposing account, session, or profile data.
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
          .select({ locale: authUser.locale })
          .from(customerAccounts)
          .leftJoin(authUser, eq(authUser.id, customerAccounts.id))
          .where(eq(customerAccounts.dotyposCustomerId, dotyposCustomerId))
          .limit(1)
          .pipe(
            Effect.mapError(
              () =>
                new CustomerEmailLocaleReadError({
                  code: "customer-email-locale.read",
                })
            ),
            Effect.map(
              (rows): CustomerEmailLocale =>
                rows[0]?.locale
                  ? { kind: "account", locale: rows[0].locale }
                  : { kind: "guest" }
            )
          );

      return { byDotyposCustomer } satisfies ICustomerEmailLocaleService;
    })
  );

  static Live = this.Default.pipe(Layer.provide(WorkspaceDatabase.Default));
}
