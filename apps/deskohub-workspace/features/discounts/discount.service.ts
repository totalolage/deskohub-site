import { Context, Effect, Layer, Option } from "effect";
import type { Locale } from "@/features/i18n";
import type { DotyposCustomerId } from "@/features/reservation/dotypos-customer";
import { appendDiscounts, calculateDiscounts } from "./calculator";
import { CalendarDiscountProvider } from "./calendar-discount-provider.service";
import { CodeDiscountProvider } from "./code-discount-provider.service";
import { type DiscountCommitment, makeDiscountCommitment } from "./commitment";
import {
  type AffirmedDiscountAdvertisementQuote,
  affirmedDiscountAdvertisementQuoteCodec,
  type CanonicalDiscountCode,
  type DiscountAdvertisementInput,
  type DiscountAdvertisementQuote,
  type DiscountId,
  type DiscountQuote,
  discountAdvertisementQuoteCodec,
} from "./contracts";
import { CustomerDiscountProvider } from "./customer-discount-provider.service";
import {
  DiscountReleaseGateService,
  type DiscountReleaseGates,
} from "./discount-release-gate.service";
import type { DiscountCalculationError } from "./errors";
import type { DiscountCandidate } from "./provider";
import {
  type DiscountResolutionFailure,
  type DiscountResolutionOperation,
  type DiscountResolutionProvider,
  logDiscountResolutionFailure,
  recoverDiscountResolution,
} from "./resolution-logging";

export type DiscountPaymentAffirmationInput = DiscountAdvertisementInput & {
  readonly dotyposCustomerId: DotyposCustomerId;
  readonly submittedCode?: CanonicalDiscountCode;
  readonly displayedDiscountIds: readonly DiscountId[];
};

export type DiscountPaymentAffirmation = {
  readonly quote: DiscountQuote;
  readonly commitment: DiscountCommitment;
};

export type DiscountAdvertisementAffirmationInput =
  DiscountAdvertisementInput & {
    readonly advertisedDiscountIds: readonly DiscountId[];
  };

export type ApplyCustomerDiscountInput = {
  readonly affirmedAdvertisement: AffirmedDiscountAdvertisementQuote;
  readonly dotyposCustomerId: DotyposCustomerId;
  readonly locale: Locale;
};

export interface IDiscountService {
  readonly discoverAdvertisedDiscounts: (
    input: DiscountAdvertisementInput
  ) => Effect.Effect<DiscountAdvertisementQuote, DiscountCalculationError>;
  readonly affirmAdvertisement: (
    input: DiscountAdvertisementAffirmationInput
  ) => Effect.Effect<
    AffirmedDiscountAdvertisementQuote,
    DiscountCalculationError
  >;
  readonly applyCustomerDiscount: (
    input: ApplyCustomerDiscountInput
  ) => Effect.Effect<DiscountQuote, DiscountCalculationError>;
  readonly affirmForPayment: (
    input: DiscountPaymentAffirmationInput
  ) => Effect.Effect<DiscountPaymentAffirmation, DiscountCalculationError>;
}

export class DiscountService extends Context.Service<
  DiscountService,
  IDiscountService
