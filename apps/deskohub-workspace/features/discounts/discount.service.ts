import { Context, Effect, Layer, Option, Schema, Scope } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import { getWorkspaceProductKey } from "@/features/checkout/product-identity";
import { positiveWorkspaceMoneyCodec } from "@/features/checkout/workspace-money";
import type { Locale } from "@/features/i18n";
import type { DotyposCustomerId } from "@/features/reservation/dotypos-customer";
import { CalendarResourceConfig } from "@/shared/backend/config/calendar-resource.config";
import { WorkspaceDotyposLayer } from "@/shared/backend/config/dotypos.config";
import { WorkspaceGoogleCalendarLayer } from "@/shared/backend/config/google-calendar.config";
import { calculateGoodsBasketDiscounts } from "./basket-calculator";
import { appendDiscounts, calculateDiscounts } from "./calculator";
import { CalendarDiscountProvider } from "./calendar-discount-provider.service";
import {
  type DiscountCommitment,
  type GoodsBasketDiscountCommitment,
  makeDiscountCommitment,
  makeGoodsBasketDiscountCommitment,
} from "./commitment";
import {
  type ActiveSale,
  type ActiveSaleDiscoveryInput,
  type AffirmedDiscountAdvertisementQuote,
  type AppliedDiscount,
  affirmedDiscountAdvertisementQuoteCodec,
  appliedDiscountCodec,
  type CanonicalPromotionCode,
  type DiscountAdvertisementInput,
  type DiscountAdvertisementQuote,
  type DiscountId,
  type DiscountQuote,
  type DiscountQuoteInput,
  discountAdvertisementQuoteCodec,
  discountCodec,
  type GoodsDiscountBasketInput,
  type GoodsDiscountBasketQuote,
} from "./contracts";
import { CustomerDiscountProvider } from "./customer-discount-provider.service";
import { DiscountDefinitionRepository } from "./discount-definition.repository";
import {
  DiscountReleaseGateService,
  type DiscountReleaseGates,
} from "./discount-release-gate.service";
import {
  type DiscountCalculationError,
  type DiscountResolutionError,
  PromotionCodeUnavailableError,
} from "./errors";
import { PromotionCodeRepository } from "./promotion-code.repository";
import { PromotionCodeProvider } from "./promotion-code-provider.service";
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
  readonly submittedCode?: CanonicalPromotionCode;
  readonly displayedDiscountIds: readonly DiscountId[];
};

export type DisplayedDiscountAffirmation = {
  readonly quote: DiscountQuote;
  readonly commitment: DiscountCommitment;
};

export type DisplayedGoodsBasketDiscountAffirmationInput =
  GoodsDiscountBasketInput & {
    readonly displayedDiscountIds: readonly DiscountId[];
  };

export type DisplayedGoodsBasketDiscountAffirmation = {
  readonly quote: GoodsDiscountBasketQuote;
  readonly commitment: GoodsBasketDiscountCommitment;
};

export type DiscountAdvertisementAffirmationInput =
  DiscountAdvertisementInput & {
    readonly advertisedDiscountIds: readonly DiscountId[];
  };

export type ApplyCustomerDiscountInput = {
  readonly affirmedAdvertisement: AffirmedDiscountAdvertisementQuote;
  readonly dotyposCustomerId: DotyposCustomerId;
  readonly locale: Locale;
  readonly submittedCode?: CanonicalPromotionCode;
  readonly submittedCodeDiscountId?: DiscountId;
};

export type AppliedCustomerDiscountQuote = DiscountQuote & {
  readonly advertisedPriceChanged: boolean;
  readonly submittedCodeDiscountId?: DiscountId;
};

export type ApplyDiscountCodeInput = {
  readonly baseQuote: DiscountQuote;
  readonly dotyposCustomerId: DotyposCustomerId;
  readonly locale: Locale;
  readonly submittedCode: CanonicalPromotionCode;
};

export type PreviewDiscountCodeInput = Omit<
  ApplyDiscountCodeInput,
  "dotyposCustomerId"
>;

export type AppliedDiscountCodeQuote = {
  readonly quote: DiscountQuote;
  readonly application: AppliedDiscount;
};

