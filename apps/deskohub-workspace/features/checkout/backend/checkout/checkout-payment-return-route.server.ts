import { Effect, Layer, Option, Schema } from "effect";
import { NextResponse } from "next/server";
import { getParamsDecoder } from "@/features/i18n/server/route-params";
import {
  WorkspaceEffect,
  WorkspaceRouteFailure,
} from "@/shared/backend/workspace-effect";
import {
  getSearchParamsDecoder,
  type SearchParamsRecord,
} from "@/shared/utils";
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

const refreshStatus = Effect.fn("checkoutPaymentReturn.refreshStatus")(
  (orderId: string, returnOutcome: CheckoutStatusReturnOutcome) =>
    refreshCheckoutStatus({ orderId, returnOutcome })
);

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
    const { outcome } = yield* Effect.sync(() =>
      Option.getOrElse(
        decodeCheckoutPaymentSearchParams(
          getSearchParamsRecord(new URL(request.url))
        ),
        () => ({ outcome: "unknown" as const })
      )
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
