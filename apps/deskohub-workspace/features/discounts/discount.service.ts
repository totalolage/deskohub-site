import { Context, Effect, Layer, Option, Schema, Scope } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import { getWorkspaceProductKey } from "@/features/checkout/product-identity";
import {
  positiveWorkspaceMoneyCodec,
  workspaceMoneyWithValue,
} from "@/features/checkout/workspace-money";
import type { Locale } from "@/features/i18n";
import { ReferralService } from "@/features/referrals";
import {
  getReferralInvitationDiscountId,
  getReferralReferrerDiscountId,
} from "@/features/referrals/discount-identifiers";
import type { DotyposCustomerId } from "@/features/reservation/dotypos-customer";
import { CalendarResourceConfig } from "@/shared/backend/config/calendar-resource.config";
import { WorkspaceDotyposLayer } from "@/shared/backend/config/dotypos.config";
import { WorkspaceGoogleCalendarLayer } from "@/shared/backend/config/google-calendar.config";
import { appendDiscounts, calculateDiscounts } from "./calculator";
import { CalendarDiscountProvider } from "./calendar-discount-provider.service";
import { type DiscountCommitment, makeDiscountCommitment } from "./commitment";
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
} from "./contracts";
import { CustomerDiscountProvider } from "./customer-discount-provider.service";
import { DiscountDefinitionRepository } from "./discount-definition.repository";
import {
  DiscountReleaseGateService,
  type DiscountReleaseGates,
} from "./discount-release-gate.service";
import {
  DiscountAffirmationUnavailableError,
  type DiscountCalculationError,
  type DiscountResolutionError,
  PromotionCodeUnavailableError,
} from "./errors";
import { PromotionCodeRepository } from "./promotion-code.repository";
import { PromotionCodeProvider } from "./promotion-code-provider.service";
import type {
  DiscountCandidate,
  DiscountCandidateResolution,
} from "./provider";
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
  /** Referral code the checkout carries for an unattributed customer. */
  readonly referralCode?: CanonicalPromotionCode;
  readonly displayedDiscountIds: readonly DiscountId[];
};

type DisplayedDiscountAffirmation = {
  readonly quote: DiscountQuote;
  readonly commitment: DiscountCommitment;
};

type DiscountAdvertisementAffirmationInput = DiscountAdvertisementInput & {
  readonly advertisedDiscountIds: readonly DiscountId[];
};

type ApplyCustomerDiscountInput = {
  readonly affirmedAdvertisement: AffirmedDiscountAdvertisementQuote;
  readonly dotyposCustomerId: DotyposCustomerId;
  readonly locale: Locale;
  readonly submittedCode?: CanonicalPromotionCode;
  readonly submittedCodeDiscountId?: DiscountId;
  readonly referralCode?: CanonicalPromotionCode;
};

type AppliedCustomerDiscountQuote = DiscountQuote & {
  readonly advertisedPriceChanged: boolean;
  readonly submittedCodeDiscountId?: DiscountId;
};

type ApplyDiscountCodeInput = {
  readonly baseQuote: DiscountQuote;
  readonly dotyposCustomerId: DotyposCustomerId;
  readonly locale: Locale;
  readonly submittedCode: CanonicalPromotionCode;
  readonly referralCode?: CanonicalPromotionCode;
};

type DiscountAffirmationError =
  | DiscountCalculationError
  | DiscountAffirmationUnavailableError;

type PreviewDiscountCodeInput = Omit<
  ApplyDiscountCodeInput,
  "dotyposCustomerId" | "referralCode"
>;

type AppliedDiscountCodeQuote = {
  readonly quote: DiscountQuote;
  readonly application: AppliedDiscount;
};

/**
 * The anonymous discounts on an advertised price. `complete` is false when a
 * discount source could not answer, so a running sale may be missing.
 */
type DiscountAdvertisement = {
  readonly quote: DiscountAdvertisementQuote;
  readonly complete: boolean;
};

