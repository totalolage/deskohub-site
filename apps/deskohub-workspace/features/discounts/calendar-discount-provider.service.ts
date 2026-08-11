import { GoogleCalendarService } from "@deskohub/google-calendar";
import {
  Cache,
  Clock,
  Context,
  Data,
  Duration,
  Effect,
  Exit,
  Layer,
  Option,
} from "effect";
import {
  getWorkspaceProductKey,
  type WorkspaceProductIdentity,
} from "@/features/checkout/product-identity";
import { workspaceProductTargetMatches } from "@/features/discounts/product-target";
import { CalendarResourceConfig } from "@/shared/backend/config/calendar-resource.config";
import { type CalendarSale, normalizeCalendarSales } from "./calendar-sale";
import type {
  ActiveSale,
  ActiveSaleDiscoveryInput,
  DiscountQuoteInput,
} from "./contracts";
import type { DiscountDefinition } from "./discount-definition";
import { DiscountDefinitionRepository } from "./discount-definition.repository";
import { toDiscountDefinitionProviderError } from "./discount-definition-provider-error";
import { DiscountProviderError } from "./errors";
import { deriveOpaqueDiscountId } from "./opaque-discount-id";
import type { DiscountCandidate } from "./provider";
import { logDiscountResolutionFailure } from "./resolution-logging";

const providerNamespace = "google-calendar-sales";

export type CalendarDiscountProviderInput = Pick<
  DiscountQuoteInput,
  "locale" | "product" | "reservationDate"
>;

export interface ICalendarDiscountProvider {
  readonly discoverActiveSales: (
    input: ActiveSaleDiscoveryInput
  ) => Effect.Effect<readonly ActiveSale[], DiscountProviderError>;
  readonly discover: (
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
              Effect.mapError(toDiscountDefinitionProviderError),
              Effect.matchEffect({
                onFailure: (cause) =>
                  logDiscountResolutionFailure({
                    cause,
                    operation: "load_definition",
                    provider: "calendar",
                  }).pipe(
                    Effect.as({
                      definition: Option.none<DiscountDefinition>(),
                      failed: true,
                    })
                  ),
                onSuccess: (loadedDefinition) =>
                  Effect.succeed({
                    definition: Option.some(loadedDefinition),
                    failed: false,
                  }),
              })
            )
        ).pipe(
          Effect.map((results) => ({
            definitions: new Map(
              results
                .map(({ definition }) => definition)
                .filter(Option.isSome)
                .map(({ value }) => [value.id, value])
            ),
            hasFailures: results.some(({ failed }) => failed),
          }))
        )
      );

      const loadCalendarSales = Effect.fn(
        "CalendarDiscountProvider.loadCalendarSales"
      )((key: CalendarSalesCacheKey) =>
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
                  DiscountProviderError.fromCause({
                    reason: "provider_failure",
                    message: "Google Calendar sales could not be loaded.",
                  })
                )
              )
          ),
          Effect.bind(
            "normalization",
            ({ calendarId, events, reservationDate }) =>
              normalizeCalendarSales({
                calendarId,
                events,
                reservationDate,
              })
          ),
          Effect.bind("definitionResolution", ({ normalization }) =>
            loadDiscountDefinitions({ sales: normalization.sales })
          ),
          Effect.map(({ definitionResolution, normalization }) => ({
            sales: normalization.sales.flatMap((sale) => {
              const definition = definitionResolution.definitions.get(
                sale.discountId
              );

              return definition ? [{ sale, definition }] : [];
            }),
            cacheable:
              !normalization.hasFailures && !definitionResolution.hasFailures,
          }))
        )
      );

      const salesCache = yield* Cache.makeWith(loadCalendarSales, {
        capacity: 512,
        timeToLive: (exit) =>
          Exit.isSuccess(exit) && exit.value.cacheable
            ? Duration.seconds(60)
            : Duration.zero,
      });

      const discover = Effect.fn("CalendarDiscountProvider.discover")(
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
            Effect.bind("resolvedSales", ({ cacheKey }) =>
              Cache.get(salesCache, cacheKey)
            ),
            Effect.bind("at", () =>
              Clock.currentTimeMillis.pipe(
                Effect.map(Temporal.Instant.fromEpochMilliseconds)
              )
            ),
            Effect.let("sales", ({ resolvedSales }) => resolvedSales.sales),
            Effect.let("candidates", toEligibleCalendarCandidates),
            Effect.map(({ candidates }) => candidates)
          ),
        withProviderAnnotations("discover")
      );

      const discoverActiveSales = Effect.fn(
        "CalendarDiscountProvider.discoverActiveSales"
      )(
        (input: ActiveSaleDiscoveryInput) =>
          Effect.succeed(input).pipe(
            Effect.let(
              "cacheKey",
              ({ currentDate }) =>
                new CalendarSalesCacheKey({
                  calendarId: salesCalendarId,
                  reservationDate: currentDate.toString(),
                })
            ),
            Effect.bind("resolvedSales", ({ cacheKey }) =>
              Cache.get(salesCache, cacheKey)
            ),
            Effect.bind("at", () =>
              Clock.currentTimeMillis.pipe(
                Effect.map(Temporal.Instant.fromEpochMilliseconds)
              )
            ),
            Effect.let("sales", ({ resolvedSales }) => resolvedSales.sales),
            Effect.map(toActiveCalendarSales)
          ),
        (effect) =>
          effect.pipe(
            Effect.annotateLogs({
              discountOperation: "discover_active_sales",
            })
          )
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
            Effect.bind("resolvedSales", ({ cacheKey }) =>
              loadCalendarSales(cacheKey)
            ),
            Effect.bind("at", () =>
              Clock.currentTimeMillis.pipe(
                Effect.map(Temporal.Instant.fromEpochMilliseconds)
              )
            ),
            Effect.let("sales", ({ resolvedSales }) => resolvedSales.sales),
            Effect.let("candidates", toEligibleCalendarCandidates),
            Effect.map(({ candidates }) => candidates)
          ),
        withProviderAnnotations("revalidate")
      );

      return {
        discoverActiveSales,
        discover,
        revalidate,
      } satisfies ICalendarDiscountProvider;
    })
  );
}

