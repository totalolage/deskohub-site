import {
  DotyposReservationIdSchema,
  DotyposService,
  type DotyposTable,
  DotyposTableIdSchema,
  DotyposTableSchema,
} from "@deskohub/dotypos";
import { Effect, Layer, Schema } from "effect";
import { TestClock } from "effect/testing";
import { CheckoutPricingService } from "@/features/checkout/backend/checkout/checkout-pricing.service";
import { workspaceMoneyWithValue } from "@/features/checkout/workspace-money";
import {
  type DiscountAdvertisementInput,
  discountAdvertisementQuoteCodec,
  discountIdSchema,
} from "@/features/discounts/contracts";
import { DiscountServiceMock } from "@/features/discounts/discount.service.mock";
import { OfficeReservationFeatureFlagService } from "@/features/office/backend/office-reservation-feature-flag.service";
import { AdvisoryAvailabilityInventory } from "@/features/reservation/backend/availability-inventory";
import { GoogleCalendarWorkspaceLimitationsService } from "@/features/reservation/backend/google-calendar-workspace-limitations.service";
import type { ReservationRecord } from "@/features/reservation/backend/reservation-record";
import { WorkspaceAvailabilityService } from "@/features/reservation/backend/workspace-availability.service";
import { WorkspaceReservationRepository } from "@/features/reservation/backend/workspace-reservation.repository";
import { getCurrentWorkspaceDate } from "@/features/reservation/reservation-date";
import { workspaceSiteConstants } from "@/shared/utils/site-constants";

const decodeTable = Schema.decodeSync(DotyposTableSchema);

const makeTestTable = (input: {
  readonly id: string;
  readonly tags: readonly string[];
  readonly seats?: string;
}): DotyposTable =>
  decodeTable({
    _cloudId: "cloud",
    display: true,
    enabled: true,
    name: input.id,
    seats: input.seats ?? "1",
    id: input.id,
    tags: [...input.tags],
  });

/** One Open Space desk, one Reserved Desk, the meeting room, and a 6-seat office. */
const agentToolTestTables: readonly DotyposTable[] = [
  makeTestTable({ id: "open-1", tags: ["tier:basic", "cowork:open-space"] }),
  makeTestTable({
    id: "desk-1",
    tags: [
      "tier:profi",
      "cowork:reserved-desk",
      "monitor:count:2",
      "monitor:size:27",
      "monitor:resolution:qhd",
    ],
  }),
  makeTestTable({ id: "room-1", tags: ["reservation:meeting-room"] }),
  makeTestTable({ id: "office-1", tags: ["reservation:office"], seats: "6" }),
];

/** A Prague date `days` after today, as YYYY-MM-DD. */
export const workspaceDateFromToday = (days: number) =>
  getCurrentWorkspaceDate().add({ days }).toString();

/** Today in Prague at a local wall-clock time such as `15:20`. */
export const workspaceInstantToday = (time: string) =>
  getCurrentWorkspaceDate()
    .toZonedDateTime({
      timeZone: workspaceSiteConstants.location.timeZone,
      plainTime: Temporal.PlainTime.from(time),
    })
    .toInstant();

/** Runs an Effect with the clock fixed at an instant. */
export const atInstant =
  (instant: Temporal.Instant) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    TestClock.setTime(instant.epochMilliseconds).pipe(
      Effect.andThen(effect),
      Effect.provide(TestClock.layer())
    );

/** A confirmed booking of a table for a whole Prague date. */
export const makeTestOccupancy = (input: {
  readonly tableId: string;
  readonly date: string;
}): ReservationRecord => {
  const { timeZone } = workspaceSiteConstants.location;
  const day = Temporal.PlainDate.from(input.date);

  return {
    id: DotyposReservationIdSchema.make(
      `booking-${input.tableId}-${input.date}`
    ),
    _tableId: DotyposTableIdSchema.make(input.tableId),
    status: "CONFIRMED",
    seats: "1",
    startDate: day.toZonedDateTime(timeZone).toInstant().toString(),
    endDate: day
      .add({ days: 1 })
      .toZonedDateTime(timeZone)
      .toInstant()
      .toString(),
  };
};

