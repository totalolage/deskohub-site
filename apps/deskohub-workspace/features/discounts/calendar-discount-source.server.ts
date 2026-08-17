import "server-only";

import { GoogleCalendarService } from "@deskohub/google-calendar";
import { Effect, Layer, Option } from "effect";
import { cacheLife, cacheTag } from "next/cache";
import { WorkspaceDatabase } from "@/db/database.service";
import {
  CalendarResourceConfig,
  type SalesCalendarId,
} from "@/shared/backend/config/calendar-resource.config";
import { WorkspaceGoogleCalendarLayer } from "@/shared/backend/config/google-calendar.config";
import { runWorkspaceEffect } from "@/shared/backend/workspace-effect";
import { type CalendarSale, normalizeCalendarSales } from "./calendar-sale";
import type { DiscountDefinition } from "./discount-definition";
import { DiscountDefinitionRepository } from "./discount-definition.repository";
import { toDiscountDefinitionProviderError } from "./discount-definition-provider-error";
import { DiscountProviderError } from "./errors";
import { logDiscountResolutionFailure } from "./resolution-logging";

export const calendarDiscountSourceTag = "workspace-calendar-discounts";

export interface CalendarSalesSourceInput {
  readonly calendarId: SalesCalendarId;
  readonly reservationDate: string;
}

export interface ResolvedCalendarSale {
  readonly sale: CalendarSale;
  readonly definition: DiscountDefinition;
}

export interface CalendarSalesSourceResult {
  readonly sales: readonly ResolvedCalendarSale[];
  readonly complete: boolean;
}

const loadDiscountDefinitions = Effect.fn(
  "CalendarDiscountSource.loadDiscountDefinitions"
)((input: { readonly sales: readonly CalendarSale[] }) =>
  DiscountDefinitionRepository.pipe(
    Effect.flatMap((discountDefinitions) =>
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
              onSuccess: (definition) =>
                Effect.succeed({
                  definition: Option.some(definition),
                  failed: false,
                }),
            })
          )
      )
    ),
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

export const loadCalendarSalesSource = Effect.fn("CalendarDiscountSource.load")(
  function* (input: CalendarSalesSourceInput) {
    const calendar = yield* GoogleCalendarService;
    const events = yield* calendar
      .listEvents({
        calendarId: input.calendarId,
        from: input.reservationDate,
        to: input.reservationDate,
      })
      .pipe(
        Effect.mapError(
          DiscountProviderError.fromCause({
            reason: "provider_failure",
            message: "Google Calendar sales could not be loaded.",
          })
        )
      );
    const normalization = yield* normalizeCalendarSales({
      calendarId: input.calendarId,
      events,
      reservationDate: input.reservationDate,
    });
    const definitionResolution = yield* loadDiscountDefinitions({
      sales: normalization.sales,
    });

    return {
      sales: normalization.sales.flatMap((sale) => {
        const definition = definitionResolution.definitions.get(
          sale.discountId
        );

        return definition ? [{ sale, definition }] : [];
      }),
      complete: !normalization.hasFailures && !definitionResolution.hasFailures,
    } satisfies CalendarSalesSourceResult;
  }
);

const CalendarDiscountSourceLive = Layer.mergeAll(
  CalendarResourceConfig.Default,
  WorkspaceGoogleCalendarLayer,
  DiscountDefinitionRepository.Default.pipe(
    Layer.provide(WorkspaceDatabase.Default)
  )
);

export async function loadCalendarDiscountSource(
  reservationDate: string
): Promise<CalendarSalesSourceResult> {
  "use cache: remote";

  try {
    const source = await Effect.gen(function* () {
      const { salesCalendarId } = yield* CalendarResourceConfig;
      return yield* loadCalendarSalesSource({
        calendarId: salesCalendarId,
        reservationDate,
      });
    }).pipe(
      Effect.provide(CalendarDiscountSourceLive),
      runWorkspaceEffect("discounts.calendar-source.load")
    );

    if (source.complete) {
      cacheLife("advertisedPricingSources");
      cacheTag(calendarDiscountSourceTag);
    } else {
      cacheLife({ expire: 0 });
    }

    return source;
  } catch (cause) {
    cacheLife({ expire: 0 });
    throw cause;
  }
}
