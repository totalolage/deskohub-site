import { Context, Layer } from "effect";
import {
  type AccountReleaseLayers,
  type AccountServiceLayers,
  liveAccountServiceLayers,
  runAccountReleaseLayers,
} from "@/features/account/backend/account-state-capabilities";
import { AnalyticsPersonAnonymisation } from "@/features/account/backend/analytics-person-anonymisation";
import { CustomerAccountDeletionEndpoint } from "@/features/account/backend/auth/delete-account-endpoint";
import type { CustomerAuthentication } from "@/features/account/backend/customer-authentication.service";
import { CustomerLocalePreference } from "@/features/account/backend/customer-locale-preference.service";
import { AnalyticsConsentLedger } from "@/features/legal/backend/analytics-consent-ledger";
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
  /** The ledger of the account's analytics consent decisions. */
  readonly analyticsConsentLedger: Layer.Layer<
    AnalyticsConsentLedger,
    Layer.Error<typeof AnalyticsConsentLedger.Live>
  >;
  /** The PostHog person anonymisation an analytics withdrawal requests. */
  readonly analyticsPersonAnonymisation: Layer.Layer<
    AnalyticsPersonAnonymisation,
    Layer.Error<typeof AnalyticsPersonAnonymisation.Live>
  >;
  /** The account's locale preference, under the request's authentication. */
  readonly localePreference: Layer.Layer<
    CustomerLocalePreference,
    Layer.Error<typeof CustomerLocalePreference.Live>,
    CustomerAuthentication
  >;
};

interface ICustomerAccountLayers {
  readonly services: CustomerAccountServiceLayers;
  /**
   * The release gates, each decided once per build, so an endpoint that
   * reads one builds it per request.
   */
  readonly releases: AccountReleaseLayers;
}

/**
 * The account Layers each customer API request builds its operation from,
 * inside the request's Workspace request context, so a Layer that can't be
 * built fails only the requests that use it, as unavailable. An endpoint
 * whose Layers carry a release gate provides them with `providePerRequest`,
 * so the gate decides once for its request alone.
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
      analyticsConsentLedger: AnalyticsConsentLedger.Live,
      analyticsPersonAnonymisation: AnalyticsPersonAnonymisation.Live,
      localePreference: CustomerLocalePreference.Live,
    },
    releases: runAccountReleaseLayers,
  });
}