class CalendarSalesCacheKey extends Data.Class<{
  readonly calendarId: string;
  readonly reservationDate: string;
}> {}

const toEligibleCalendarCandidates = (input: {
  readonly at: Temporal.Instant;
  readonly locale: CalendarDiscountProviderInput["locale"];
  readonly product: WorkspaceProductIdentity;
  readonly sales: readonly ResolvedCalendarSale[];
}) =>
  input.sales
    .filter(
      ({ sale }) => Temporal.Instant.compare(input.at, sale.expiresAt) < 0
    )
    .filter(({ definition }) =>
      definition.products.some((product) =>
        workspaceProductTargetMatches(product, input.product)
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

const toActiveCalendarSales = (input: {
  readonly at: Temporal.Instant;
  readonly locale: ActiveSaleDiscoveryInput["locale"];
  readonly sales: readonly ResolvedCalendarSale[];
}): readonly ActiveSale[] =>
  input.sales
    .filter(
      ({ sale }) => Temporal.Instant.compare(input.at, sale.expiresAt) < 0
    )
    .map((resolvedSale) => ({
      discount: toCalendarDiscountCandidate({
        locale: input.locale,
        resolvedSale,
      }).discount,
      products: resolvedSale.definition.products,
    }))
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

const withProviderAnnotations =
  (operation: "discover" | "revalidate") =>
  <A, E>(effect: Effect.Effect<A, E>, input: CalendarDiscountProviderInput) =>
    effect.pipe(
      Effect.annotateLogs({
        discountOperation: operation,
        discountProductKind: input.product.kind,
        discountProductKey: getWorkspaceProductKey(input.product),
      })
    );
