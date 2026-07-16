import { Context, Effect, Layer } from "effect";
import { calculateDiscounts } from "./calculator";
import { CalendarDiscountProvider } from "./calendar-discount-provider.service";
import { CodeDiscountProvider } from "./code-discount-provider.service";
import { type DiscountCommitment, makeDiscountCommitment } from "./commitment";
import type { DiscountQuote, DiscountQuoteInput } from "./contracts";
import { CustomerDiscountProvider } from "./customer-discount-provider.service";
import type { DiscountResolutionError } from "./errors";
import type { DiscountCandidate } from "./provider";

export type DiscountRevalidation = {
  readonly quote: DiscountQuote;
  readonly commitment: DiscountCommitment;
};

export interface IDiscountService {
  readonly quote: (
    input: DiscountQuoteInput
  ) => Effect.Effect<DiscountQuote, DiscountResolutionError>;
  readonly revalidate: (
    input: DiscountQuoteInput
  ) => Effect.Effect<DiscountRevalidation, DiscountResolutionError>;
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
            calendarCandidates: calendar.quote(input),
            customerCandidates: customer.resolve(input),
            codeCandidates: code.quote(input),
          },
          { concurrency: "unbounded" }
        ).pipe(Effect.map(collectDiscountCandidates))
      );

      const resolveRevalidatedCandidates = Effect.fn(
        "DiscountService.resolveRevalidatedCandidates"
      )((input: DiscountQuoteInput) =>
        Effect.all(
          {
            calendarCandidates: calendar.revalidate(input),
            customerCandidates: customer.resolve(input),
            codeCandidates: code.revalidate(input),
          },
          { concurrency: "unbounded" }
        ).pipe(Effect.map(collectDiscountCandidates))
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

      const revalidate = Effect.fn("DiscountService.revalidate")(
        (input: DiscountQuoteInput) =>
          Effect.succeed(input).pipe(
            Effect.bind("candidates", resolveRevalidatedCandidates),
            Effect.bind("calculation", calculateDiscounts),
            Effect.tap(logDiscountResolution),
            Effect.map(({ calculation }) => ({
              quote: calculation.quote,
              commitment: makeDiscountCommitment({
                applications: calculation.applications,
              }),
            }))
          ),
        withServiceAnnotations("revalidate")
      );

      return { quote, revalidate } satisfies IDiscountService;
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

const logDiscountResolution = (input: {
  readonly calculation: {
    readonly applications: readonly unknown[];
  };
}) =>
  Effect.logDebug("Discount quote resolved", {
    appliedDiscountCount: input.calculation.applications.length,
  });

const logDiscountResolutionError = (cause: DiscountResolutionError) =>
  Effect.logError("Discount resolution failed", {
    errorTag: cause._tag,
    reason: cause.reason,
  });

const withServiceAnnotations =
  (operation: "quote" | "revalidate") =>
  <A>(
    effect: Effect.Effect<A, DiscountResolutionError>,
    input: DiscountQuoteInput
  ) =>
    effect.pipe(
      Effect.tapError(logDiscountResolutionError),
      Effect.annotateLogs({
        operation,
        product: input.product,
        reservationDate: input.reservationDate,
        dotyposCustomerId: input.dotyposCustomerId,
      })
    );