const saleDiscountId = Schema.decodeSync(discountIdSchema)("agent-sale");

/**
 * Advertised discounts as Calendar would discover them: none, or a
 * percentage sale on every product.
 */
const discoverTestDiscounts =
  (saleBasisPoints: number | undefined) =>
  ({ product, discountableSubtotal }: DiscountAdvertisementInput) => {
    const amount = saleBasisPoints
      ? Math.round((discountableSubtotal.value * saleBasisPoints) / 10_000)
      : 0;
    const after = workspaceMoneyWithValue(
      discountableSubtotal.value - amount,
      discountableSubtotal
    );

    return Effect.succeed({
      complete: true,
      quote: discountAdvertisementQuoteCodec.make({
        product,
        discountableSubtotal,
        discounts: amount
          ? [
              {
                discount: {
                  id: saleDiscountId,
                  label: "Agent sale",
                  adjustment: {
                    kind: "percentage",
                    basisPoints: saleBasisPoints ?? 0,
                  },
                },
                subtotalBefore: discountableSubtotal,
                amount: workspaceMoneyWithValue(amount, discountableSubtotal),
                subtotalAfter: after,
              },
            ]
          : [],
        totalDiscount: workspaceMoneyWithValue(amount, discountableSubtotal),
        discountedSubtotal: after,
      }),
    });
  };

/**
 * The services agent tools read through, with availability served only from
 * a fixed advisory snapshot. Dotypos is unreachable: every request it would
 * make is recorded in `dotyposRequests` and dies.
 */
export const makeAgentToolTestServices = ({
  tables = agentToolTestTables,
  occupancy = [],
  officeEnabled = true,
  saleBasisPoints,
}: {
  readonly tables?: readonly DotyposTable[];
  readonly occupancy?: readonly ReservationRecord[];
  readonly officeEnabled?: boolean;
  readonly saleBasisPoints?: number;
} = {}) => {
  const dotyposRequests: string[] = [];
  const snapshotReads: string[] = [];
  const unreachableDotypos = new Proxy(
    {},
    {
      get: (_target, operation) => () =>
        Effect.suspend(() => {
          dotyposRequests.push(String(operation));
          return Effect.die(
            new Error(`Agent tools must not call Dotypos ${String(operation)}`)
          );
        }),
    }
  ) as DotyposService["Service"];
  const advisoryInventory = Layer.succeed(AdvisoryAvailabilityInventory, {
    tables: Effect.sync(() => {
      snapshotReads.push("tables");
      return tables;
    }),
    listActiveReservationsOverlapping: () =>
      Effect.sync(() => {
        snapshotReads.push("reservations");
        return occupancy;
      }),
    listLimitations: () =>
      Effect.sync(() => {
        snapshotReads.push("limitations");
        return [];
      }),
  });
  const officeFlag = Layer.succeed(OfficeReservationFeatureFlagService, {
    isEnabled: Effect.succeed(officeEnabled),
  });

  const layer = Layer.mergeAll(
    WorkspaceAvailabilityService.Default.pipe(
      Layer.provide(
        Layer.mergeAll(
          advisoryInventory,
          Layer.succeed(DotyposService, unreachableDotypos),
          Layer.succeed(GoogleCalendarWorkspaceLimitationsService, {
            listLimitations: () => Effect.succeed([]),
          }),
          Layer.succeed(WorkspaceReservationRepository, {
            selectExpiredHoldDotyposReservationIds: () => Effect.succeed([]),
          } as never)
        )
      )
    ),
    advisoryInventory,
    CheckoutPricingService.Default.pipe(
      Layer.provide(
        DiscountServiceMock({
          discoverAdvertisedDiscounts: discoverTestDiscounts(saleBasisPoints),
        })
      )
    ),
    officeFlag
  );

  return { layer, dotyposRequests, snapshotReads };
};
