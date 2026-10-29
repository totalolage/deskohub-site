import "server-only";

import { Effect, Result } from "effect";
import { cookies } from "next/headers";
import { CustomerAccountResolver } from "@/features/account";
import type { Locale } from "@/features/i18n";
import { marketingPreferencesLive } from "@/features/legal/marketing-preferences-composition.server";
import { runWorkspaceEffect } from "@/shared/backend/workspace-effect";
import { MarketingConsentLedger } from "./backend/marketing-consent-ledger";
import { MarketingManagementService } from "./backend/marketing-management.service";
import {
  createMarketingManagementCookies,
  type MarketingManagementCookieOperations,
} from "./backend/marketing-management-cookies.server";
import {
  getMarketingManagementDismissalContext,
  MarketingPreferencesAuthorityError,
  resolveMarketingPreferencesAuthority,
} from "./backend/marketing-preferences-authority";
import type { MarketingPreferencesState } from "./marketing-preferences";

/**
 * Loads the public marketing-preference projection. A management cookie always
 * wins over the account path, and every failure is reduced to the closed
 * public state before it reaches the page or telemetry.
 */
export const getMarketingPreferences = (
  locale: Locale
): Promise<MarketingPreferencesState> =>
  Effect.tryPromise({
    try: () => cookies(),
    catch: () =>
      new MarketingPreferencesAuthorityError({ reason: "unavailable" }),
  }).pipe(
    Effect.flatMap((cookieStore) =>
      getMarketingPreferencesEffect(
        locale,
        createMarketingManagementCookies(cookieStore)
      )
    ),
    // Without a request cookie store no authority can be resolved. This
    // keeps the existing silent unavailable state; every later failure is
    // logged by its error tag in `getMarketingPreferencesEffect`.
    Effect.orElseSucceed(
      (): MarketingPreferencesState => ({ status: "unavailable" })
    ),
    runWorkspaceEffect("legal.marketing-preferences.read", {
      boundary: "page",
    })
  );

export const getMarketingPreferencesEffect = (
  locale: Locale,
  marketingCookies: MarketingManagementCookieOperations,
  layers = marketingPreferencesLive
) =>
  readMarketingPreferencesEffect(marketingCookies).pipe(
    Effect.provide(layers),
    Effect.catch((error) =>
      Effect.logWarning("Marketing preferences are unavailable").pipe(
        Effect.annotateLogs({ failure: error._tag }),
        Effect.as({ status: "unavailable" as const })
      )
    ),
    // The locale is a trusted route value and is safe low-cardinality context;
    // no credential, provider identifier, or database cause is annotated, and
    // a failure is logged only by its fixed error tag.
    Effect.annotateLogs({ locale })
  );

const readMarketingPreferencesEffect = Effect.fn(function* (
  marketingCookies: MarketingManagementCookieOperations
) {
  const cookies = yield* Effect.tryPromise({
    try: marketingCookies.readMarketingManagementCookies,
    catch: () =>
      new MarketingPreferencesAuthorityError({ reason: "unavailable" }),
  });
  const dismissalContext = getMarketingManagementDismissalContext(cookies);
  const management = yield* MarketingManagementService;
  const accountResolver = yield* CustomerAccountResolver;
  const authorityResult = yield* resolveMarketingPreferencesAuthority(cookies, {
    resolveAccount: () => accountResolver.resolve,
    resolveManagementSession: (rawSession) => management.resolve(rawSession),
  }).pipe(Effect.result);

  if (Result.isFailure(authorityResult)) {
    return authorityResult.failure.reason === "invalid-link"
      ? ({
          status: "invalid-link",
          dismissalContext,
        } satisfies MarketingPreferencesState)
      : ({ status: "unavailable" } satisfies MarketingPreferencesState);
  }

  const authority = authorityResult.success;

  if (authority.kind === "pending") {
    return {
      status: "pending-link",
      context: authority.context,
      dismissalContext,
    } satisfies MarketingPreferencesState;
  }

  const ledger = yield* MarketingConsentLedger;
  const status = yield* ledger
    .status(authority.customerId)
    .pipe(
      Effect.mapError(
        () => new MarketingPreferencesAuthorityError({ reason: "unavailable" })
      )
    );

  return authority.kind === "link"
    ? ({
        status,
        source: authority.source,
        context: authority.context,
        dismissalContext,
      } satisfies MarketingPreferencesState)
    : ({
        status,
        source: authority.source,
        context: authority.context,
      } satisfies MarketingPreferencesState);
});