>()("@deskohub-workspace/discounts/DiscountService") {
  static Live = Layer.effect(
    this,
    Effect.gen(function* () {
      const calendar = yield* CalendarDiscountProvider;
      const customer = yield* CustomerDiscountProvider;
      const code = yield* CodeDiscountProvider;
      const releaseGates = yield* DiscountReleaseGateService;

      const resolveAdvertisementCandidates = Effect.fn(
        "DiscountService.resolveAdvertisementCandidates"
      )(
        (input: {
          readonly advertisementInput: DiscountAdvertisementInput;
          readonly releaseGates: DiscountReleaseGates;
          readonly operation:
            | "discover_advertised_discounts"
            | "affirm_advertisement";
        }) =>
          recoverGatedDiscountResolution({
            enabled: input.releaseGates.calendarSales,
            operation: input.operation,
            provider: "calendar",
            resolve: () =>
              input.operation === "discover_advertised_discounts"
                ? calendar.quote(input.advertisementInput)
                : calendar.revalidate(input.advertisementInput),
          }).pipe(Effect.map(Option.getOrElse(() => [])))
      );

      const resolveDisplayedCandidates = Effect.fn(
        "DiscountService.resolveDisplayedCandidates"
      )(
        (input: {
          readonly affirmationInput: DiscountPaymentAffirmationInput;
          readonly releaseGates: DiscountReleaseGates;
        }) =>
          Effect.all(
            [
              recoverGatedDiscountResolution({
                enabled: input.releaseGates.calendarSales,
                operation: "affirm_for_payment",
                provider: "calendar",
                resolve: () => calendar.revalidate(input.affirmationInput),
              }),
              recoverGatedDiscountResolution({
                enabled: input.releaseGates.customerDiscounts,
                operation: "affirm_for_payment",
                provider: "customer",
                resolve: () => customer.resolve(input.affirmationInput),
              }),
              recoverGatedDiscountResolution({
                enabled: input.releaseGates.discountCodes,
                operation: "affirm_for_payment",
                provider: "code",
                resolve: () => code.revalidate(input.affirmationInput),
              }),
            ],
            { concurrency: "inherit" }
          ).pipe(
            Effect.map(collectDiscountCandidates),
            Effect.map((candidates) =>
              selectDiscountCandidates({
                selectedDiscountIds:
                  input.affirmationInput.displayedDiscountIds,
                candidates,
              })
            )
          )
      );

      const discoverAdvertisedDiscounts = Effect.fn(
        "DiscountService.discoverAdvertisedDiscounts"
      )(
        (input: DiscountAdvertisementInput) =>
          Effect.succeed(input).pipe(
            Effect.bind("releaseGates", () =>
              releaseGates.evaluate({
                operation: "discover_advertised_discounts",
              })
            ),
            Effect.bind("candidates", ({ releaseGates }) =>
              resolveAdvertisementCandidates({
                advertisementInput: input,
                releaseGates,
                operation: "discover_advertised_discounts",
              })
            ),
            Effect.bind("calculation", calculateDiscounts),
            Effect.tap(logDiscountResolution),
            Effect.map(({ calculation }) =>
              makeDiscountAdvertisementQuote(calculation.quote)
            )
          ),
        withServiceAnnotations("discover_advertised_discounts")
      );

      const affirmAdvertisement = Effect.fn(
        "DiscountService.affirmAdvertisement"
      )(
        (input: DiscountAdvertisementAffirmationInput) =>
          Effect.succeed(input).pipe(
            Effect.bind("releaseGates", () =>
              releaseGates.evaluate({ operation: "affirm_advertisement" })
            ),
            Effect.bind("candidates", ({ releaseGates }) =>
              resolveAdvertisementCandidates({
                advertisementInput: input,
                releaseGates: {
                  ...releaseGates,
                  calendarSales:
                    releaseGates.calendarSales &&
                    input.advertisedDiscountIds.length > 0,
                },
                operation: "affirm_advertisement",
              }).pipe(
                Effect.map((candidates) =>
                  selectDiscountCandidates({
                    selectedDiscountIds: input.advertisedDiscountIds,
                    candidates,
                  })
                )
              )
            ),
            Effect.bind("calculation", calculateDiscounts),
            Effect.tap(logDiscountResolution),
            Effect.map(({ calculation }) =>
              makeAffirmedDiscountAdvertisementQuote(calculation.quote)
            )
          ),
        withServiceAnnotations("affirm_advertisement")
      );

      const applyCustomerDiscount = Effect.fn(
        "DiscountService.applyCustomerDiscount"
      )(
        (input: ApplyCustomerDiscountInput) =>
          Effect.succeed(input).pipe(
            Effect.bind("releaseGates", () =>
              releaseGates.evaluate({ operation: "apply_customer_discount" })
            ),
            Effect.bind("candidates", ({ releaseGates }) =>
              recoverGatedDiscountResolution({
                enabled: releaseGates.customerDiscounts,
                operation: "apply_customer_discount",
                provider: "customer",
                resolve: () =>
                  customer.resolve({
                    dotyposCustomerId: input.dotyposCustomerId,
                    locale: input.locale,
                    product: input.affirmedAdvertisement.product,
                  }),
              }).pipe(Effect.map(Option.getOrElse(() => [])))
            ),
            Effect.bind("quote", ({ candidates }) =>
              appendDiscounts({
                baseQuote: input.affirmedAdvertisement,
                candidates,
              })
            ),
            Effect.tap(({ quote }) =>
              logDiscountResolution({
                calculation: { applications: quote.discounts },
              })
            ),
            Effect.map(({ quote }) => quote)
          ),
        withServiceAnnotations("apply_customer_discount")
      );

      const affirmForPayment = Effect.fn("DiscountService.affirmForPayment")(
        (input: DiscountPaymentAffirmationInput) =>
          Effect.succeed(input).pipe(
            Effect.bind("releaseGates", () =>
              releaseGates.evaluate({ operation: "affirm_for_payment" })
            ),
            Effect.bind("candidates", ({ releaseGates }) =>
              resolveDisplayedCandidates({
                affirmationInput: input,
                releaseGates,
              })
            ),
            Effect.bind("calculation", calculateDiscounts),
            Effect.tap(logDiscountResolution),
            Effect.map(({ calculation }) => ({
              quote: calculation.quote,
              commitment: makeDiscountCommitment({
                applications: calculation.applications,
              }),
            }))
          ),
        withServiceAnnotations("affirm_for_payment")
      );

      return {
        discoverAdvertisedDiscounts,
        affirmAdvertisement,
        applyCustomerDiscount,
        affirmForPayment,
      } satisfies IDiscountService;
    })
  );
}