export interface IDiscountService {
  readonly discoverActiveSales: (
    input: ActiveSaleDiscoveryInput
  ) => Effect.Effect<readonly ActiveSale[]>;
  readonly quote: (
    input: DiscountQuoteInput
  ) => Effect.Effect<DiscountQuote, DiscountCalculationError>;
  readonly quoteGoodsBasket: (
    input: GoodsDiscountBasketInput
  ) => Effect.Effect<GoodsDiscountBasketQuote, DiscountCalculationError>;
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
  ) => Effect.Effect<AppliedCustomerDiscountQuote, DiscountCalculationError>;
  readonly previewDiscountCode: (
    input: PreviewDiscountCodeInput
  ) => Effect.Effect<AppliedDiscountCodeQuote, DiscountResolutionError>;
  readonly affirmDisplayedDiscounts: (
    input: DisplayedDiscountAffirmationInput
  ) => Effect.Effect<DisplayedDiscountAffirmation, DiscountCalculationError>;
  readonly affirmDisplayedGoodsBasketDiscounts: (
    input: DisplayedGoodsBasketDiscountAffirmationInput
  ) => Effect.Effect<
    DisplayedGoodsBasketDiscountAffirmation,
    DiscountCalculationError
  >;
  readonly applyDiscountCode: (
    input: ApplyDiscountCodeInput
  ) => Effect.Effect<AppliedDiscountCodeQuote, DiscountResolutionError>;
}

export class DiscountService extends Context.Service<
  DiscountService,
  IDiscountService
