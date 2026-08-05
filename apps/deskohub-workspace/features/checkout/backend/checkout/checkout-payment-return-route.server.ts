import { Effect, type Layer, Option, Ref, Schedule, Schema } from "effect";
import { NextResponse } from "next/server";
import type { Locale } from "@/features/i18n";
import { getLocalizedParamsDecoder } from "@/features/i18n/server/route-params";
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

type CheckoutPaymentReturn = {
  readonly locale: Locale;
  readonly orderId: string;
  readonly outcome: CheckoutStatusRefreshInput["returnOutcome"];
};

const decodeCheckoutPaymentParams = getLocalizedParamsDecoder({
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
    yield* refreshCheckoutStatusWithBriefRetry({
      orderId: input.orderId,
      returnOutcome: input.outcome,
    });

    return NextResponse.redirect(
      new URL(
        getReservationStatusPath({
          locale: input.locale,
          orderId: input.orderId,
          outcome: input.outcome,
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
      decodeCheckoutPaymentReturn(request, context).pipe(
        Effect.flatMap((decoded) =>
          decoded.pipe(
            Option.map((input) =>
              handleCheckoutPaymentReturn(request, input).pipe(
                Effect.provide(statusServiceLayer),
                Effect.mapError(
                  WorkspaceRouteFailure.internal(
                    "Checkout status could not be refreshed"
                  )
                )
              )
            ),
            Option.getOrElse(() =>
              Effect.succeed(new NextResponse(null, { status: 404 }))
            )
          )
        )
      )
  );
