import { Effect, Option } from "effect";
import {
  buildFreshCheckoutPayPath,
  CheckoutPricingService,
  openPayState,
  PayStateTokenError,
} from "@/features/checkout/backend/checkout";
import {
  DiscountCodeUnavailableError,
  normalizeSubmittedDiscountCode,
} from "@/features/discounts";
import { WorkspaceReservationRepository } from "@/features/reservation/backend/workspace-reservation.repository";
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
      const reservations = yield* WorkspaceReservationRepository;

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
        Effect.flatMap(
          Option.match({
            onNone: () =>
              Effect.fail(
                new DiscountCodeUnavailableError({
                  reason: "invalid_syntax",
                  message: "A discount code is required.",
                })
              ),
            onSome: Effect.succeed,
          })
        )
      );
      const reservation = yield* reservations.findById(state.orderId);
      if (!reservation || reservation.activePaymentAttemptId) {
        return { status: "unavailable" as const };
      }

      const result = yield* pricing.applyDiscountCode({
        reservation: state.reservation,
        dotyposCustomerId: reservation.dotyposCustomerId,
        locale: input.locale,
        displayedQuote: state.quote,
        submittedCode,
      });
      const currentReservation = yield* reservations.findById(state.orderId);
      if (!currentReservation || currentReservation.activePaymentAttemptId) {
        return { status: "unavailable" as const };
      }

      if (result.status === "pricing_changed") {
        const freshPayUrl = yield* buildFreshCheckoutPayPath({
          locale: input.locale,
          reservation: state.reservation,
          quote: result.quote,
          orderId: state.orderId,
          changedKeys: result.changedKeys,
        });

        return { status: "pricing_changed" as const, freshPayUrl };
      }

      const freshPayUrl = yield* buildFreshCheckoutPayPath({
        locale: input.locale,
        reservation: state.reservation,
        quote: result.quote,
        orderId: state.orderId,
        submittedCode,
      });

      return { status: "applied" as const, freshPayUrl };
    }),
  (effect) =>
    effect.pipe(
      Effect.catchTags({
        DiscountCodeUnavailableError: () =>
          Effect.succeed({ status: "unavailable" as const }),
        DiscountProviderError: () =>
          Effect.succeed({ status: "unavailable" as const }),
      })
    )
);