>()("@deskohub-workspace/discounts/DiscountService") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const calendar = yield* CalendarDiscountProvider;
      const customer = yield* CustomerDiscountProvider;
      const code = yield* PromotionCodeProvider;
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
                resolve: () => calendar.discover(input.quoteInput),
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
                resolve: () => code.revalidate(input.quoteInput),
              }),
            ],
            { concurrency: "inherit" }
          ).pipe(
            Effect.map((candidatesByProvider) => candidatesByProvider.flat())
          )
      );

      const discoverActiveSales = Effect.fn(
        "DiscountService.discoverActiveSales"
      )((input: ActiveSaleDiscoveryInput) =>
        Effect.succeed(input).pipe(
          Effect.bind("releaseGates", () =>
            releaseGates.evaluate({ operation: "discover_active_sales" })
          ),
          Effect.bind("activeSales", ({ releaseGates }) =>
            recoverGatedDiscountResolution({
              enabled: releaseGates.calendarSales,
              operation: "discover_active_sales",
              provider: "calendar",
              resolve: () =>
                calendar
                  .discoverActiveSales(input)
                  .pipe(Effect.map(({ activeSales }) => activeSales)),
            })
          ),
          Effect.map(({ activeSales }) => activeSales)
        )
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
            Effect.map((candidatesByProvider) => candidatesByProvider.flat()),
            Effect.map((candidates) =>
              selectDiscountCandidates({
                selectedDiscountIds:
                  input.affirmationInput.displayedDiscountIds,
                candidates,
              })
            )
          )
      );

      const resolveDisplayedGoodsBasketCandidates = Effect.fn(
        "DiscountService.resolveDisplayedGoodsBasketCandidates"
      )(
        (input: {
          readonly affirmationInput: DisplayedGoodsBasketDiscountAffirmationInput;
          readonly releaseGates: DiscountReleaseGates;
        }) =>
          Effect.all(
            [
              recoverGatedDiscountResolution({
                enabled: input.releaseGates.calendarSales,
                operation: "affirm_displayed_discounts",
                provider: "calendar",
                resolve: () =>
                  calendar.revalidateGoodsBasket(input.affirmationInput),
              }),
              recoverGatedDiscountResolution({
                enabled: input.releaseGates.customerDiscounts,
                operation: "affirm_displayed_discounts",
                provider: "customer",
                resolve: () =>
                  customer.resolveGoodsBasket(input.affirmationInput),
              }),
              recoverGatedDiscountResolution({
                enabled: input.releaseGates.discountCodes,
                operation: "affirm_displayed_discounts",
                provider: "code",
                resolve: () =>
                  code.revalidateGoodsBasket(input.affirmationInput),
              }),
            ],
            { concurrency: "inherit" }
          ).pipe(
            Effect.map((candidatesByProvider) =>
              selectGoodsBasketDiscountCandidates({
                selectedDiscountIds:
                  input.affirmationInput.displayedDiscountIds,
                candidates: candidatesByProvider.flat(),
              })
            )
          )
      );

      const resolveGoodsBasketCandidates = Effect.fn(
        "DiscountService.resolveGoodsBasketCandidates"
      )(
        (input: {
          readonly basketInput: GoodsDiscountBasketInput;
          readonly releaseGates: DiscountReleaseGates;
        }) =>
          Effect.all(
            [
              recoverGatedDiscountResolution({
                enabled: input.releaseGates.calendarSales,
                operation: "quote",
                provider: "calendar",
                resolve: () =>
                  calendar.revalidateGoodsBasket(input.basketInput),
              }),
              recoverGatedDiscountResolution({
                enabled: input.releaseGates.customerDiscounts,
                operation: "quote",
                provider: "customer",
                resolve: () => customer.resolveGoodsBasket(input.basketInput),
              }),
              recoverGatedDiscountResolution({
                enabled: input.releaseGates.discountCodes,
                operation: "quote",
                provider: "code",
                resolve: () => code.revalidateGoodsBasket(input.basketInput),
              }),
            ],
            { concurrency: "inherit" }
          ).pipe(
            Effect.map((candidatesByProvider) => candidatesByProvider.flat())
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

      const quoteGoodsBasket = Effect.fn("DiscountService.quoteGoodsBasket")(
        (input: GoodsDiscountBasketInput) =>
          Effect.succeed(input).pipe(
            Effect.tap(() =>
              calculateGoodsBasketDiscounts({
                lines: input.lines,
                candidates: [],
              })
            ),
            Effect.bind("releaseGates", () =>
              releaseGates.evaluate({ operation: "quote" })
            ),
            Effect.bind("candidates", ({ releaseGates }) =>
              resolveGoodsBasketCandidates({
                basketInput: input,
                releaseGates,
              })
            ),
            Effect.bind("calculation", ({ candidates }) =>
              calculateGoodsBasketDiscounts({ lines: input.lines, candidates })
            ),
            Effect.map(({ calculation }) => calculation.quote)
          ),
        withGoodsBasketServiceAnnotations("quote")
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
              recoverGatedDiscountResolution({
                enabled: releaseGates.calendarSales,
                operation: "discover_advertised_discounts",
                provider: "calendar",
                resolve: () => calendar.discover(input),
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
              recoverGatedDiscountResolution({
                enabled:
                  releaseGates.calendarSales &&
                  input.advertisedDiscountIds.length > 0,
                operation: "affirm_advertisement",
                provider: "calendar",
                resolve: () => calendar.revalidate(input),
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
            Effect.let("advertisedCandidates", () =>
              input.affirmedAdvertisement.discounts.flatMap(
                (application): DiscountCandidate[] =>
                  application.discount.id === input.submittedCodeDiscountId
                    ? []
                    : [
                        {
                          discount: application.discount,
                          provenance: {
                            providerNamespace: "affirmed-advertisement",
                            providerReference: application.discount.id,
                          },
                        },
                      ]
              )
            ),
            Effect.bind("advertised", ({ advertisedCandidates }) =>
              calculateDiscounts({
                product: input.affirmedAdvertisement.product,
                discountableSubtotal:
                  input.affirmedAdvertisement.discountableSubtotal,
                candidates: advertisedCandidates,
              })
            ),
            Effect.bind("customerCandidates", ({ releaseGates }) =>
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
              })
            ),
            Effect.bind("customerQuote", ({ advertised, customerCandidates }) =>
              appendDiscounts({
                baseQuote: advertised.quote,
                candidates: customerCandidates,
              })
            ),
            Effect.bind("codeCandidates", ({ releaseGates }) =>
              recoverGatedDiscountResolution({
                enabled:
                  releaseGates.discountCodes &&
                  input.submittedCode !== undefined,
                operation: "apply_customer_discount",
                provider: "code",
                resolve: () =>
                  code.revalidate({
                    product: input.affirmedAdvertisement.product,
                    discountableSubtotal:
                      input.affirmedAdvertisement.discountableSubtotal,
                    dotyposCustomerId: input.dotyposCustomerId,
                    locale: input.locale,
                    submittedCode: input.submittedCode,
                  }),
              }).pipe(
                Effect.map((candidates) =>
                  selectDiscountCandidates({
                    selectedDiscountIds: input.submittedCodeDiscountId
                      ? [input.submittedCodeDiscountId]
                      : [],
                    candidates,
                  })
                )
              )
            ),
            Effect.bind("quote", ({ codeCandidates, customerQuote }) =>
              appendDiscounts({
                baseQuote: customerQuote,
                candidates: codeCandidates,
              })
            ),
            Effect.tap(({ quote }) =>
              logDiscountResolution({
                calculation: { applications: quote.discounts },
              })
            ),
            Effect.map(({ codeCandidates, quote }) => {
              const advertisedCode = input.affirmedAdvertisement.discounts.find(
                ({ discount }) => discount.id === input.submittedCodeDiscountId
              )?.discount;
              const revalidatedCode = codeCandidates[0]?.discount;
              const codeApplied = quote.discounts.some(
                ({ discount }) => discount.id === input.submittedCodeDiscountId
              );

              return {
                ...quote,
                advertisedPriceChanged:
                  advertisedCode !== undefined &&
                  (!codeApplied ||
                    revalidatedCode === undefined ||
                    !discountEquals(advertisedCode, revalidatedCode)),
                ...(codeApplied && {
                  submittedCodeDiscountId: input.submittedCodeDiscountId,
                }),
              };
            })
          ),
        withServiceAnnotations("apply_customer_discount")
      );

      const previewDiscountCode = Effect.fn(
        "DiscountService.previewDiscountCode"
      )(
        (input: PreviewDiscountCodeInput) =>
          Effect.succeed(input).pipe(
            Effect.bind("releaseGates", () =>
              releaseGates.evaluate({ operation: "apply_discount_code" })
            ),
            Effect.tap(({ releaseGates }) =>
              requireDiscountCodesEnabled(releaseGates)
            ),
            Effect.tap(requireEligibleSubtotal),
            Effect.bind("candidates", () =>
              code.preview({
                product: input.baseQuote.product,
                discountableSubtotal: input.baseQuote.discountableSubtotal,
                locale: input.locale,
                submittedCode: input.submittedCode,
              })
            ),
            Effect.bind("quote", ({ candidates }) =>
              appendDiscounts({ baseQuote: input.baseQuote, candidates })
            ),
            Effect.bind("application", ({ quote }) =>
              requireAppliedCode({ baseQuote: input.baseQuote, quote })
            ),
            Effect.map(({ application, quote }) => ({ application, quote }))
          ),
        withApplyDiscountCodeAnnotations
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
                product: calculation.quote.product,
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
              code.revalidate({
                product: input.baseQuote.product,
                discountableSubtotal: input.baseQuote.discountableSubtotal,
                dotyposCustomerId: input.dotyposCustomerId,
                locale: input.locale,
                submittedCode: input.submittedCode,
              })
            ),
            Effect.bind("quote", ({ candidates }) =>
              appendDiscounts({
                baseQuote: input.baseQuote,
                candidates,
              })
            ),
            Effect.bind("application", ({ quote }) =>
              requireAppliedCode({ baseQuote: input.baseQuote, quote })
            ),
            Effect.tap(({ quote }) =>
              logDiscountResolution({
                calculation: { applications: quote.discounts },
              })
            ),
            Effect.map(({ application, quote }) => ({ application, quote }))
          ),
        withApplyDiscountCodeAnnotations
      );

      const affirmDisplayedGoodsBasketDiscounts = Effect.fn(
        "DiscountService.affirmDisplayedGoodsBasketDiscounts"
      )(
        (input: DisplayedGoodsBasketDiscountAffirmationInput) =>
          Effect.succeed(input).pipe(
            Effect.tap(() =>
              calculateGoodsBasketDiscounts({
                lines: input.lines,
                candidates: [],
              })
            ),
            Effect.bind("releaseGates", () =>
              releaseGates.evaluate({
                operation: "affirm_displayed_discounts",
              })
            ),
            Effect.bind("candidates", ({ releaseGates }) =>
              resolveDisplayedGoodsBasketCandidates({
                affirmationInput: input,
                releaseGates,
              })
            ),
            Effect.bind("calculation", ({ candidates }) =>
              calculateGoodsBasketDiscounts({ lines: input.lines, candidates })
            ),
            Effect.map(({ calculation }) => ({
              quote: calculation.quote,
              commitment: makeGoodsBasketDiscountCommitment({
                applications: calculation.applications,
              }),
            }))
          ),
        withGoodsBasketServiceAnnotations("affirm_displayed_discounts")
      );

      return {
        quote,
        quoteGoodsBasket,
        discoverActiveSales,
        discoverAdvertisedDiscounts,
        affirmAdvertisement,
        applyCustomerDiscount,
        previewDiscountCode,
        affirmDisplayedDiscounts,
        affirmDisplayedGoodsBasketDiscounts,
        applyDiscountCode,
      } satisfies IDiscountService;
    })
  );

  static Live = makeDiscountServiceLayer(DiscountReleaseGateService.Live);
}