export interface IDiscountService {
  readonly discoverActiveSales: (
    input: ActiveSaleDiscoveryInput
  ) => Effect.Effect<readonly ActiveSale[]>;
  readonly quote: (
    input: DiscountQuoteInput
  ) => Effect.Effect<DiscountQuote, DiscountCalculationError>;
  readonly discoverAdvertisedDiscounts: (
    input: DiscountAdvertisementInput
  ) => Effect.Effect<DiscountAdvertisement, DiscountCalculationError>;
  readonly affirmAdvertisement: (
    input: DiscountAdvertisementAffirmationInput
  ) => Effect.Effect<
    AffirmedDiscountAdvertisementQuote,
    DiscountAffirmationError
  >;
  readonly applyCustomerDiscount: (
    input: ApplyCustomerDiscountInput
  ) => Effect.Effect<AppliedCustomerDiscountQuote, DiscountAffirmationError>;
  readonly previewDiscountCode: (
    input: PreviewDiscountCodeInput
  ) => Effect.Effect<AppliedDiscountCodeQuote, DiscountResolutionError>;
  readonly affirmDisplayedDiscounts: (
    input: DisplayedDiscountAffirmationInput
  ) => Effect.Effect<DisplayedDiscountAffirmation, DiscountAffirmationError>;
  readonly applyDiscountCode: (
    input: ApplyDiscountCodeInput
  ) => Effect.Effect<AppliedDiscountCodeQuote, DiscountResolutionError>;
}

