import { Effect, type Layer, Option, Ref, Schedule, Schema } from "effect";
import { NextResponse } from "next/server";
import { getParamsDecoder } from "@/features/i18n/server/route-params";
import {
  defineWorkspaceRoute,
  WorkspaceRouteFailure,
} from "@/shared/backend/workspace-route";
import { getSearchParamsDecoder } from "@/shared/utils";
import {
  CheckoutStatusService,
  type ICheckoutStatusService,
} from "./checkout-status.service";
import { getReservationStatusPath } from "./reservation-status-url";

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

type CheckoutStatusRefreshInput = Parameters<
  ICheckoutStatusService["refreshStatus"]
>[0];

const refreshCheckoutStatusAttempt = Effect.fn("refreshCheckoutStatusAttempt")(
  function* (input: CheckoutStatusRefreshInput, attempts: Ref.Ref<number>) {
    const attempt = yield* Ref.updateAndGet(attempts, (value) => value + 1);
    yield* Effect.logWarning("Retrying checkout payment return refresh", {
      orderId: input.orderId,
      attempt,
    }).pipe(Effect.when(Effect.succeed(attempt > 1)));

    const checkoutStatus = yield* CheckoutStatusService;
    return yield* checkoutStatus.refreshStatus(input).pipe(
      Effect.catch((cause) =>
        Effect.logError("Checkout payment return refresh failed", {
          orderId: input.orderId,
          outcome: input.returnOutcome,
          attempt,
          cause,
        })
      )
    );
  }
);

const refreshCheckoutStatusWithBriefRetry = Effect.fn(
  "refreshCheckoutStatusWithBriefRetry"
)(function* (input: CheckoutStatusRefreshInput) {
  const attempts = yield* Ref.make(0);
  return yield* refreshCheckoutStatusAttempt(input, attempts).pipe(
    Effect.repeat({
      schedule: Schedule.spaced("1500 millis"),
      times: 3,
      while: (status) =>
        !status || status.status === "created" || status.status === "pending",
    })
  );
});

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

    yield* refreshCheckoutStatusWithBriefRetry({
      orderId,
      returnOutcome: outcome,
    });

    return NextResponse.redirect(
      new URL(
        getReservationStatusPath({
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
      handleCheckoutPaymentReturn(request, context).pipe(
        Effect.provide(statusServiceLayer),
        Effect.mapError(
          (cause) =>
            new WorkspaceRouteFailure({
              statusCode: 500,
              publicMessage: "Checkout status could not be refreshed",
              cause,
            })
        )
      )
  );
