import { Effect, type Layer, Option, Schema } from "effect";
import { NextResponse } from "next/server";
import type { Locale } from "@/features/i18n";
import { getParamsDecoder } from "@/features/i18n/server/route-params";
import {
  defineWorkspaceRoute,
  mapWorkspaceInternalRouteFailure,
} from "@/shared/backend/workspace-route";
import { getSearchParamsDecoder } from "@/shared/utils";
import {
  type CheckoutStatusReturnOutcome,
  CheckoutStatusService,
} from "./checkout-status.service";
import { appendVercelPreviewProtectionBypass } from "./vercel-preview-protection-bypass";

type LocalizedCheckoutPaymentRouteContext = {
  readonly params: Promise<{ locale: string; orderId: string }>;
};

type CheckoutPaymentReturn = {
  readonly locale: Locale;
  readonly orderId: string;
  readonly outcome: CheckoutStatusReturnOutcome;
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

const decodeCheckoutPaymentReturn = Effect.fn("decodeCheckoutPaymentReturn")(
  function* (
    request: Request,
    { params }: LocalizedCheckoutPaymentRouteContext
  ) {
    const decodedParams = decodeCheckoutPaymentParams(
      yield* Effect.promise(() => params)
    );
    const routeParams = Option.getOrUndefined(decodedParams);
    if (!routeParams) return Option.none<CheckoutPaymentReturn>();

    const { locale, orderId } = routeParams;
    const { outcome } = Option.getOrElse(
      decodeCheckoutPaymentSearchParams(
        Object.fromEntries(new URL(request.url).searchParams)
      ),
      () => ({ outcome: "unknown" as const })
    );

    return Option.some({ locale, orderId, outcome });
  }
);

const handleCheckoutPaymentReturn = Effect.fn("handleCheckoutPaymentReturn")(
  function* (request: Request, input: CheckoutPaymentReturn) {
    const checkoutStatus = yield* CheckoutStatusService;
    yield* checkoutStatus
      .refreshStatus({
        orderId: input.orderId,
        returnOutcome: input.outcome,
      })
      .pipe(
        Effect.catch((cause) =>
          Effect.logError("Checkout payment return refresh failed", {
            orderId: input.orderId,
            outcome: input.outcome,
            cause,
          })
        )
      );

    return NextResponse.redirect(
      new URL(getCheckoutStatusRedirectPath(input), request.url)
    );
  }
);

export const makeCheckoutPaymentReturnGet = (
  statusServiceLayer: Layer.Layer<CheckoutStatusService, unknown>
) =>
  defineWorkspaceRoute(
    {
      operation: "checkout.payment-return",
      cancellation: "continue-after-disconnect",
    },
    (request, context: LocalizedCheckoutPaymentRouteContext) =>
      decodeCheckoutPaymentReturn(request, context).pipe(
        Effect.flatMap((decoded) =>
          Option.match(decoded, {
            onNone: () =>
              Effect.succeed(new NextResponse(null, { status: 404 })),
            onSome: (input) =>
              handleCheckoutPaymentReturn(request, input).pipe(
                Effect.provide(statusServiceLayer),
                Effect.mapError(
                  mapWorkspaceInternalRouteFailure(
                    "Checkout status could not be refreshed"
                  )
                )
              ),
          })
        )
      )
  );
