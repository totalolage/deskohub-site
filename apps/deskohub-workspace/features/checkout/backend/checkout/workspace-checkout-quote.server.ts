import { Effect } from "effect";
import {
  buildWorkspaceCheckoutQuoteEffect,
  toWorkspaceCheckoutOrderInput,
} from "@/features/checkout/checkout-quote";
import type { ReservationOrderData } from "@/features/reservation/reservation-order";
import { getConfirmedDotyposCustomerDiscount } from "../reservation/dotypos-customer-policy";
import { getNexiCheckoutCurrencyOverride } from "./checkout.service";

export const buildAuthoritativeWorkspaceCheckoutQuoteEffect = Effect.fn(
  "buildAuthoritativeWorkspaceCheckoutQuote"
)(
  function* (reservation: ReservationOrderData) {
    yield* Effect.annotateLogsScoped({ reservation });
    yield* Effect.logInfo(
      "Workspace checkout quote discount resolution started"
    );

    const customerDiscount =
      yield* getConfirmedDotyposCustomerDiscount(reservation);
    yield* Effect.annotateLogsScoped({ customerDiscount });
    yield* Effect.logInfo("Workspace checkout quote discount resolved");

    const quote = yield* buildWorkspaceCheckoutQuoteEffect(
      toWorkspaceCheckoutOrderInput(reservation),
      {
        customerDiscount,
        currencyOverride: getNexiCheckoutCurrencyOverride(),
      }
    );
    yield* Effect.annotateLogsScoped({ quote });
    yield* Effect.logInfo("Authoritative workspace checkout quote built");

    return quote;
  },
  (effect) =>
    effect.pipe(
      Effect.scoped,
      Effect.tapError((cause) =>
        Effect.logError("Authoritative workspace checkout quote failed", {
          cause,
        })
      )
    )
);
