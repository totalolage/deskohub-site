import { Context, Effect, Layer } from "effect";
import { calculateDiscounts } from "./calculator";
import { CalendarDiscountProvider } from "./calendar-discount-provider.service";
import { CodeDiscountProvider } from "./code-discount-provider.service";
import { type DiscountCommitment, makeDiscountCommitment } from "./commitment";
import type {
  DiscountId,
  DiscountQuote,
  DiscountQuoteInput,
} from "./contracts";
import { CustomerDiscountProvider } from "./customer-discount-provider.service";
import type {
  DiscountCalculationError,
  DiscountResolutionError,
} from "./errors";
import type { DiscountCandidate } from "./provider";
import {
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

export interface IDiscountService {
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

      const resolveQuoteCandidates = Effect.fn(
        "DiscountService.resolveQuoteCandidates"
      )((input: DiscountQuoteInput) =>
        Effect.all(
          {
            calendarCandidates: recoverProviderCandidates(
              calendar.quote(input),
              "calendar",
              "quote"
            ),
            customerCandidates: recoverProviderCandidates(
              customer.resolve(input),
              "customer",
              "quote"
            ),
            codeCandidates: recoverProviderCandidates(
              code.quote(input),
              "code",
              "quote"
            ),
          },
          { concurrency: "unbounded" }
        ).pipe(Effect.map(collectDiscountCandidates))
      );

      const resolveAcceptedCandidates = Effect.fn(
        "DiscountService.resolveAcceptedCandidates"
      )((input: DiscountAffirmationInput) =>
        Effect.all(
          {
            calendarCandidates: recoverProviderCandidates(
              calendar.revalidate(input),
              "calendar",
              "affirm"
            ),
            customerCandidates: recoverProviderCandidates(
              customer.resolve(input),
              "customer",
              "affirm"
            ),
            codeCandidates: recoverProviderCandidates(
              code.revalidate(input),
              "code",
              "affirm"
            ),
          },
          { concurrency: "unbounded" }
        ).pipe(
          Effect.map(collectDiscountCandidates),
          Effect.map((candidates) =>
            selectAcceptedCandidates({
              acceptedDiscountIds: input.acceptedDiscountIds,
              candidates,
            })
          )
        )
      );

      const quote = Effect.fn("DiscountService.quote")(
        (input: DiscountQuoteInput) =>
          Effect.succeed(input).pipe(
            Effect.bind("candidates", resolveQuoteCandidates),
            Effect.bind("calculation", calculateDiscounts),
            Effect.tap(logDiscountResolution),
            Effect.map(({ calculation }) => calculation.quote)
          ),
        withServiceAnnotations("quote")
      );

      const affirm = Effect.fn("DiscountService.affirm")(
        (input: DiscountAffirmationInput) =>
          Effect.succeed(input).pipe(
            Effect.bind("candidates", resolveAcceptedCandidates),
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

      return { quote, affirm } satisfies IDiscountService;
    })
  );
}

const collectDiscountCandidates = (input: {
  readonly calendarCandidates: readonly DiscountCandidate[];
  readonly customerCandidates: readonly DiscountCandidate[];
  readonly codeCandidates: readonly DiscountCandidate[];
}) => [
  ...input.calendarCandidates,
  ...input.customerCandidates,
  ...input.codeCandidates,
];

const recoverProviderCandidates = <E extends DiscountResolutionError>(
  effect: Effect.Effect<readonly DiscountCandidate[], E>,
  provider: DiscountResolutionProvider,
  operation: Extract<DiscountResolutionOperation, "quote" | "affirm">
) => recoverDiscountResolution(effect, [], { operation, provider });

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
  (operation: "quote" | "affirm") =>
  <A>(
    effect: Effect.Effect<A, DiscountCalculationError>,
    input: DiscountQuoteInput | DiscountAffirmationInput
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
        discountProductKind: input.product.kind,
        discountProductTier: input.product.tier,
      })
    );
