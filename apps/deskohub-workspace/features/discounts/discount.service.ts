import { Context, Effect, Layer, Option } from "effect";
import { getWorkspaceProductKey } from "@/features/checkout/product-identity";
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
  type DiscountQuoteInput,
  discountAdvertisementQuoteCodec,
} from "./contracts";
import { CustomerDiscountProvider } from "./customer-discount-provider.service";
import {
  DiscountReleaseGateService,
  type DiscountReleaseGates,
} from "./discount-release-gate.service";
import {
  type DiscountCalculationError,
  DiscountCodeUnavailableError,
  DiscountProviderError,
  type DiscountResolutionError,
} from "./errors";
import type { DiscountCandidate } from "./provider";
import {
  type DiscountResolutionFailure,
  type DiscountResolutionOperation,
  type DiscountResolutionProvider,
  logDiscountResolutionFailure,
  recoverDiscountResolution,
} from "./resolution-logging";

export type DisplayedDiscountAffirmationInput = DiscountAdvertisementInput & {
  readonly dotyposCustomerId: DotyposCustomerId;
  readonly submittedCode?: CanonicalDiscountCode;
  readonly displayedDiscountIds: readonly DiscountId[];
};

export type DisplayedDiscountAffirmation = {
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

export type ApplyDiscountCodeInput = {
  readonly baseQuote: DiscountQuote;
  readonly dotyposCustomerId: DotyposCustomerId;
  readonly locale: Locale;
  readonly submittedCode: CanonicalDiscountCode;
};

export interface IDiscountService {
  readonly quote: (
    input: DiscountQuoteInput
  ) => Effect.Effect<DiscountQuote, DiscountCalculationError>;
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
  readonly affirmDisplayedDiscounts: (
    input: DisplayedDiscountAffirmationInput
  ) => Effect.Effect<DisplayedDiscountAffirmation, DiscountCalculationError>;
  readonly applyDiscountCode: (
    input: ApplyDiscountCodeInput
  ) => Effect.Effect<DiscountQuote, DiscountResolutionError>;
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

      const resolveQuoteCandidates = Effect.fn(
        "DiscountService.resolveQuoteCandidates"
      )(
        (input: {
          readonly quoteInput: DiscountQuoteInput;
          readonly releaseGates: DiscountReleaseGates;
        }) =>
          Effect.all(
            [
              recoverGatedDiscountResolution({
                enabled: input.releaseGates.calendarSales,
                operation: "quote",
                provider: "calendar",
                resolve: () => calendar.quote(input.quoteInput),
              }),
              recoverGatedDiscountResolution({
                enabled: input.releaseGates.customerDiscounts,
                operation: "quote",
                provider: "customer",
                resolve: () => customer.resolve(input.quoteInput),
              }),
              recoverGatedDiscountResolution({
                enabled: input.releaseGates.discountCodes,
                operation: "quote",
                provider: "code",
                resolve: () => code.quote(input.quoteInput),
              }),
            ],
            { concurrency: "inherit" }
          ).pipe(Effect.map(collectDiscountCandidates))
      );

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
          readonly affirmationInput: DisplayedDiscountAffirmationInput;
          readonly releaseGates: DiscountReleaseGates;
        }) =>
          Effect.all(
            [
              recoverGatedDiscountResolution({
                enabled: input.releaseGates.calendarSales,
                operation: "affirm_displayed_discounts",
                provider: "calendar",
                resolve: () => calendar.revalidate(input.affirmationInput),
              }),
              recoverGatedDiscountResolution({
                enabled: input.releaseGates.customerDiscounts,
                operation: "affirm_displayed_discounts",
                provider: "customer",
                resolve: () => customer.resolve(input.affirmationInput),
              }),
              recoverGatedDiscountResolution({
                enabled: input.releaseGates.discountCodes,
                operation: "affirm_displayed_discounts",
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

      const quote = Effect.fn("DiscountService.quote")(
        (input: DiscountQuoteInput) =>
          Effect.succeed(input).pipe(
            Effect.bind("releaseGates", () =>
              releaseGates.evaluate({ operation: "quote" })
            ),
            Effect.bind("candidates", ({ releaseGates }) =>
              resolveQuoteCandidates({ quoteInput: input, releaseGates })
            ),
            Effect.bind("calculation", calculateDiscounts),
            Effect.tap(logDiscountResolution),
            Effect.map(({ calculation }) => calculation.quote)
          ),
        withServiceAnnotations("quote")
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

      const affirmDisplayedDiscounts = Effect.fn(
        "DiscountService.affirmDisplayedDiscounts"
      )(
        (input: DisplayedDiscountAffirmationInput) =>
          Effect.succeed(input).pipe(
            Effect.bind("releaseGates", () =>
              releaseGates.evaluate({
                operation: "affirm_displayed_discounts",
              })
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
        withServiceAnnotations("affirm_displayed_discounts")
      );

      const applyDiscountCode = Effect.fn("DiscountService.applyDiscountCode")(
        (input: ApplyDiscountCodeInput) =>
          Effect.succeed(input).pipe(
            Effect.bind("releaseGates", () =>
              releaseGates.evaluate({ operation: "apply_discount_code" })
            ),
            Effect.tap(({ releaseGates }) =>
              requireDiscountCodesEnabled(releaseGates)
            ),
            Effect.tap(requireEligibleSubtotal),
            Effect.bind("candidates", () =>
              code.quote({
                product: input.baseQuote.product,
                discountableSubtotal: input.baseQuote.discountableSubtotal,
                dotyposCustomerId: input.dotyposCustomerId,
                locale: input.locale,
                submittedCode: input.submittedCode,
              })
            ),
            Effect.tap(requireResolvedCodeCandidate),
            Effect.bind("quote", ({ candidates }) =>
              appendDiscounts({
                baseQuote: input.baseQuote,
                candidates,
              })
            ),
            Effect.tap(({ quote }) =>
              requireAppliedCode({ baseQuote: input.baseQuote, quote })
            ),
            Effect.tap(({ quote }) =>
              logDiscountResolution({
                calculation: { applications: quote.discounts },
              })
            ),
            Effect.map(({ quote }) => quote)
          ),
        withApplyDiscountCodeAnnotations
      );

      return {
        quote,
        discoverAdvertisedDiscounts,
        affirmAdvertisement,
        applyCustomerDiscount,
        affirmDisplayedDiscounts,
        applyDiscountCode,
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
      | "quote"
      | "discover_advertised_discounts"
      | "affirm_advertisement"
      | "apply_customer_discount"
      | "affirm_displayed_discounts"
  ) =>
  <A>(
    effect: Effect.Effect<A, DiscountCalculationError>,
    input:
      | DisplayedDiscountAffirmationInput
      | DiscountQuoteInput
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
        discountProductKey: getWorkspaceProductKey(
          "product" in input
            ? input.product
            : input.affirmedAdvertisement.product
        ),
      })
    );

const requireDiscountCodesEnabled = (releaseGates: DiscountReleaseGates) =>
  releaseGates.discountCodes
    ? Effect.void
    : Effect.fail(
        new DiscountCodeUnavailableError({
          reason: "feature_disabled",
          message: "Discount code entry is disabled.",
        })
      );

const requireEligibleSubtotal = (input: ApplyDiscountCodeInput) =>
  input.baseQuote.discountedSubtotal.value > 0
    ? Effect.void
    : Effect.fail(
        new DiscountCodeUnavailableError({
          reason: "no_eligible_subtotal",
          message: "No discountable subtotal remains for a discount code.",
        })
      );

const requireResolvedCodeCandidate = (input: {
  readonly candidates: readonly DiscountCandidate[];
}) =>
  input.candidates.length > 0
    ? Effect.void
    : Effect.fail(
        new DiscountProviderError({
          reason: "provider_failure",
          message: "The submitted discount code resolved no candidate.",
        })
      );

const requireAppliedCode = (input: {
  readonly baseQuote: DiscountQuote;
  readonly quote: DiscountQuote;
}) =>
  input.quote.discounts.length > input.baseQuote.discounts.length
    ? Effect.void
    : Effect.fail(
        new DiscountCodeUnavailableError({
          reason: "no_eligible_subtotal",
          message: "The discount code has no applicable amount.",
        })
      );

const withApplyDiscountCodeAnnotations = <A>(
  effect: Effect.Effect<A, DiscountResolutionError>,
  input: ApplyDiscountCodeInput
) =>
  effect.pipe(
    Effect.tapError((cause) =>
      cause._tag === "DiscountCodeUnavailableError"
        ? Effect.logDebug("Discount code was unavailable", {
            discountBoundary: "resolution",
            discountProvider: "code",
            discountOperation: "apply_discount_code",
            discountErrorTag: cause._tag,
            discountErrorReason: cause.reason,
          })
        : logDiscountResolutionFailure({
            cause,
            operation: "apply_discount_code",
            provider:
              cause._tag === "DiscountCalculationError" ? "calculator" : "code",
          })
    ),
    Effect.annotateLogs({
      discountOperation: "apply_discount_code",
      discountProductKind: input.baseQuote.product.kind,
      discountProductKey: getWorkspaceProductKey(input.baseQuote.product),
    })
  );

const makeDiscountAdvertisementQuote = (
  quote: DiscountQuote
): DiscountAdvertisementQuote => discountAdvertisementQuoteCodec.make(quote);

const makeAffirmedDiscountAdvertisementQuote = (
  quote: DiscountQuote
): AffirmedDiscountAdvertisementQuote =>
  affirmedDiscountAdvertisementQuoteCodec.make(quote);
