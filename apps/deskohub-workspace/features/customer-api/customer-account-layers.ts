import { Context, Layer } from "effect";
import {
  type AccountReleaseLayers,
  type AccountServiceLayers,
  liveAccountServiceLayers,
  runAccountReleaseLayers,
} from "@/features/account/backend/account-state-capabilities";
import { CustomerAccountDeletionEndpoint } from "@/features/account/backend/auth/delete-account-endpoint";
import { MarketingConsentLedger } from "@/features/legal/backend/marketing-consent-ledger";
import { MarketingPreferences } from "@/features/legal/backend/marketing-preferences.service";

/**
 * The account services' Layers. The request's authentication is the one the
 * session middleware read through, so it isn't here.
 */
export type CustomerAccountServiceLayers = Omit<
  AccountServiceLayers,
  "authentication"
> & {
  /** Marketing preferences under the signed-in account's authority only. */
  readonly marketingPreferences: Layer.Layer<
    MarketingPreferences,
    Layer.Error<typeof MarketingPreferences.AccountScoped>
  >;
  /** The consent ledger marketing preferences read and record through. */
  readonly consentLedger: Layer.Layer<
    MarketingConsentLedger,
    Layer.Error<typeof MarketingConsentLedger.Live>
  >;
  /** Better Auth's delete-user endpoint. */
  readonly accountDeletion: Layer.Layer<CustomerAccountDeletionEndpoint>;
};

interface ICustomerAccountLayers {
  readonly services: CustomerAccountServiceLayers;
  /** The release gates, built once per request. */
  readonly releases: AccountReleaseLayers;
}

/**
 * The account Layers each customer API request builds its operation from.
 * An endpoint provides them per request, inside the request's Workspace
 * request context, so a release gate decides once per request and a Layer
 * that can't be built fails only the requests that use it, as unavailable.
 */
export class CustomerAccountLayers extends Context.Service<
  CustomerAccountLayers,
  ICustomerAccountLayers
>()("@deskohub-workspace/customer-api/CustomerAccountLayers") {
  static Live = Layer.succeed(this, {
    services: {
      ...liveAccountServiceLayers,
      marketingPreferences: MarketingPreferences.AccountScoped,
      consentLedger: MarketingConsentLedger.Live,
      accountDeletion: CustomerAccountDeletionEndpoint.Default,
    },
    releases: runAccountReleaseLayers,
  });
}
