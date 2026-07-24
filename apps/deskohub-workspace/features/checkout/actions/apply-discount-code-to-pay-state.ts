import { Effect, Match, Schema } from "effect";
import {
  buildFreshCheckoutPayPath,
  CheckoutPricingService,
  openPayState,
  PayableReservationService,
  PayStateTokenError,
} from "@/features/checkout/backend/checkout";
import {
  DiscountCodeUnavailableError,
  DiscountProviderError,
  normalizeSubmittedDiscountCode,
} from "@/features/discounts";
import { dotyposCustomerIdSchema } from "@/features/reservation/dotypos-customer";
import { BotProtectionService } from "@/shared/backend/bot-protection/bot-protection.service";
import type { ApplyDiscountCodeInput } from "./apply-discount-code-input";

export type ApplyDiscountCodeResult =
  | { readonly status: "applied"; readonly freshPayUrl: string }
  | { readonly status: "pricing_changed"; readonly freshPayUrl: string }
  | { readonly status: "unavailable" };

export const applyDiscountCodeToPayState = Effect.fn(
  "checkout.applyDiscountCodeToPayState"
)(
  (input: ApplyDiscountCodeInput) =>
    Effect.gen(function* () {
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
        return { status: "unavailable" as const };
      }

      const submittedCode = yield* normalizeSubmittedDiscountCode({
        submittedCode: input.submittedCode,
      }).pipe(
        Effect.flatMap(Effect.fromOption),
        Effect.mapError(
          () =>
            new DiscountCodeUnavailableError({
              reason: "invalid_syntax",
              message: "A discount code is required.",
            })
        )
      );
      const reservation = yield* payableReservations.requireCurrent({
        orderId: state.orderId,
        checkoutSessionId: state.checkoutSessionId,
      });
      if (reservation.activePaymentAttemptId) {
        return { status: "unavailable" as const };
      }

      const dotyposCustomerId = yield* Schema.decodeUnknownEffect(
        dotyposCustomerIdSchema
      )(reservation.dotyposCustomerId).pipe(
        Effect.mapError(
          (cause) =>
            new DiscountProviderError({
              reason: "provider_failure",
              message: "Stored customer identity is invalid.",
              cause,
            })
        )
      );
      const result = yield* pricing.applyDiscountCode({
        ...state,
        dotyposCustomerId,
        locale: input.locale,
        submittedCode,
      });
      const currentReservation = yield* payableReservations.requireCurrent({
        orderId: state.orderId,
        checkoutSessionId: state.checkoutSessionId,
      });
      if (currentReservation.activePaymentAttemptId) {
        return { status: "unavailable" as const };
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
            }),
          pricing_changed: (changed) =>
            buildFreshCheckoutPayPath({
              ...changed,
              locale: input.locale,
              orderId: state.orderId,
              checkoutSessionId: state.checkoutSessionId,
              changedKeys: changed.changedKeys,
            }),
        })
      );

      return { status: result.status, freshPayUrl };
    }),
  (effect) =>
    effect.pipe(
      Effect.catchTags({
        DiscountCodeUnavailableError: () =>
          Effect.succeed({ status: "unavailable" as const }),
        DiscountProviderError: () =>
          Effect.succeed({ status: "unavailable" as const }),
        PayableReservationUnavailableError: () =>
          Effect.succeed({ status: "unavailable" as const }),
      })
    )
);
