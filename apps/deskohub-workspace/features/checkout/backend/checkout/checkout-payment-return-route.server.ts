import { Effect, Layer, Option, Schema } from "effect";
import { NextResponse } from "next/server";
import type { Locale } from "@/features/i18n";
import { getParamsDecoder } from "@/features/i18n/server/route-params";
import { WorkspaceRouteFailure } from "@/shared/backend/effect-boundary/route-failure";
import { WorkspaceEffect } from "@/shared/backend/workspace-effect";
import { getSearchParamsDecoder } from "@/shared/utils";
import { refreshCheckoutStatus } from "./checkout-status.server";
import {
  type CheckoutStatusReturnOutcome,
  CheckoutStatusService,
} from "./checkout-status.service";
import { appendVercelPreviewProtectionBypass } from "./vercel-preview-protection-bypass";

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

const getCheckoutStatusRedirectPath = (input: {
  readonly locale: Locale;
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

const handleCheckoutPaymentReturn = Effect.fn("handleCheckoutPaymentReturn")(
  function* (
    request: Request,
    { params }: LocalizedCheckoutPaymentRouteContext
  ) {
    const decodedParams = decodeCheckoutPaymentParams(
      yield* Effect.promise(() => params)
    );
    const routeParams = Option.getOrUndefined(decodedParams);
    if (!routeParams) return new NextResponse(null, { status: 404 });

    const { locale, orderId } = routeParams;
    const { outcome } = Option.getOrElse(
      decodeCheckoutPaymentSearchParams(
        Object.fromEntries(new URL(request.url).searchParams)
      ),
      () => ({ outcome: "unknown" as const })
    );

    yield* refreshCheckoutStatus({ orderId, returnOutcome: outcome }).pipe(
      Effect.catch((cause) =>
        Effect.logError("Checkout payment return refresh failed", {
          orderId,
          outcome,
          cause,
        })
      )
    );

    return yield* Effect.sync(() =>
      NextResponse.redirect(
        new URL(
          getCheckoutStatusRedirectPath({ locale, orderId, outcome }),
          request.url
        )
      )
    );
  }
);

export const makeCheckoutPaymentReturnGet = <E>(
  statusServiceLayer: Layer.Layer<CheckoutStatusService, E>
) =>
  WorkspaceEffect.route(
    {
      operation: "checkout.payment-return",
      layer: statusServiceLayer.pipe(
        Layer.catch((cause) =>
          Layer.effect(
            CheckoutStatusService,
            Effect.fail(
              new WorkspaceRouteFailure({
                statusCode: 500,
                publicMessage: "Checkout status could not be refreshed",
                cause,
              })
            )
          )
        )
      ),
      cancellation: "continue-after-disconnect",
    },
    handleCheckoutPaymentReturn
  );
