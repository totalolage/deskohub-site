import { Context, Effect, Layer, Option } from "effect";
import { appendDiscounts, calculateDiscounts } from "./calculator";
import { CalendarDiscountProvider } from "./calendar-discount-provider.service";
import { CodeDiscountProvider } from "./code-discount-provider.service";
import { type DiscountCommitment, makeDiscountCommitment } from "./commitment";
import {
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
import type { DiscountCalculationError } from "./errors";
import type { DiscountCandidate } from "./provider";
import {
  type DiscountResolutionFailure,
  type DiscountResolutionOperation,
  type DiscountResolutionProvider,
  logDiscountResolutionFailure,
  recoverDiscountResolution,
} from "./resolution-logging";

export type DiscountAffirmationInput = DiscountQuoteInput & {
  readonly acceptedDiscountIds: readonly DiscountId[];
};

export type DiscountAffirmation = {
  readonly quote: DiscountQuote;
  readonly commitment: DiscountCommitment;
};

export type DiscountAdvertisementAffirmationInput =
  DiscountAdvertisementInput & {
    readonly acceptedDiscountIds: readonly DiscountId[];
  };

export type DiscountIdentifiedQuoteInput = {
  readonly advertisementQuote: DiscountAdvertisementQuote;
  readonly dotyposCustomerId: string;
  readonly locale: DiscountAdvertisementInput["locale"];
};

export interface IDiscountService {
  readonly advertise: (
    input: DiscountAdvertisementInput
  ) => Effect.Effect<DiscountAdvertisementQuote, DiscountCalculationError>;
  readonly affirmAdvertisement: (
    input: DiscountAdvertisementAffirmationInput
  ) => Effect.Effect<DiscountAdvertisementQuote, DiscountCalculationError>;
  readonly quoteIdentified: (
    input: DiscountIdentifiedQuoteInput
  ) => Effect.Effect<DiscountQuote, DiscountCalculationError>;
  readonly quote: (
    input: DiscountQuoteInput
  ) => Effect.Effect<DiscountQuote, DiscountCalculationError>;
  readonly affirm: (
    input: DiscountAffirmationInput
  ) => Effect.Effect<DiscountAffirmation, DiscountCalculationError>;
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
          readonly operation: "advertise" | "affirm_advertisement";
        }) =>
          recoverGatedDiscountResolution({
            enabled: input.releaseGates.calendarSales,
            operation: input.operation,
            provider: "calendar",
            resolve: () =>
              input.operation === "advertise"
                ? calendar.quote(input.advertisementInput)
                : calendar.revalidate(input.advertisementInput),
          }).pipe(Effect.map(Option.getOrElse(() => [])))
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

      const resolveAcceptedCandidates = Effect.fn(
        "DiscountService.resolveAcceptedCandidates"
      )(
        (input: {
          readonly affirmationInput: DiscountAffirmationInput;
          readonly releaseGates: DiscountReleaseGates;
        }) =>
          Effect.all(
            [
              recoverGatedDiscountResolution({
                enabled: input.releaseGates.calendarSales,
                operation: "affirm",
                provider: "calendar",
                resolve: () => calendar.revalidate(input.affirmationInput),
              }),
              recoverGatedDiscountResolution({
                enabled: input.releaseGates.customerDiscounts,
                operation: "affirm",
                provider: "customer",
                resolve: () => customer.resolve(input.affirmationInput),
              }),
              recoverGatedDiscountResolution({
                enabled: input.releaseGates.discountCodes,
                operation: "affirm",
                provider: "code",
                resolve: () => code.revalidate(input.affirmationInput),
              }),
            ],
            { concurrency: "inherit" }
          ).pipe(
            Effect.map(collectDiscountCandidates),
            Effect.map((candidates) =>
              selectAcceptedCandidates({
                acceptedDiscountIds: input.affirmationInput.acceptedDiscountIds,
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

      const advertise = Effect.fn("DiscountService.advertise")(
        (input: DiscountAdvertisementInput) =>
          Effect.succeed(input).pipe(
            Effect.bind("releaseGates", () =>
              releaseGates.evaluate({ operation: "advertise" })
            ),
            Effect.bind("candidates", ({ releaseGates }) =>
              resolveAdvertisementCandidates({
                advertisementInput: input,
                releaseGates,
                operation: "advertise",
              })
            ),
            Effect.bind("calculation", calculateDiscounts),
            Effect.tap(logDiscountResolution),
            Effect.map(({ calculation }) =>
              makeDiscountAdvertisementQuote(calculation.quote)
            )
          ),
        withServiceAnnotations("advertise")
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
                    input.acceptedDiscountIds.length > 0,
                },
                operation: "affirm_advertisement",
              }).pipe(
                Effect.map((candidates) =>
                  selectAcceptedCandidates({
                    acceptedDiscountIds: input.acceptedDiscountIds,
                    candidates,
                  })
                )
              )
            ),
            Effect.bind("calculation", calculateDiscounts),
            Effect.tap(logDiscountResolution),
            Effect.map(({ calculation }) =>
              makeDiscountAdvertisementQuote(calculation.quote)
            )
          ),
        withServiceAnnotations("affirm_advertisement")
      );

      const quoteIdentified = Effect.fn("DiscountService.quoteIdentified")(
        (input: DiscountIdentifiedQuoteInput) =>
          Effect.succeed(input).pipe(
            Effect.bind("releaseGates", () =>
              releaseGates.evaluate({ operation: "quote_identified" })
            ),
            Effect.bind("candidates", ({ releaseGates }) =>
              recoverGatedDiscountResolution({
                enabled: releaseGates.customerDiscounts,
                operation: "quote_identified",
                provider: "customer",
                resolve: () =>
                  customer.resolve({
                    dotyposCustomerId: input.dotyposCustomerId,
                    locale: input.locale,
                    product: input.advertisementQuote.product,
                  }),
              }).pipe(Effect.map(Option.getOrElse(() => [])))
            ),
            Effect.bind("quote", ({ candidates }) =>
              appendDiscounts({
                baseQuote: input.advertisementQuote,
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
        withServiceAnnotations("quote_identified")
      );

      const affirm = Effect.fn("DiscountService.affirm")(
        (input: DiscountAffirmationInput) =>
          Effect.succeed(input).pipe(
            Effect.bind("releaseGates", () =>
              releaseGates.evaluate({ operation: "affirm" })
            ),
            Effect.bind("candidates", ({ releaseGates }) =>
              resolveAcceptedCandidates({
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
        withServiceAnnotations("affirm")
      );

      return {
        advertise,
        affirmAdvertisement,
        quoteIdentified,
        quote,
        affirm,
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

const selectAcceptedCandidates = (input: {
  readonly acceptedDiscountIds: readonly DiscountId[];
  readonly candidates: readonly DiscountCandidate[];
}) => {
  const candidatesById = new Map(
    input.candidates.map((candidate) => [candidate.discount.id, candidate])
  );

  return input.acceptedDiscountIds.flatMap((discountId) => {
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
      | "affirm"
      | "advertise"
      | "affirm_advertisement"
      | "quote_identified"
  ) =>
  <A>(
    effect: Effect.Effect<A, DiscountCalculationError>,
    input:
      | DiscountQuoteInput
      | DiscountAffirmationInput
      | DiscountAdvertisementInput
      | DiscountAdvertisementAffirmationInput
      | DiscountIdentifiedQuoteInput
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
            : input.advertisementQuote.product.kind,
        discountProductTier:
          "product" in input
            ? input.product.tier
            : input.advertisementQuote.product.tier,
      })
    );

const makeDiscountAdvertisementQuote = (
  quote: DiscountQuote
): DiscountAdvertisementQuote => discountAdvertisementQuoteCodec.make(quote);