// Built once per process by `makeDiscountServiceLayer`, below.
const discountProviders = Layer.mergeAll(
  CalendarDiscountProvider.Live,
  CustomerDiscountProvider.Default,
  PromotionCodeProvider.Default
).pipe(
  Layer.provide(
    Layer.mergeAll(
      Layer.mergeAll(
        DiscountDefinitionRepository.Default,
        PromotionCodeRepository.Default
      ).pipe(Layer.provide(WorkspaceDatabase.Default)),
      WorkspaceGoogleCalendarLayer,
      CalendarResourceConfig.Default,
      WorkspaceDotyposLayer
    )
  )
);
const processScope = Scope.makeUnsafe();
const processMemoMap = Layer.makeMemoMapUnsafe();
const processDiscountProviders = Layer.fromBuild(() =>
  Layer.buildWithMemoMap(discountProviders, processMemoMap, processScope)
);

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
      const referrals = yield* ReferralService;
      const releaseGates = yield* DiscountReleaseGateService;

      const appendReferralDiscounts = Effect.fn(
        "DiscountService.appendReferralDiscounts"
      )(
        (input: {
          readonly baseQuote: DiscountQuote;
          readonly dotyposCustomerId: DotyposCustomerId;
          readonly locale: Locale;
          readonly referralCode: CanonicalPromotionCode | undefined;
          readonly operation: DiscountResolutionOperation;
          readonly voucherCandidates: readonly DiscountCandidate[];
        }) => {
          // Voucher candidates are last in each provider order; reapply their credit after referral pricing.
          const voucherCandidates = input.voucherCandidates.filter(
            ({ claim }) => claim?.kind === "voucher"
          );
          return Effect.succeed(input).pipe(
            Effect.let("referralBaseQuote", () =>
              removeVoucherApplications(input.baseQuote, voucherCandidates)
            ),
            Effect.bind("invitationCandidate", () =>
              recoverDiscountResolution(
                referrals.resolveInvitationCandidate({
                  dotyposCustomerId: input.dotyposCustomerId,
                  locale: input.locale,
                  ...(input.referralCode !== undefined && {
                    referralCode: input.referralCode,
                  }),
                }),
                { operation: input.operation, provider: "referral" }
              ).pipe(Effect.map(Option.getOrUndefined))
            ),
            Effect.bind(
              "invitationCalculation",
              ({ invitationCandidate, referralBaseQuote }) =>
                calculateDiscounts({
                  product: referralBaseQuote.product,
                  discountableSubtotal: referralBaseQuote.discountedSubtotal,
                  candidates: invitationCandidate ? [invitationCandidate] : [],
                })
            ),
            Effect.bind("referrerCandidate", ({ invitationCalculation }) =>
              recoverDiscountResolution(
                referrals.resolveReferrerCandidate({
                  dotyposCustomerId: input.dotyposCustomerId,
                  locale: input.locale,
                  remainingSubtotal:
                    invitationCalculation.quote.discountedSubtotal,
                }),
                { operation: input.operation, provider: "referral" }
              ).pipe(Effect.map(Option.getOrUndefined))
            ),
            Effect.bind(
              "referrerCalculation",
              ({
                invitationCalculation,
                referrerCandidate,
                referralBaseQuote,
              }) =>
                calculateDiscounts({
                  product: referralBaseQuote.product,
                  discountableSubtotal:
                    invitationCalculation.quote.discountedSubtotal,
                  candidates: referrerCandidate ? [referrerCandidate] : [],
                })
            ),
            Effect.map(
              ({
                invitationCalculation,
                referrerCalculation,
                referralBaseQuote,
              }) => {
                const addedDiscount =
                  invitationCalculation.quote.totalDiscount.value +
                  referrerCalculation.quote.totalDiscount.value;
                const addedApplications = [
                  ...invitationCalculation.applications,
                  ...referrerCalculation.applications,
                ];
                return {
                  quote: {
                    product: referralBaseQuote.product,
                    discountableSubtotal:
                      referralBaseQuote.discountableSubtotal,
                    discounts: [
                      ...referralBaseQuote.discounts,
                      ...invitationCalculation.quote.discounts,
                      ...referrerCalculation.quote.discounts,
                    ],
                    totalDiscount: workspaceMoneyWithValue(
                      referralBaseQuote.totalDiscount.value + addedDiscount,
                      referralBaseQuote.totalDiscount
                    ),
                    discountedSubtotal:
                      referrerCalculation.quote.discountedSubtotal,
                  } satisfies DiscountQuote,
                  applications: addedApplications,
                };
              }
            ),
            Effect.flatMap((referralQuote) => {
              return voucherCandidates.length === 0
                ? Effect.succeed(referralQuote)
                : appendDiscounts({
                    baseQuote: referralQuote.quote,
                    candidates: voucherCandidates,
                  }).pipe(Effect.map((quote) => ({ ...referralQuote, quote })));
            })
          );
        }
      );

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
                resolve: () =>
                  calendar
                    .discover(input.quoteInput)
                    .pipe(Effect.map(({ candidates }) => candidates)),
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
              resolveGatedCandidates({
                enabled: input.releaseGates.calendarSales,
                operation: "affirm_displayed_discounts",
                provider: "calendar",
                resolve: () => calendar.revalidate(input.affirmationInput),
              }),
              resolveGatedCandidates({
                enabled: input.releaseGates.customerDiscounts,
                operation: "affirm_displayed_discounts",
                provider: "customer",
                resolve: () =>
                  customer
                    .resolve(input.affirmationInput)
                    .pipe(Effect.map(toCompleteResolution)),
              }),
              resolveGatedCandidates({
                enabled: input.releaseGates.discountCodes,
                operation: "affirm_displayed_discounts",
                provider: "code",
                resolve: () =>
                  code
                    .revalidate(input.affirmationInput)
                    .pipe(Effect.map(toCompleteResolution)),
              }),
            ],
            { concurrency: "inherit" }
          ).pipe(
            Effect.flatMap((resolutions) =>
              selectAffirmedCandidates({
                selectedDiscountIds:
                  input.affirmationInput.displayedDiscountIds,
                resolutions,
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
            Effect.bind("referralQuote", ({ calculation }) =>
              appendReferralDiscounts({
                baseQuote: calculation.quote,
                dotyposCustomerId: input.dotyposCustomerId,
                locale: input.locale,
                referralCode: input.referralCode,
                operation: "quote",
                voucherCandidates: calculation.applications.map(
                  ({ candidate }) => candidate
                ),
              })
            ),
            Effect.tap(({ referralQuote }) =>
              logDiscountResolution({
                calculation: { applications: referralQuote.quote.discounts },
              })
            ),
            Effect.map(({ referralQuote }) => referralQuote.quote)
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
            Effect.bind("resolution", ({ releaseGates }) =>
              resolveGatedCandidates({
                enabled: releaseGates.calendarSales,
                operation: "discover_advertised_discounts",
                provider: "calendar",
                resolve: () => calendar.discover(input),
              })
            ),
            Effect.let("candidates", ({ resolution }) => resolution.candidates),
            Effect.bind("calculation", calculateDiscounts),
            Effect.tap(logDiscountResolution),
            Effect.map(
              ({ calculation, resolution }): DiscountAdvertisement => ({
                quote: makeDiscountAdvertisementQuote(calculation.quote),
                complete: resolution.complete,
              })
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
              resolveGatedCandidates({
                enabled:
                  releaseGates.calendarSales &&
                  input.advertisedDiscountIds.length > 0,
                operation: "affirm_advertisement",
                provider: "calendar",
                resolve: () => calendar.revalidate(input),
              }).pipe(
                Effect.flatMap((resolution) =>
                  selectAffirmedCandidates({
                    selectedDiscountIds: input.advertisedDiscountIds,
                    resolutions: [resolution],
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
              resolveGatedCandidates({
                enabled:
                  releaseGates.discountCodes &&
                  input.submittedCode !== undefined,
                operation: "apply_customer_discount",
                provider: "code",
                resolve: () =>
                  code
                    .revalidate({
                      product: input.affirmedAdvertisement.product,
                      discountableSubtotal:
                        input.affirmedAdvertisement.discountableSubtotal,
                      dotyposCustomerId: input.dotyposCustomerId,
                      locale: input.locale,
                      submittedCode: input.submittedCode,
                    })
                    .pipe(Effect.map(toCompleteResolution)),
              }).pipe(
                Effect.flatMap((resolution) =>
                  selectAffirmedCandidates({
                    selectedDiscountIds: input.submittedCodeDiscountId
                      ? [input.submittedCodeDiscountId]
                      : [],
                    resolutions: [resolution],
                  })
                )
              )
            ),
            Effect.bind("ordinaryQuote", ({ codeCandidates, customerQuote }) =>
              appendDiscounts({
                baseQuote: customerQuote,
                candidates: codeCandidates,
              })
            ),
            Effect.bind("referralQuote", ({ codeCandidates, ordinaryQuote }) =>
              appendReferralDiscounts({
                baseQuote: ordinaryQuote,
                dotyposCustomerId: input.dotyposCustomerId,
                locale: input.locale,
                referralCode: input.referralCode,
                operation: "apply_customer_discount",
                voucherCandidates: codeCandidates,
              })
            ),
            Effect.tap(({ referralQuote }) =>
              logDiscountResolution({
                calculation: { applications: referralQuote.quote.discounts },
              })
            ),
            Effect.map(({ codeCandidates, ordinaryQuote, referralQuote }) => {
              const advertisedCode = input.affirmedAdvertisement.discounts.find(
                ({ discount }) => discount.id === input.submittedCodeDiscountId
              )?.discount;
              const revalidatedCode = codeCandidates[0]?.discount;
              const codeApplied = ordinaryQuote.discounts.some(
                ({ discount }) => discount.id === input.submittedCodeDiscountId
              );

              return {
                ...referralQuote.quote,
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
                affirmationInput: {
                  ...input,
                  displayedDiscountIds: getOrdinaryDiscountIds(input),
                },
                releaseGates,
              })
            ),
            Effect.bind("calculation", calculateDiscounts),
            Effect.bind("referralQuote", ({ calculation }) =>
              appendReferralDiscounts({
                baseQuote: calculation.quote,
                dotyposCustomerId: input.dotyposCustomerId,
                locale: input.locale,
                referralCode: input.referralCode,
                operation: "affirm_displayed_discounts",
                voucherCandidates: calculation.applications.map(
                  ({ candidate }) => candidate
                ),
              })
            ),
            Effect.tap(({ referralQuote }) =>
              logDiscountResolution({
                calculation: { applications: referralQuote.quote.discounts },
              })
            ),
            Effect.map(({ calculation, referralQuote }) => {
              const candidatesById = new Map<DiscountId, DiscountCandidate>();
              for (const { candidate } of [
                ...calculation.applications,
                ...referralQuote.applications,
              ]) {
                candidatesById.set(candidate.discount.id, candidate);
              }
              const applications = referralQuote.quote.discounts.flatMap(
                (application) => {
                  const candidate = candidatesById.get(application.discount.id);
                  return candidate ? [{ application, candidate }] : [];
                }
              );
              return {
                quote: referralQuote.quote,
                commitment: makeDiscountCommitment({
                  product: referralQuote.quote.product,
                  applications,
                }),
              };
            })
          ),
        withServiceAnnotations("affirm_displayed_discounts")
      );

      const applyDiscountCode = Effect.fn("DiscountService.applyDiscountCode")(
        (input: ApplyDiscountCodeInput) =>
          Effect.succeed(input).pipe(
            Effect.let("ordinaryBaseQuote", () =>
              removeReferralDiscounts(input.baseQuote, input.dotyposCustomerId)
            ),
            Effect.bind("releaseGates", () =>
              releaseGates.evaluate({ operation: "apply_discount_code" })
            ),
            Effect.tap(({ releaseGates }) =>
              requireDiscountCodesEnabled(releaseGates)
            ),
            Effect.tap(({ ordinaryBaseQuote }) =>
              requireEligibleSubtotal({ baseQuote: ordinaryBaseQuote })
            ),
            Effect.bind("candidates", () =>
              code.revalidate({
                product: input.baseQuote.product,
                discountableSubtotal: input.baseQuote.discountableSubtotal,
                dotyposCustomerId: input.dotyposCustomerId,
                locale: input.locale,
                submittedCode: input.submittedCode,
              })
            ),
            Effect.bind("ordinaryQuote", ({ candidates, ordinaryBaseQuote }) =>
              appendDiscounts({
                baseQuote: ordinaryBaseQuote,
                candidates,
              })
            ),
            Effect.bind("application", ({ ordinaryBaseQuote, ordinaryQuote }) =>
              requireAppliedCode({
                baseQuote: ordinaryBaseQuote,
                quote: ordinaryQuote,
              })
            ),
            Effect.bind("referralQuote", ({ candidates, ordinaryQuote }) =>
              appendReferralDiscounts({
                baseQuote: ordinaryQuote,
                dotyposCustomerId: input.dotyposCustomerId,
                locale: input.locale,
                referralCode: input.referralCode,
                operation: "apply_discount_code",
                voucherCandidates: candidates,
              })
            ),
            Effect.tap(({ referralQuote }) =>
              logDiscountResolution({
                calculation: { applications: referralQuote.quote.discounts },
              })
            ),
            Effect.map(({ application, referralQuote }) => ({
              application:
                referralQuote.quote.discounts.find(
                  ({ discount }) => discount.id === application.discount.id
                ) ?? application,
              quote: referralQuote.quote,
            }))
          ),
        withApplyDiscountCodeAnnotations
      );

      return {
        quote,
        discoverActiveSales,
        discoverAdvertisedDiscounts,
        affirmAdvertisement,
        applyCustomerDiscount,
        previewDiscountCode,
        affirmDisplayedDiscounts,
        applyDiscountCode,
      } satisfies IDiscountService;
    })
  );

  static Live = makeDiscountServiceLayer({
    service: this.Default,
    releaseGates: DiscountReleaseGateService.Live,
    referrals: ReferralService.Live,
  });

  /**
   * The live discounts under release gates the caller already decided, for
   * work that must not read the request, such as a cached render.
   */
  static withReleaseGates = (gates: DiscountReleaseGates) =>
    makeDiscountServiceLayer({
      service: this.Default,
      releaseGates: DiscountReleaseGateService.fromDecisions(gates),
      referrals: ReferralService.Live,
    });
}

/**
 * Builds the discount providers once per process, shared by every discount
 * service: they hold clients and configuration and read nothing from the
 * request. The release gates, the referral service and the discount service
 * over them are built per run, so each run sees its own request's decisions
 * (`DiscountReleaseGateService`, `ReferralFeatureFlagService`).
 */
export function makeDiscountServiceLayer<E, R>(input: {
  readonly service: typeof DiscountService.Default;
  readonly releaseGates: Layer.Layer<DiscountReleaseGateService>;
  readonly referrals: Layer.Layer<ReferralService, E, R>;
}) {
  return input.service.pipe(
    Layer.provide(
      Layer.mergeAll(
        processDiscountProviders,
        input.releaseGates,
        input.referrals
      )
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

const toCompleteResolution = (
  candidates: readonly DiscountCandidate[]
): DiscountCandidateResolution => ({ candidates, complete: true });

/**
 * Resolves one provider's candidates where a missing discount matters: when
 * affirming discounts the customer has already seen, or advertising a price
 * others may share. A disabled provider and an unavailable promotion code are
 * definitive answers. Any other failure is logged and leaves the resolution
 * incomplete, because it cannot show that a missing discount is gone.
 */
const resolveGatedCandidates = (input: {
  readonly enabled: boolean;
  readonly operation: DiscountResolutionOperation;
  readonly provider: DiscountResolutionProvider;
  readonly resolve: () => Effect.Effect<
    DiscountCandidateResolution,
    DiscountResolutionFailure
  >;
}): Effect.Effect<DiscountCandidateResolution> =>
  Effect.suspend(input.resolve).pipe(
    Effect.when(Effect.succeed(input.enabled)),
    Effect.map(Option.getOrElse(() => toCompleteResolution([]))),
    Effect.tapError((cause) =>
      logDiscountResolutionFailure({
        cause,
        operation: input.operation,
        provider: input.provider,
      })
    ),
    Effect.catch((cause) =>
      Effect.succeed(
        cause._tag === "PromotionCodeUnavailableError"
          ? toCompleteResolution([])
          : { candidates: [], complete: false }
      )
    )
  );

/**
 * Selects the candidates that affirm the given discounts, in their order. A
 * discount that no candidate affirms is gone only when every provider
 * resolved completely; otherwise it cannot be affirmed yet.
 */
const selectAffirmedCandidates = (input: {
  readonly selectedDiscountIds: readonly DiscountId[];
  readonly resolutions: readonly DiscountCandidateResolution[];
}) => {
  const candidates = selectDiscountCandidates({
    selectedDiscountIds: input.selectedDiscountIds,
    candidates: input.resolutions.flatMap(({ candidates }) => candidates),
  });
  const affirmedDiscountIds = new Set(
    candidates.map(({ discount }) => discount.id)
  );
  const unaffirmedDiscountIds = input.selectedDiscountIds.filter(
    (discountId) => !affirmedDiscountIds.has(discountId)
  );

  return unaffirmedDiscountIds.length > 0 &&
    input.resolutions.some(({ complete }) => !complete)
    ? Effect.fail(
        new DiscountAffirmationUnavailableError({
          message:
            "Displayed discounts could not be affirmed because a provider was unavailable.",
          discountIds: unaffirmedDiscountIds,
        })
      )
    : Effect.succeed(candidates);
};

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

const getReferralDiscountIds = (dotyposCustomerId: DotyposCustomerId) => [
  getReferralInvitationDiscountId(dotyposCustomerId),
  getReferralReferrerDiscountId(dotyposCustomerId),
];

const getOrdinaryDiscountIds = (input: DisplayedDiscountAffirmationInput) => {
  const referralIds = new Set(getReferralDiscountIds(input.dotyposCustomerId));
  return input.displayedDiscountIds.filter(
    (discountId) => !referralIds.has(discountId)
  );
};

const removeReferralDiscounts = (
  quote: DiscountQuote,
  dotyposCustomerId: DotyposCustomerId
): DiscountQuote => {
  const referralIds = new Set(getReferralDiscountIds(dotyposCustomerId));
  const firstReferral = quote.discounts.find(({ discount }) =>
    referralIds.has(discount.id)
  );
  if (!firstReferral) return quote;

  const discounts = quote.discounts.filter(
    ({ discount }) => !referralIds.has(discount.id)
  );
  const discountedSubtotal = firstReferral.subtotalBefore;
  return {
    ...quote,
    discounts,
    totalDiscount: workspaceMoneyWithValue(
      quote.discountableSubtotal.value - discountedSubtotal.value,
      quote.totalDiscount
    ),
    discountedSubtotal,
  };
};

const removeVoucherApplications = (
  quote: DiscountQuote,
  candidates: readonly DiscountCandidate[]
): DiscountQuote => {
  const voucherIds = new Set(
    candidates
      .filter(({ claim }) => claim?.kind === "voucher")
      .map(({ discount }) => discount.id)
  );
  if (voucherIds.size === 0) return quote;

  const voucherApplications = quote.discounts.filter(({ discount }) =>
    voucherIds.has(discount.id)
  );
  if (voucherApplications.length === 0) return quote;

  const voucherAmount = voucherApplications.reduce(
    (total, application) => total + application.amount.value,
    0
  );
  return {
    ...quote,
    discounts: quote.discounts.filter(
      ({ discount }) => !voucherIds.has(discount.id)
    ),
    totalDiscount: workspaceMoneyWithValue(
      quote.totalDiscount.value - voucherAmount,
      quote.totalDiscount
    ),
    discountedSubtotal: workspaceMoneyWithValue(
      quote.discountedSubtotal.value + voucherAmount,
      quote.discountedSubtotal
    ),
  };
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
  <A, E extends DiscountAffirmationError>(
    effect: Effect.Effect<A, E>,
    input:
      | DisplayedDiscountAffirmationInput
      | DiscountQuoteInput
      | DiscountAdvertisementInput
      | DiscountAdvertisementAffirmationInput
      | ApplyCustomerDiscountInput
  ) =>
    effect.pipe(
      Effect.tapError((cause) =>
        cause._tag === "DiscountAffirmationUnavailableError"
          ? Effect.logWarning(cause.message, {
              unaffirmedDiscountCount: cause.discountIds.length,
            })
          : logDiscountResolutionFailure({
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
