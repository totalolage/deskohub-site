import { GoogleCalendarEventIdSchema } from "@deskohub/google-calendar";
import { GoogleCalendarServiceMock } from "@deskohub/google-calendar/backend/service.mock";
import { Effect, Layer } from "effect";
import { CalendarDiscountProvider } from "@/features/discounts/calendar-discount-provider.service";
import { CustomerDiscountProviderMock } from "@/features/discounts/customer-discount-provider.service.mock";
import { DiscountService } from "@/features/discounts/discount.service";
import type { DiscountDefinition } from "@/features/discounts/discount-definition";
import { DiscountDefinitionRepositoryMock } from "@/features/discounts/discount-definition.repository.mock";
import { DiscountReleaseGateServiceMock } from "@/features/discounts/discount-release-gate.service.mock";
import { storedDiscountIdSchema } from "@/features/discounts/persistence-contracts";
import { PromotionCodeProviderMock } from "@/features/discounts/promotion-code-provider.service.mock";
import {
  CalendarResourceConfig,
  salesCalendarIdSchema,
  workspaceLimitationsCalendarIdSchema,
} from "@/shared/backend/config/calendar-resource.config";

const calendarSaleDiscountId = storedDiscountIdSchema.make(
  "019bfe6e-8ef0-7def-8b16-55cfbc82edc1"
);

/**
 * Real discount service and calendar provider over one synthetic all-day sale
 * running from `firstDay` through `lastDay`, with every discount family
 * released and no customer or code discounts. `calendarId` keeps provider
 * caches isolated between suites.
 */
export const calendarSaleDiscountServiceLayer = (input: {
  readonly calendarId: string;
  readonly firstDay: Temporal.PlainDate;
  readonly lastDay: Temporal.PlainDate;
  readonly labels: DiscountDefinition["labels"];
  readonly products: DiscountDefinition["products"];
}) =>
  DiscountService.Default.pipe(
    Layer.provide(
      Layer.mergeAll(
        CalendarDiscountProvider.Default.pipe(
          Layer.provide(
            Layer.mergeAll(
              GoogleCalendarServiceMock({
                listEvents: () =>
                  Effect.succeed([
                    {
                      id: GoogleCalendarEventIdSchema.make(
                        `${input.calendarId}-sale`
                      ),
                      summary: "Synthetic calendar sale",
                      description: calendarSaleDiscountId,
                      start: { date: input.firstDay.toString() },
                      end: { date: input.lastDay.add({ days: 1 }).toString() },
                    },
                  ]),
              }),
              DiscountDefinitionRepositoryMock({
                loadById: ({ discountId }) =>
                  Effect.succeed({
                    id: discountId,
                    labels: input.labels,
                    adjustment: { kind: "percentage", basisPoints: 2000 },
                    products: input.products,
                  }),
              }),
              Layer.succeed(CalendarResourceConfig, {
                salesCalendarId: salesCalendarIdSchema.make(
                  `${input.calendarId}-sales`
                ),
                workspaceLimitationsCalendarId:
                  workspaceLimitationsCalendarIdSchema.make(
                    `${input.calendarId}-limitations`
                  ),
              })
            )
          )
        ),
        CustomerDiscountProviderMock({ resolve: () => Effect.succeed([]) }),
        PromotionCodeProviderMock({ revalidate: () => Effect.succeed([]) }),
        DiscountReleaseGateServiceMock({
          evaluate: () =>
            Effect.succeed({
              calendarSales: true,
              customerDiscounts: true,
              discountCodes: true,
            }),
        })
      )
    )
  );