const recoverGatedDiscountResolution = (input: {
  readonly enabled: boolean;
  readonly operation: DiscountResolutionOperation;
  readonly provider: DiscountResolutionProvider;
  readonly resolve: () => Effect.Effect<
    readonly DiscountCandidate[],
    DiscountResolutionFailure
  >;
}) =>
  Effect.suspend(input.resolve).pipe(
    Effect.when(Effect.succeed(input.enabled)),
    Effect.map(Option.getOrElse(() => [])),
    (effect) =>
      recoverDiscountResolution(effect, {
        operation: input.operation,
        provider: input.provider,
      })
  );

const collectDiscountCandidates = (
  candidatesByProvider: readonly Option.Option<readonly DiscountCandidate[]>[]
) =>
  candidatesByProvider.flatMap((candidates) =>
    Option.getOrElse(candidates, () => [])
  );

const selectDiscountCandidates = (input: {
  readonly selectedDiscountIds: readonly DiscountId[];
  readonly candidates: readonly DiscountCandidate[];
}) => {
  const candidatesById = new Map(
    input.candidates.map((candidate) => [candidate.discount.id, candidate])
  );

  return input.selectedDiscountIds.flatMap((discountId) => {
    const candidate = candidatesById.get(discountId);
    return candidate ? [candidate] : [];
  });
};

const logDiscountResolution = (input: {
  readonly calculation: {
    readonly applications: readonly unknown[];
  };
}) =>
  Effect.logDebug("Discount quote resolved", {
    appliedDiscountCount: input.calculation.applications.length,
  });

const withServiceAnnotations =
  (
    operation:
      | "discover_advertised_discounts"
      | "affirm_advertisement"
      | "apply_customer_discount"
      | "affirm_for_payment"
  ) =>
  <A>(
    effect: Effect.Effect<A, DiscountCalculationError>,
    input:
      | DiscountPaymentAffirmationInput
      | DiscountAdvertisementInput
      | DiscountAdvertisementAffirmationInput
      | ApplyCustomerDiscountInput
  ) =>
    effect.pipe(
      Effect.tapError((cause) =>
        logDiscountResolutionFailure({
          cause,
          operation,
          provider: "calculator",
        })
      ),
      Effect.annotateLogs({
        discountOperation: operation,
        discountProductKind:
          "product" in input
            ? input.product.kind
            : input.affirmedAdvertisement.product.kind,
        discountProductTier:
          "product" in input
            ? input.product.tier
            : input.affirmedAdvertisement.product.tier,
      })
    );

const makeDiscountAdvertisementQuote = (
  quote: DiscountQuote
): DiscountAdvertisementQuote => discountAdvertisementQuoteCodec.make(quote);

const makeAffirmedDiscountAdvertisementQuote = (
  quote: DiscountQuote
): AffirmedDiscountAdvertisementQuote =>
  affirmedDiscountAdvertisementQuoteCodec.make(quote);
