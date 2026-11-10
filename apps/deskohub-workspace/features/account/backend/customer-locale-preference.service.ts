import { Context, Effect, Layer } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import type { Locale } from "@/features/i18n";
import type {
  CustomerAccountAccessError,
  CustomerAccountId,
} from "../customer-account";
import { CustomerAccountSections } from "./customer-account-sections";
import { saveAccountLocalePreference } from "./customer-locale-preference";

interface ICustomerLocalePreference {
  /** `saveAccountLocalePreference` under the request's authentication. */
  readonly save: (
    accountId: CustomerAccountId,
    locale: Locale
  ) => Effect.Effect<void, CustomerAccountAccessError>;
}

/**
 * The locale preference save for a caller that builds its services per
 * request, such as the customer HTTP API. Its account section reads the
 * session through the request's `CustomerAuthentication`.
 */
export class CustomerLocalePreference extends Context.Service<
  CustomerLocalePreference,
  ICustomerLocalePreference
>()("@deskohub-workspace/account/CustomerLocalePreference") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const context = yield* Effect.context<
        WorkspaceDatabase | CustomerAccountSections
      >();
      return {
        save: (accountId, locale) =>
          saveAccountLocalePreference(accountId, locale).pipe(
            Effect.provideContext(context)
          ),
      } satisfies ICustomerLocalePreference;
    })
  );

  static Live = this.Default.pipe(
    Layer.provide(
      Layer.mergeAll(
        WorkspaceDatabase.Default,
        CustomerAccountSections.ForProvidedAuthentication
      )
    )
  );
}
