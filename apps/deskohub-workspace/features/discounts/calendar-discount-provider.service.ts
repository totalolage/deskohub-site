import { GoogleCalendarService } from "@deskohub/google-calendar";
import { Cache, Context, Data, Duration, Effect, Exit, Layer } from "effect";
import { CalendarResourceConfig } from "@/shared/backend/config/calendar-resource.config";
import {
  type CalendarSale,
  type CalendarSaleConfigurationError,
  normalizeCalendarSales,
} from "./calendar-sale";
import type { DiscountProductIdentity, DiscountQuoteInput } from "./contracts";
import { DiscountProviderError } from "./errors";
import { deriveOpaqueDiscountId } from "./opaque-discount-id";
import type { DiscountCandidate } from "./provider";

const providerNamespace = "google-calendar-sales";

export type CalendarDiscountProviderInput = Pick<
  DiscountQuoteInput,
  "product" | "reservationDate"
>;

export interface ICalendarDiscountProvider {
  readonly quote: (
    input: CalendarDiscountProviderInput
  ) => Effect.Effect<readonly DiscountCandidate[], DiscountProviderError>;
  readonly revalidate: (
    input: CalendarDiscountProviderInput
  ) => Effect.Effect<readonly DiscountCandidate[], DiscountProviderError>;
}

export class CalendarDiscountProvider extends Context.Service<
  CalendarDiscountProvider,
  ICalendarDiscountProvider
>()("@deskohub-workspace/discounts/CalendarDiscountProvider") {
  static Live = Layer.effect(
    this,
    Effect.gen(function* () {
      const calendar = yield* GoogleCalendarService;
      const { salesCalendarId } = yield* CalendarResourceConfig;

      const loadCalendarSales = Effect.fn(
        "CalendarDiscountProvider.loadCalendarSales"
      )(
        (key: CalendarSalesCacheKey) =>
          Effect.succeed(key).pipe(
            Effect.bind("events", ({ calendarId, reservationDate }) =>
              calendar
                .listEvents({
                  calendarId,
                  from: reservationDate,
                  to: reservationDate,
                })
                .pipe(
                  Effect.mapError(
                    (cause) =>
                      new DiscountProviderError({
                        reason: "provider_failure",
                        message: "Google Calendar sales could not be loaded.",
                        cause,
                      })
                  )
                )
            ),
            Effect.bind("sales", ({ calendarId, events, reservationDate }) =>
              normalizeCalendarSales({
                calendarId,
                events,
                reservationDate,
              }).pipe(
                Effect.tapError(logCalendarSaleConfigurationError),
                Effect.mapError(toMalformedConfigurationError)
              )
            ),
            Effect.map(({ sales }) => sales)
          ),
        (effect, key) =>
          effect.pipe(
            Effect.annotateLogs({
              calendarId: key.calendarId,
              reservationDate: key.reservationDate,
            }),
            Effect.tapError((cause) =>
              cause.reason === "provider_failure"
                ? Effect.logError("Calendar discount sales load failed", {
                    cause,
                  })
                : Effect.void
            )
          )
      );

      const salesCache = yield* Cache.makeWith(loadCalendarSales, {
        capacity: 512,
        timeToLive: (exit) =>
          Exit.isSuccess(exit) ? Duration.seconds(60) : Duration.zero,
      });

      const quote = Effect.fn("CalendarDiscountProvider.quote")(
        (input: CalendarDiscountProviderInput) =>
          Effect.succeed(input).pipe(
            Effect.let(
              "cacheKey",
              ({ reservationDate }) =>
                new CalendarSalesCacheKey({
                  calendarId: salesCalendarId,
                  reservationDate,
                })
            ),
            Effect.bind("sales", ({ cacheKey }) =>
              Cache.get(salesCache, cacheKey)
            ),
            Effect.let("candidates", toEligibleCalendarCandidates),
            Effect.map(({ candidates }) => candidates)
          ),
        withProviderAnnotations("quote")
      );

      const revalidate = Effect.fn("CalendarDiscountProvider.revalidate")(
        (input: CalendarDiscountProviderInput) =>
          Effect.succeed(input).pipe(
            Effect.let(
              "cacheKey",
              ({ reservationDate }) =>
                new CalendarSalesCacheKey({
                  calendarId: salesCalendarId,
                  reservationDate,
                })
            ),
            Effect.bind("sales", ({ cacheKey }) => loadCalendarSales(cacheKey)),
            Effect.let("candidates", toEligibleCalendarCandidates),
            Effect.map(({ candidates }) => candidates)
          ),
        withProviderAnnotations("revalidate")
      );

      return { quote, revalidate } satisfies ICalendarDiscountProvider;
    })
  );
}

class CalendarSalesCacheKey extends Data.Class<{
  readonly calendarId: string;
  readonly reservationDate: string;
}> {}

const toEligibleCalendarCandidates = (input: {
  readonly product: DiscountProductIdentity;
  readonly sales: readonly CalendarSale[];
}) =>
  input.sales
    .filter(({ products }) =>
      products.some((product) => isSameProduct(product, input.product))
    )
    .map(toCalendarDiscountCandidate)
    .toSorted((left, right) =>
      left.discount.id.localeCompare(right.discount.id)
    );

const toCalendarDiscountCandidate = (
  sale: CalendarSale
): DiscountCandidate => ({
  discount: {
    id: deriveOpaqueDiscountId({
      providerNamespace,
      providerReference: sale.occurrenceReference,
    }),
    label: sale.label,
    adjustment: {
      kind: "percentage",
      basisPoints: sale.basisPoints,
    },
    expiresAt: sale.expiresAt,
    countdownStartsAt: sale.countdownStartsAt,
  },
  provenance: {
    providerNamespace,
    providerReference: sale.occurrenceReference,
    details: {
      calendarId: sale.calendarId,
      eventReference: sale.eventReference,
      occurrenceDate: sale.occurrenceDate,
    },
  },
});

const isSameProduct = (
  left: DiscountProductIdentity,
  right: DiscountProductIdentity
) => left.kind === right.kind && left.tier === right.tier;

const toMalformedConfigurationError = (cause: CalendarSaleConfigurationError) =>
  new DiscountProviderError({
    reason: "malformed_configuration",
    message: "A marked Google Calendar sale is malformed.",
    cause,
  });

const logCalendarSaleConfigurationError = (
  cause: CalendarSaleConfigurationError
) =>
  Effect.logError("Calendar sale configuration is invalid", {
    reason: cause.reason,
    eventReference: cause.eventReference,
    cause,
  });

const withProviderAnnotations =
  (operation: "quote" | "revalidate") =>
  <A, E>(effect: Effect.Effect<A, E>, input: CalendarDiscountProviderInput) =>
    effect.pipe(
      Effect.annotateLogs({
        operation,
        reservationDate: input.reservationDate,
        product: input.product,
      })
    );
