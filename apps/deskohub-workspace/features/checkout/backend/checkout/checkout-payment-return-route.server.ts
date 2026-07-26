import { Cause, Effect, type Layer, Option, Schema } from "effect";
import { NextResponse } from "next/server";
import { getParamsDecoder } from "@/features/i18n/server/route-params";
import { WorkspaceFrameworkFailure } from "@/shared/backend/workspace-framework-failure";
import {
  defineWorkspaceRoute,
  WorkspaceRouteFailure,
} from "@/shared/backend/workspace-route";
import { getSearchParamsDecoder } from "@/shared/utils";
import { CheckoutStatusService } from "./checkout-status.service";
import { getCheckoutStatusPath } from "./checkout-status-url";

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

const handleCheckoutPaymentReturn = Effect.fn("handleCheckoutPaymentReturn")(
  function* (
    request: Request,
    routeParams: { readonly locale: string; readonly orderId: string }
  ) {
    const { locale, orderId } = routeParams;
    const { outcome } = Option.getOrElse(
      decodeCheckoutPaymentSearchParams(
        Object.fromEntries(new URL(request.url).searchParams)
      ),
      () => ({ outcome: "unknown" as const })
    );

    const checkoutStatus = yield* CheckoutStatusService;
    yield* checkoutStatus
      .refreshStatus({
        orderId,
        returnOutcome: outcome,
      })
      .pipe(
        Effect.catchCause((cause) =>
          Cause.hasDies(cause)
            ? Effect.fail(
                new WorkspaceFrameworkFailure({
                  boundary: "route",
                  kind: "defect",
                })
              )
            : Effect.logError("Checkout payment return refresh failed", {
                orderId,
                outcome,
                cause,
              })
        )
      );

    return NextResponse.redirect(
      new URL(
        getCheckoutStatusPath({
          locale,
          orderId,
          outcome,
          setBypassCookie: true,
        }),
        request.url
      )
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
      Effect.gen(function* () {
        const decodedParams = decodeCheckoutPaymentParams(
          yield* Effect.promise(() => context.params)
        );
        const routeParams = Option.getOrUndefined(decodedParams);
        if (!routeParams) return new NextResponse(null, { status: 404 });
        return yield* handleCheckoutPaymentReturn(request, routeParams).pipe(
          Effect.provide(statusServiceLayer)
        );
      }).pipe(
        Effect.mapError((cause) =>
          typeof cause === "object" &&
          cause !== null &&
          "_tag" in cause &&
          cause._tag === "WorkspaceFrameworkFailure"
            ? new WorkspaceRouteFailure({
                statusCode: 500,
                publicMessage: "Request failed.",
                cause,
              })
            : new WorkspaceRouteFailure({
                statusCode: 500,
                publicMessage: "Checkout status could not be refreshed",
                cause,
              })
        )
      )
  );
