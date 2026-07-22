import { Effect, Option, Schema } from "effect";
import { NextResponse } from "next/server";
import {
  appendVercelPreviewProtectionBypass,
  type CheckoutStatusReturnOutcome,
  CheckoutStatusServiceLiveWithDependencies,
  refreshCheckoutStatus,
} from "@/features/checkout/backend/checkout";
import { getParamsDecoder } from "@/features/i18n/server/route-params";
import {
  mapWorkspaceInternalRouteFailure,
  WorkspaceEffect,
} from "@/shared/backend/workspace-effect";
import {
  getSearchParamsDecoder,
  type SearchParamsRecord,
} from "@/shared/utils";

type LocalizedCheckoutPaymentRouteContext = {
  readonly params: Promise<{ locale: string; orderId: string }>;
};

const decodeCheckoutPaymentParams = getParamsDecoder({
  orderId: Schema.NonEmptyString,
});

const decodeCheckoutPaymentSearchParams = getSearchParamsDecoder(
  Schema.Struct({
    outcome: Schema.Literals(["success", "cancelled"]),
  })
);

const refreshStatus = (
  orderId: string,
  returnOutcome: CheckoutStatusReturnOutcome
) => refreshCheckoutStatus({ orderId, returnOutcome });

const getCheckoutStatusRedirectPath = (input: {
  readonly locale: string;
  readonly orderId: string;
  readonly outcome: CheckoutStatusReturnOutcome;
}) => {
  const url = new URL(
    `/${input.locale}/checkout/status/${input.orderId}`,
    "https://deskohub.local"
  );
  url.searchParams.set("outcome", input.outcome);
  appendVercelPreviewProtectionBypass(url, { setBypassCookie: true });

  return `${url.pathname}${url.search}`;
};

const getSearchParamsRecord = (url: URL): SearchParamsRecord =>
  Object.fromEntries(url.searchParams);

export const GET = WorkspaceEffect.route(
  {
    operation: "checkout.payment-return",
    cancellation: "continue-after-disconnect",
    layer: CheckoutStatusServiceLiveWithDependencies,
    mapFailure: mapWorkspaceInternalRouteFailure(
      "Checkout status could not be refreshed"
    ),
  },
  (request, { params }: LocalizedCheckoutPaymentRouteContext) =>
    Effect.gen(function* () {
      const decodedParams = decodeCheckoutPaymentParams(
        yield* Effect.promise(() => params)
      );
      const routeParams = Option.getOrUndefined(decodedParams);
      if (!routeParams) return new NextResponse(null, { status: 404 });

      const { locale, orderId } = routeParams;
      const { outcome } = Option.getOrElse(
        decodeCheckoutPaymentSearchParams(
          getSearchParamsRecord(new URL(request.url))
        ),
        () => ({ outcome: "unknown" as const })
      );

      yield* refreshStatus(orderId, outcome).pipe(
        Effect.catchCause((cause) =>
          Effect.logError("Checkout payment return refresh failed", {
            orderId,
            outcome,
            cause,
          })
        )
      );

      return NextResponse.redirect(
        new URL(
          getCheckoutStatusRedirectPath({ locale, orderId, outcome }),
          request.url
        )
      );
    })
);
