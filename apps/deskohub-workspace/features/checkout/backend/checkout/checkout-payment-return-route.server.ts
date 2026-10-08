import { Effect, Option, Schema } from "effect";
import { NextResponse } from "next/server";
import type { Locale } from "@/features/i18n";
import { getLocalizedParamsDecoder } from "@/features/i18n/server/route-params";
import {
  type WorkspaceReservationId,
  workspaceReservationIdSchema,
} from "@/features/reservation/persistence-contracts";
import { defineWorkspaceRoute } from "@/shared/backend/workspace-route";
import { getSearchParamsDecoder } from "@/shared/utils";
import type { CheckoutStatusReturnOutcome } from "./checkout-status.service";
import { getReservationStatusPath } from "./reservation-status-url";

type LocalizedCheckoutPaymentRouteContext = {
  readonly params: Promise<{ locale: string; orderId: string }>;
};

type CheckoutPaymentReturn = {
  readonly locale: Locale;
  readonly orderId: WorkspaceReservationId;
  readonly outcome: CheckoutStatusReturnOutcome;
};

const decodeCheckoutPaymentParams = getLocalizedParamsDecoder({
  orderId: workspaceReservationIdSchema,
});

const decodeCheckoutPaymentSearchParams = getSearchParamsDecoder(
  Schema.Struct({
    outcome: Schema.Literals(["success", "cancelled"]),
  })
);

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

const handleCheckoutPaymentReturn = (
  request: Request,
  input: CheckoutPaymentReturn
) => {
  // Provider returns may lack cookies; the status page owns authorization and reconciliation.
  const response = NextResponse.redirect(
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
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
};

export const checkoutPaymentReturnGet = defineWorkspaceRoute(
  {
    operation: "checkout.payment-return",
    cancellation: "continue-after-disconnect",
  },
  (request, context: LocalizedCheckoutPaymentRouteContext) =>
    decodeCheckoutPaymentReturn(request, context).pipe(
      Effect.flatMap((decoded) =>
        decoded.pipe(
          Option.map((input) =>
            Effect.succeed(handleCheckoutPaymentReturn(request, input))
          ),
          Option.getOrElse(() =>
            Effect.succeed(new NextResponse(null, { status: 404 }))
          )
        )
      )
    )
);
