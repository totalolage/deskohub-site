import "server-only";

import { NexiOrderIdSchema } from "@deskohub/nexi";
import { Effect, type Layer, Option } from "effect";
import { NextResponse } from "next/server";
import { CustomerAuthentication } from "@/features/account/backend/customer-authentication.service";
import { SavedCardService } from "@/features/account/backend/saved-card/saved-card.service";
import { areAccountsEnabled } from "@/features/account/server/account-feature-flag.server";
import type { Locale } from "@/features/i18n";
import { getLocalizedParamsDecoder } from "@/features/i18n/server/route-params";
import {
  defineWorkspaceRoute,
  WorkspaceRouteFailure,
} from "@/shared/backend/workspace-route";

type LocalizedSavedCardRouteContext = {
  readonly params: Promise<{ locale: string; orderId: string }>;
};

/** Fixed, non-PII flow flags carried to the account page. */
export type SavedCardFlowFlag =
  | "confirmed"
  | "cancelled"
  | "failed"
  | "pending";

export type SavedCardEnrollmentOutcomeForRedirect =
  | "confirmed"
  | "cancelled"
  | "failed"
  | "pending"
  | "not_found";

const decodeSavedCardParams = getLocalizedParamsDecoder({
  orderId: NexiOrderIdSchema,
});

const redirectResponse = (location: string) =>
  new NextResponse(null, {
    status: 302,
    headers: {
      Location: location,
      "Cache-Control": "private, no-store",
      "Referrer-Policy": "no-referrer",
    },
  });

const accountLocation = (locale: Locale, flow?: SavedCardFlowFlag) => {
  const path = new URL(`/${locale}/account`, "https://local");
  path.searchParams.set("section", "billing");
  if (flow) path.searchParams.set("cardFlow", flow);
  return `${path.pathname}${path.search}`;
};

const signInLocation = (locale: Locale) =>
  `/${locale}/auth/sign-in?cardFlow=session`;

/**
 * Maps a verification outcome onto the fixed flow flag set. Unknown orders
 * reveal nothing and land on the plain account page.
 */
export const savedCardOutcomeToFlow = (
  outcome: SavedCardEnrollmentOutcomeForRedirect
): SavedCardFlowFlag | undefined =>
  outcome === "not_found" ? undefined : outcome;

const makeSavedCardReturnHandler = (
  kind: "return" | "cancel",
  serviceLayer: Layer.Layer<SavedCardService, unknown>,
  authenticationLayer: Layer.Layer<CustomerAuthentication, unknown>
) => {
  const handleSavedCardReturn = Effect.fn(
    kind === "return"
      ? "SavedCardReturnRoute.handleReturn"
      : "SavedCardReturnRoute.handleCancel"
  )(function* (context: LocalizedSavedCardRouteContext) {
    const decodedParams = decodeSavedCardParams(
      yield* Effect.promise(() => context.params)
    );
    const routeParams = Option.getOrUndefined(decodedParams);
    if (!routeParams) return redirectResponse("/en-US/account");

    const { locale, orderId } = routeParams;

    const accountsEnabled = yield* Effect.promise(areAccountsEnabled);
    if (!accountsEnabled) return redirectResponse(accountLocation(locale));

    const accountId = yield* Effect.flatMap(
      CustomerAuthentication,
      (authentication) => authentication.currentUser
    ).pipe(
      Effect.provide(authenticationLayer),
      Effect.option,
      Effect.map((option) => Option.getOrUndefined(option)?.accountId)
    );
    if (!accountId) return redirectResponse(signInLocation(locale));

    const outcome = yield* Effect.flatMap(SavedCardService, (service) =>
      kind === "return"
        ? service.verifyEnrollment({ accountId, orderId })
        : service.cancelEnrollment({ accountId, orderId })
    ).pipe(
      Effect.provide(serviceLayer),
      // Browser-triggered returns never fail the redirect: an unavailable
      // provider lands on the account page as pending.
      Effect.orElseSucceed(() => "pending" as const)
    );

    return redirectResponse(
      accountLocation(locale, savedCardOutcomeToFlow(outcome))
    );
  });

  return defineWorkspaceRoute(
    {
      operation:
        kind === "return" ? "account.card.return" : "account.card.cancel",
      cancellation: "continue-after-disconnect",
    },
    (_request: Request, context: LocalizedSavedCardRouteContext) =>
      handleSavedCardReturn(context).pipe(
        Effect.mapError(
          WorkspaceRouteFailure.internal("Saved card return could not complete")
        )
      )
  );
};

/** GET handler for the provider-redirected enrollment return. */
export const makeSavedCardReturnGet = (
  serviceLayer: Layer.Layer<SavedCardService, unknown> = SavedCardService.Live,
  authenticationLayer: Layer.Layer<
    CustomerAuthentication,
    unknown
  > = CustomerAuthentication.Default
) => makeSavedCardReturnHandler("return", serviceLayer, authenticationLayer);

/** GET handler for the provider-redirected enrollment cancellation. */
export const makeSavedCardCancelGet = (
  serviceLayer: Layer.Layer<SavedCardService, unknown> = SavedCardService.Live,
  authenticationLayer: Layer.Layer<
    CustomerAuthentication,
    unknown
  > = CustomerAuthentication.Default
) => makeSavedCardReturnHandler("cancel", serviceLayer, authenticationLayer);
