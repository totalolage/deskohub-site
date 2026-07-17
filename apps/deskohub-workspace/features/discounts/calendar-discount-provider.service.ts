import { GoogleCalendarService } from "@deskohub/google-calendar";
import { Cache, Context, Data, Duration, Effect, Exit, Layer } from "effect";
import type { WorkspaceCoworkProductIdentity } from "@/features/reservation/cowork-reservation";
import { CalendarResourceConfig } from "@/shared/backend/config/calendar-resource.config";
import {
  type CalendarSale,
  type CalendarSaleConfigurationError,
  normalizeCalendarSales,
} from "./calendar-sale";
import type { DiscountQuoteInput } from "./contracts";
import type { DiscountDefinition } from "./discount-definition";
import { DiscountDefinitionRepository } from "./discount-definition.repository";
import { toDiscountDefinitionProviderError } from "./discount-definition-provider-error";
import { DiscountProviderError } from "./errors";
import { deriveOpaqueDiscountId } from "./opaque-discount-id";
import type { DiscountCandidate } from "./provider";

const providerNamespace = "google-calendar-sales";

export type CalendarDiscountProviderInput = Pick<
  DiscountQuoteInput,
  "locale" | "product" | "reservationDate"
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
      const discountDefinitions = yield* DiscountDefinitionRepository;
      const { salesCalendarId } = yield* CalendarResourceConfig;

      const loadDiscountDefinitions = Effect.fn(
        "CalendarDiscountProvider.loadDiscountDefinitions"
      )((input: { readonly sales: readonly CalendarSale[] }) =>
        Effect.forEach(
          [...new Set(input.sales.map(({ discountId }) => discountId))],
          (discountId) =>
            discountDefinitions.loadById({ discountId }).pipe(
              Effect.tapError((cause) =>
                Effect.logError(
                  "Stored calendar discount definition could not be loaded",
                  { cause, discountId }
                )
              ),
              Effect.mapError(toDiscountDefinitionProviderError)
            )
        ).pipe(
          Effect.map(
            (definitions) =>
              new Map(
                definitions.map((definition) => [definition.id, definition])
              )
          )
        )
      );

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
            Effect.bind("definitions", loadDiscountDefinitions),
            Effect.map(({ definitions, sales }) =>
              sales.map((sale) => ({
                sale,
                definition: definitions.get(sale.discountId)!,
              }))
            )
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
  readonly locale: CalendarDiscountProviderInput["locale"];
  readonly product: WorkspaceCoworkProductIdentity;
  readonly sales: readonly ResolvedCalendarSale[];
}) =>
  input.sales
    .filter(({ definition }) =>
      definition.products.some((product) =>
        isSameProduct(product, input.product)
      )
    )
    .map((resolvedSale) =>
      toCalendarDiscountCandidate({
        locale: input.locale,
        resolvedSale,
      })
    )
    .toSorted((left, right) =>
      left.discount.id.localeCompare(right.discount.id)
    );

const toCalendarDiscountCandidate = (input: {
  readonly locale: CalendarDiscountProviderInput["locale"];
  readonly resolvedSale: ResolvedCalendarSale;
}): DiscountCandidate => ({
  discount: {
    id: deriveOpaqueDiscountId({
      providerNamespace,
      providerReference: input.resolvedSale.sale.occurrenceReference,
    }),
    label: input.resolvedSale.definition.labels[input.locale],
    adjustment: input.resolvedSale.definition.adjustment,
    expiresAt: input.resolvedSale.sale.expiresAt,
    countdownStartsAt: input.resolvedSale.sale.countdownStartsAt,
  },
  provenance: {
    providerNamespace,
    providerReference: input.resolvedSale.sale.occurrenceReference,
    details: {
      calendarId: input.resolvedSale.sale.calendarId,
      eventReference: input.resolvedSale.sale.eventReference,
      occurrenceDate: input.resolvedSale.sale.occurrenceDate,
      storedDiscountId: input.resolvedSale.definition.id,
    },
  },
});

type ResolvedCalendarSale = {
  readonly sale: CalendarSale;
  readonly definition: DiscountDefinition;
};

const isSameProduct = (
  left: WorkspaceCoworkProductIdentity,
  right: WorkspaceCoworkProductIdentity
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
