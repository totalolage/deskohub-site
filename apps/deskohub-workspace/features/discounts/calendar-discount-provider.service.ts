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
} from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import {
  getWorkspaceProductKey,
  type WorkspaceProductIdentity,
} from "@/features/checkout/product-identity";
import { workspaceProductTargetMatches } from "@/features/discounts/product-target";
import { CalendarResourceConfig } from "@/shared/backend/config/calendar-resource.config";
import { WorkspaceGoogleCalendarLayer } from "@/shared/backend/config/google-calendar.config";
import {
  type CalendarSalesSourceInput,
  type CalendarSalesSourceResult,
  loadCalendarDiscountSource,
  loadCalendarSalesSource,
  type ResolvedCalendarSale,
} from "./calendar-discount-source.server";
import type {
  ActiveSale,
  ActiveSaleDiscoveryInput,
  DiscountQuoteInput,
} from "./contracts";
import { DiscountDefinitionRepository } from "./discount-definition.repository";
import { DiscountProviderError } from "./errors";
import { deriveOpaqueDiscountId } from "./opaque-discount-id";
import type { DiscountCandidate } from "./provider";

const providerNamespace = "google-calendar-sales";

export type CalendarDiscountProviderInput = Pick<
  DiscountQuoteInput,
  "locale" | "product" | "reservationDate"
>;

export interface ActiveSaleDiscoveryResult {
  readonly activeSales: readonly ActiveSale[];
  readonly complete: boolean;
}

export interface ICalendarDiscountProvider {
  readonly discoverActiveSales: (
    input: ActiveSaleDiscoveryInput
  ) => Effect.Effect<ActiveSaleDiscoveryResult, DiscountProviderError>;
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
  static Default = Layer.suspend(() =>
    makeCalendarDiscountProviderLayer(false)
  );

  static Live = Layer.suspend(() =>
    makeCalendarDiscountProviderLayer(true)
  ).pipe(
    Layer.provide(
      Layer.mergeAll(
        WorkspaceGoogleCalendarLayer,
        CalendarResourceConfig.Default,
        DiscountDefinitionRepository.Default.pipe(
          Layer.provide(WorkspaceDatabase.Default)
        )
      )
    )
  );
}

const loadRemoteCalendarSalesSource = Effect.fn(
  "CalendarDiscountSource.loadRemote"
)((input: CalendarSalesSourceInput) =>
  Effect.tryPromise({
    try: () => loadCalendarDiscountSource(input.reservationDate),
    catch: DiscountProviderError.fromCause({
      reason: "provider_failure",
      message: "Remote Calendar sales could not be loaded.",
    }),
  })
);

function makeCalendarDiscountProviderLayer(useRemoteDiscovery: boolean) {
  return Layer.effect(
    CalendarDiscountProvider,
    Effect.gen(function* () {
      const calendar = yield* GoogleCalendarService;
      const discountDefinitions = yield* DiscountDefinitionRepository;
      const { salesCalendarId } = yield* CalendarResourceConfig;
      const loadDirectCalendarSalesSource = (
        input: CalendarSalesSourceInput
      ): Effect.Effect<CalendarSalesSourceResult, DiscountProviderError> =>
        loadCalendarSalesSource(input).pipe(
          Effect.provideService(GoogleCalendarService, calendar),
          Effect.provideService(
            DiscountDefinitionRepository,
            discountDefinitions
          )
        );
      const loadDiscoverySales = useRemoteDiscovery
        ? loadRemoteCalendarSalesSource
        : yield* Cache.makeWith(loadDirectCalendarSalesSource, {
            capacity: 512,
            timeToLive: (exit) =>
              Exit.isSuccess(exit) && exit.value.complete
                ? Duration.seconds(60)
                : Duration.zero,
          }).pipe(
            Effect.map(
              (cache) => (input: CalendarSalesSourceInput) =>
                Cache.get(cache, new CalendarSalesCacheKey(input))
            )
          );

      const discover = Effect.fn("CalendarDiscountProvider.discover")(
        (input: CalendarDiscountProviderInput) =>
          Effect.succeed(input).pipe(
            Effect.let(
              "sourceInput",
              ({ reservationDate }) =>
                ({
                  calendarId: salesCalendarId,
                  reservationDate,
                }) satisfies CalendarSalesSourceInput
            ),
            Effect.bind("resolvedSales", ({ sourceInput }) =>
              loadDiscoverySales(sourceInput)
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
              "sourceInput",
              ({ currentDate }) =>
                ({
                  calendarId: salesCalendarId,
                  reservationDate: currentDate.toString(),
                }) satisfies CalendarSalesSourceInput
            ),
            Effect.bind("resolvedSales", ({ sourceInput }) =>
              loadDiscoverySales(sourceInput)
            ),
            Effect.bind("at", () =>
              Clock.currentTimeMillis.pipe(
                Effect.map(Temporal.Instant.fromEpochMilliseconds)
              )
            ),
            Effect.let("sales", ({ resolvedSales }) => resolvedSales.sales),
            Effect.map(({ resolvedSales, ...activeSalesInput }) => ({
              activeSales: toActiveCalendarSales(activeSalesInput),
              complete: resolvedSales.complete,
            }))
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
              "sourceInput",
              ({ reservationDate }) =>
                ({
                  calendarId: salesCalendarId,
                  reservationDate,
                }) satisfies CalendarSalesSourceInput
            ),
            Effect.bind("resolvedSales", ({ sourceInput }) =>
              loadDirectCalendarSalesSource(sourceInput)
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

class CalendarSalesCacheKey extends Data.Class<CalendarSalesSourceInput> {}

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
