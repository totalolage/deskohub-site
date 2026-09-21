import { randomUUID } from "node:crypto";
import { Effect, Match, Option, Schema } from "effect";
import {
  buildFreshCheckoutPayPath,
  CheckoutPricingService,
  openPayState,
  PayableReservationService,
  PayStateTokenError,
} from "@/features/checkout/backend/checkout";
import {
  DiscountProviderError,
  normalizeSubmittedPromotionCode,
} from "@/features/discounts";
import { dotyposCustomerIdSchema } from "@/features/reservation/dotypos-customer";
import { BotProtectionService } from "@/shared/backend/bot-protection/bot-protection.service";
import type { ApplyDiscountCodeInput } from "./apply-discount-code-input";

export type ApplyDiscountCodeResult =
  | { readonly status: "applied"; readonly freshPayUrl: string }
  | { readonly status: "pricing_changed"; readonly freshPayUrl: string }
  | {
      readonly status: "unavailable";
      /**
       * Signed replacement carrying the attempted code as requested intent;
       * the correction route must use it so the attempt survives the failure
       * instead of falling back to the previous token.
       */
      readonly freshPayUrl?: string;
    };

export const applyDiscountCodeToPayState = Effect.fn(
  "checkout.applyDiscountCodeToPayState"
)(
  function* (input: ApplyDiscountCodeInput) {
    const botProtection = yield* BotProtectionService;
    const pricing = yield* CheckoutPricingService;
    const payableReservations = yield* PayableReservationService;

    yield* botProtection.verifyHuman({ verificationFailurePolicy: "deny" });

    const state = yield* openPayState(input.payStateToken);
    if (state.locale !== input.locale) {
      return yield* new PayStateTokenError({
        code: "invalid-token",
        message: "Pay state locale does not match the request locale.",
      });
    }

    if (state.changedKeys || state.submittedCode) {
      return { status: "unavailable" as const, freshPayUrl: undefined };
    }

    // A non-canonical attempt cannot be sealed as intent, so syntax failures
    // keep the plain unavailable result.
    const submittedCode = yield* normalizeSubmittedPromotionCode({
      submittedCode: input.submittedCode,
    }).pipe(
      Effect.map(Option.getOrUndefined),
      Effect.catchTag("PromotionCodeUnavailableError", () =>
        Effect.succeed(undefined)
      )
    );
    if (submittedCode === undefined) {
      return { status: "unavailable" as const, freshPayUrl: undefined };
    }
    const reservation = yield* payableReservations.requireCurrent({
      orderId: state.orderId,
      checkoutSessionId: state.checkoutSessionId,
    });
    if (reservation.activePaymentAttemptId) {
      return { status: "unavailable" as const, freshPayUrl: undefined };
    }

    const dotyposCustomerId = yield* Schema.decodeUnknownEffect(
      dotyposCustomerIdSchema
    )(reservation.dotyposCustomerId).pipe(
      Effect.mapError(
        DiscountProviderError.fromCause({
          reason: "provider_failure",
          message: "Stored customer identity is invalid.",
        })
      )
    );
    const result = yield* pricing
      .applyDiscountCode({
        ...state,
        dotyposCustomerId,
        locale: input.locale,
        submittedCode,
      })
      .pipe(
        // A recoverable invalid-code failure keeps the attempted code as signed
        // requested intent on the correction route instead of the old state.
        Effect.catchTag(
          "PromotionCodeUnavailableError",
          Effect.fn(function* () {
            const freshPayUrl = yield* buildFreshCheckoutPayPath(
              {
                ...state,
                locale: input.locale,
                orderId: state.orderId,
                checkoutSessionId: state.checkoutSessionId,
                requestedDiscountCode: submittedCode,
              },
              {},
              {
                discountCodeError: "unavailable",
                discountCodeErrorId: randomUUID(),
              }
            );
            return { status: "unavailable" as const, freshPayUrl };
          })
        )
      );
    const currentReservation = yield* payableReservations.requireCurrent({
      orderId: state.orderId,
      checkoutSessionId: state.checkoutSessionId,
    });
    if (currentReservation.activePaymentAttemptId) {
      return { status: "unavailable" as const, freshPayUrl: undefined };
    }

    if (result.status === "unavailable") {
      return result;
    }

    const freshPayUrl = yield* Match.value(result).pipe(
      Match.discriminatorsExhaustive("status")({
        applied: (applied) =>
          buildFreshCheckoutPayPath({
            ...applied,
            locale: input.locale,
            orderId: state.orderId,
            checkoutSessionId: state.checkoutSessionId,
            submittedCode,
            submittedCodeDiscountId: applied.submittedCodeDiscountId,
            requestedDiscountCode: submittedCode,
          }),
        pricing_changed: (changed) =>
          buildFreshCheckoutPayPath({
            ...changed,
            locale: input.locale,
            orderId: state.orderId,
            checkoutSessionId: state.checkoutSessionId,
            changedKeys: changed.changedKeys,
            requestedDiscountCode: submittedCode,
          }),
      })
    );

    return { status: result.status, freshPayUrl };
  },
  (effect) =>
    effect.pipe(
      Effect.catchTags({
        DiscountProviderError: () =>
          Effect.succeed({
            status: "unavailable" as const,
            freshPayUrl: undefined,
          }),
        PayableReservationUnavailableError: () =>
          Effect.succeed({
            status: "unavailable" as const,
            freshPayUrl: undefined,
          }),
      })
    )
);