function makeDiscountServiceLayer(
  releaseGates: Layer.Layer<DiscountReleaseGateService>
) {
  const discountRepositories = Layer.mergeAll(
    DiscountDefinitionRepository.Default,
    PromotionCodeRepository.Default
  ).pipe(Layer.provide(WorkspaceDatabase.Default));
  const providerDependencies = Layer.mergeAll(
    discountRepositories,
    WorkspaceGoogleCalendarLayer,
    CalendarResourceConfig.Default,
    WorkspaceDotyposLayer
  );
  const discountProviders = Layer.mergeAll(
    CalendarDiscountProvider.Live,
    CustomerDiscountProvider.Default,
    PromotionCodeProvider.Default
  ).pipe(Layer.provide(providerDependencies));
  const dependencies = Layer.merge(discountProviders, releaseGates);
  const processScope = Scope.makeUnsafe();
  const processMemoMap = Layer.makeMemoMapUnsafe();

  return Layer.fromBuild(() =>
    Layer.buildWithMemoMap(
      DiscountService.Default.pipe(Layer.provide(dependencies)),
      processMemoMap,
      processScope
    )
  );
}

const recoverGatedDiscountResolution = <A>(input: {
  readonly enabled: boolean;
  readonly operation: DiscountResolutionOperation;
  readonly provider: DiscountResolutionProvider;
  readonly resolve: () => Effect.Effect<
    readonly A[],
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
      }),
    Effect.map(Option.getOrElse(() => []))
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

const selectGoodsBasketDiscountCandidates = (input: {
  readonly selectedDiscountIds: readonly DiscountId[];
  readonly candidates: readonly import("./provider").GoodsBasketDiscountCandidate[];
}) => {
  const candidatesById = new Map(
    input.candidates.map((candidate) => [
      candidate.candidate.discount.id,
      candidate,
    ])
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

const withGoodsBasketServiceAnnotations =
  (operation: "quote" | "affirm_displayed_discounts") =>
  <A>(
    effect: Effect.Effect<A, DiscountCalculationError>,
    input: GoodsDiscountBasketInput
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
        discountProductKind: "goods",
        discountBasketLineCount: input.lines.length,
      })
    );

const requireDiscountCodesEnabled = (releaseGates: DiscountReleaseGates) =>
  releaseGates.discountCodes
    ? Effect.void
    : Effect.fail(
        new PromotionCodeUnavailableError({
          reason: "feature_disabled",
          message: "Discount code entry is disabled.",
        })
      );

const requireEligibleSubtotal = (input: {
  readonly baseQuote: DiscountQuote;
}) =>
  Schema.decodeEffect(positiveWorkspaceMoneyCodec)(
    input.baseQuote.discountedSubtotal
  ).pipe(
    Effect.asVoid,
    Effect.mapError(
      (cause) =>
        new PromotionCodeUnavailableError({
          reason: "no_eligible_subtotal",
          message: "No discountable subtotal remains for a discount code.",
          cause,
        })
    )
  );

const requireAppliedCode = (input: {
  readonly baseQuote: DiscountQuote;
  readonly quote: DiscountQuote;
}) =>
  Schema.decodeUnknownEffect(Schema.Tuple([appliedDiscountCodec]))(
    input.quote.discounts.slice(input.baseQuote.discounts.length)
  ).pipe(
    Effect.map(([application]) => application),
    Effect.mapError(
      (cause) =>
        new PromotionCodeUnavailableError({
          reason: "no_eligible_subtotal",
          message: "The discount code has no applicable amount.",
          cause,
        })
    )
  );

const withApplyDiscountCodeAnnotations = <A>(
  effect: Effect.Effect<A, DiscountResolutionError>,
  input: { readonly baseQuote: DiscountQuote }
) =>
  effect.pipe(
    Effect.tapError((cause) =>
      cause._tag === "PromotionCodeUnavailableError"
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

const discountEquals = Schema.toEquivalence(discountCodec);
