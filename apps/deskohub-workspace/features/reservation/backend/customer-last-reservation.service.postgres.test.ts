import "@/shared/testing/workspace-test-env";

import { describe, expect, mock, test } from "bun:test";
import {
  type DotyposCustomerId,
  DotyposCustomerIdSchema,
  type DotyposReservation,
  type DotyposReservationId,
  DotyposReservationIdSchema,
  DotyposReservationSchema,
  DotyposService,
} from "@deskohub/dotypos";
import { Effect, Layer, Schema } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import { workspaceReservations } from "@/db/schema";
import { checkoutAttemptKeySchema } from "@/features/checkout/checkout-identifiers";
import type { StoredWorkspaceReservationDetails } from "@/features/reservation/persistence-contracts";
import type { WorkspaceReservationKind } from "@/features/reservation/reservation-kind";
import { connectWorkspacePostgresTestDatabase } from "@/shared/testing/workspace-postgres-test-database.test-utils";
import { CustomerLastReservationService } from "./customer-last-reservation.service";

const testDatabase = await connectWorkspacePostgresTestDatabase();

const uniqueId = () => crypto.randomUUID();
const uniqueCustomerId = () =>
  DotyposCustomerIdSchema.make(
    `${Math.floor(Math.random() * 900000) + 100000}${Math.floor(
      Math.random() * 900
    )}`
  );
const uniqueDotyposReservationId = () =>
  DotyposReservationIdSchema.make(`dotypos-${uniqueId()}`);

const makeDotyposReservation = (
  overrides: Partial<DotyposReservation> = {}
): DotyposReservation =>
  Schema.decodeUnknownSync(DotyposReservationSchema)({
    _branchId: "branch",
    _cloudId: "cloud",
    startDate: "2026-07-01T08:00:00.000Z",
    endDate: "2026-07-01T12:00:00.000Z",
    seats: "1",
    status: "CONFIRMED",
    ...overrides,
  });

const insertReservation = async (input: {
  readonly dotyposCustomerId: DotyposCustomerId;
  readonly reservationDetails: StoredWorkspaceReservationDetails;
  readonly createdAt: string;
  readonly confirmed?: boolean;
  readonly dotyposReservationId?: DotyposReservationId;
}) => {
  const confirmed = input.confirmed ?? true;
  const dotyposReservationId =
    input.dotyposReservationId ?? uniqueDotyposReservationId();
  await Effect.runPromise(
    testDatabase!.db.insert(workspaceReservations).values({
      checkoutAttemptKey: checkoutAttemptKeySchema.make(
        `attempt-${uniqueId()}`
      ),
      dotyposCustomerId: input.dotyposCustomerId,
      dotyposReservationId: confirmed ? dotyposReservationId : null,
      reservationState: confirmed ? "confirmed" : "draft",
      paymentState: confirmed ? "paid" : "not_started",
      paidAt: confirmed ? Temporal.Instant.from(input.createdAt) : null,
      fulfillmentState: "not_started",
      reservationConfirmedAt: confirmed
        ? Temporal.Instant.from(input.createdAt)
        : null,
      reservationDetails: input.reservationDetails,
      locale: "en-US",
      createdAt: Temporal.Instant.from(input.createdAt),
    })
  );
  return dotyposReservationId;
};

const loadLastReservation = async (
  dotyposCustomerId: DotyposCustomerId,
  kind: WorkspaceReservationKind,
  dotyposReservations: readonly DotyposReservation[] = []
) => {
  const listReservations = mock(
    ({ ids }: { readonly ids: readonly string[] }) =>
      Effect.succeed(
        dotyposReservations.filter(
          (reservation) => reservation.id && ids.includes(reservation.id)
        )
      )
  );
  const layer = CustomerLastReservationService.Default.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.succeed(
          WorkspaceDatabase,
          WorkspaceDatabase.of({ db: testDatabase!.db })
        ),
        Layer.mock(DotyposService, {
          listReservations,
        } as Partial<DotyposService["Service"]>)
      )
    )
  );

  const lastReservation = await Effect.gen(function* () {
    const service = yield* CustomerLastReservationService;
    return yield* service.load(dotyposCustomerId, kind);
  }).pipe(Effect.provide(layer), Effect.runPromise);

  return { lastReservation, listReservations };
};

describe.skipIf(!testDatabase)(
  "CustomerLastReservationService on disposable Postgres",
  () => {
    test("returns null when the customer has no confirmed reservation of the family", async () => {
      const customerId = uniqueCustomerId();
      const otherCustomerId = uniqueCustomerId();
      await insertReservation({
        dotyposCustomerId: customerId,
        reservationDetails: {
          kind: "cowork",
          entryTier: "open-space",
          coffee: true,
        },
        createdAt: "2026-07-01T09:00:00.000Z",
        confirmed: false,
      });
      await insertReservation({
        dotyposCustomerId: customerId,
        reservationDetails: { kind: "office" },
        createdAt: "2026-07-02T09:00:00.000Z",
      });
      await insertReservation({
        dotyposCustomerId: otherCustomerId,
        reservationDetails: {
          kind: "cowork",
          entryTier: "open-space",
          coffee: false,
        },
        createdAt: "2026-07-03T09:00:00.000Z",
      });

      const { lastReservation, listReservations } = await loadLastReservation(
        customerId,
        "cowork"
      );

      expect(lastReservation).toBeNull();
      expect(listReservations).not.toHaveBeenCalled();
    });

    test("repeats the latest confirmed current cowork tier with its monitor option", async () => {
      const customerId = uniqueCustomerId();
      await insertReservation({
        dotyposCustomerId: customerId,
        reservationDetails: {
          kind: "cowork",
          entryTier: "open-space",
          coffee: false,
        },
        createdAt: "2026-07-01T09:00:00.000Z",
      });
      await insertReservation({
        dotyposCustomerId: customerId,
        reservationDetails: {
          kind: "cowork",
          entryTier: "reserved-desk",
          coffee: true,
          monitorOption: "2x27-4k",
        },
        createdAt: "2026-07-02T09:00:00.000Z",
      });
      await insertReservation({
        dotyposCustomerId: customerId,
        reservationDetails: {
          kind: "cowork",
          entryTier: "open-space",
          coffee: true,
        },
        createdAt: "2026-07-03T09:00:00.000Z",
        confirmed: false,
      });

      const { lastReservation, listReservations } = await loadLastReservation(
        customerId,
        "cowork"
      );

      expect(lastReservation).toEqual({
        kind: "cowork",
        entryTier: "reserved-desk",
        coffee: true,
        monitorOption: "2x27-4k",
      });
      expect(listReservations).not.toHaveBeenCalled();
    });

    test("omits the monitor option for a cowork tier booked without one", async () => {
      const customerId = uniqueCustomerId();
      await insertReservation({
        dotyposCustomerId: customerId,
        reservationDetails: {
          kind: "cowork",
          entryTier: "open-space",
          coffee: true,
        },
        createdAt: "2026-07-01T09:00:00.000Z",
      });

      const { lastReservation } = await loadLastReservation(
        customerId,
        "cowork"
      );

      expect(lastReservation).toEqual({
        kind: "cowork",
        entryTier: "open-space",
        coffee: true,
      });
      expect(lastReservation && "monitorOption" in lastReservation).toBe(false);
    });

    test("returns null when the latest cowork reservation used a retired tier", async () => {
      const customerId = uniqueCustomerId();
      await insertReservation({
        dotyposCustomerId: customerId,
        reservationDetails: {
          kind: "cowork",
          entryTier: "open-space",
          coffee: false,
        },
        createdAt: "2026-07-01T09:00:00.000Z",
      });
      await insertReservation({
        dotyposCustomerId: customerId,
        reservationDetails: {
          kind: "cowork",
          entryTier: "profi",
          coffee: true,
          monitorOption: "2x27-qhd",
        },
        createdAt: "2026-07-02T09:00:00.000Z",
      });

      const { lastReservation } = await loadLastReservation(
        customerId,
        "cowork"
      );

      expect(lastReservation).toBeNull();
    });

    test.each([
      [
        "hour:1",
        "2026-07-01T08:00:00.000Z",
        "2026-07-01T09:00:00.000Z",
      ] as const,
      [
        "hour:4",
        "2026-07-01T08:00:00.000Z",
        "2026-07-01T12:00:00.000Z",
      ] as const,
      [
        "day:1",
        // Prague midnight to midnight in summer time.
        "2026-06-30T22:00:00.000Z",
        "2026-07-01T22:00:00.000Z",
      ] as const,
    ])(
      "maps a booked meeting-room interval to the %s duration",
      async (duration, startDate, endDate) => {
        const customerId = uniqueCustomerId();
        const dotyposReservationId = await insertReservation({
          dotyposCustomerId: customerId,
          reservationDetails: { kind: "meeting-room" },
          createdAt: "2026-07-01T09:00:00.000Z",
        });

        const { lastReservation, listReservations } = await loadLastReservation(
          customerId,
          "meeting-room",
          [
            makeDotyposReservation({
              id: dotyposReservationId,
              startDate,
              endDate,
            }),
          ]
        );

        expect(lastReservation).toEqual({ kind: "meeting-room", duration });
        expect(listReservations).toHaveBeenCalledWith({
          ids: [dotyposReservationId],
        });
      }
    );

    test("returns null for a meeting-room interval that matches no purchasable duration", async () => {
      const customerId = uniqueCustomerId();
      const dotyposReservationId = await insertReservation({
        dotyposCustomerId: customerId,
        reservationDetails: { kind: "meeting-room" },
        createdAt: "2026-07-01T09:00:00.000Z",
      });

      const { lastReservation } = await loadLastReservation(
        customerId,
        "meeting-room",
        [
          makeDotyposReservation({
            id: dotyposReservationId,
            startDate: "2026-07-01T08:00:00.000Z",
            endDate: "2026-07-01T10:00:00.000Z",
          }),
        ]
      );

      expect(lastReservation).toBeNull();
    });

    test("returns null when Dotypos no longer lists the booked meeting room", async () => {
      const customerId = uniqueCustomerId();
      await insertReservation({
        dotyposCustomerId: customerId,
        reservationDetails: { kind: "meeting-room" },
        createdAt: "2026-07-01T09:00:00.000Z",
      });

      const { lastReservation, listReservations } = await loadLastReservation(
        customerId,
        "meeting-room"
      );

      expect(lastReservation).toBeNull();
      expect(listReservations).toHaveBeenCalledTimes(1);
    });

    test("maps a booked office interval and seats to a day count and seats", async () => {
      const customerId = uniqueCustomerId();
      const dotyposReservationId = await insertReservation({
        dotyposCustomerId: customerId,
        reservationDetails: { kind: "office" },
        createdAt: "2026-07-01T09:00:00.000Z",
      });

      const { lastReservation } = await loadLastReservation(
        customerId,
        "office",
        [
          makeDotyposReservation({
            id: dotyposReservationId,
            // Prague midnight on 1 July to midnight on 4 July.
            startDate: "2026-06-30T22:00:00.000Z",
            endDate: "2026-07-03T22:00:00.000Z",
            seats: "4",
          }),
        ]
      );

      expect(lastReservation).toEqual({
        kind: "office",
        dayCount: 3,
        seats: 4,
      });
    });

    test.each([
      ["non-numeric seats", "four", "2026-06-30T22:00:00.000Z"],
      ["fractional seats", "2.5", "2026-06-30T22:00:00.000Z"],
      ["zero seats", "0", "2026-06-30T22:00:00.000Z"],
      ["an interval off the calendar day", "4", "2026-07-01T08:00:00.000Z"],
    ] as const)(
      "returns null for an office reservation with %s",
      async (_label, seats, startDate) => {
        const customerId = uniqueCustomerId();
        const dotyposReservationId = await insertReservation({
          dotyposCustomerId: customerId,
          reservationDetails: { kind: "office" },
          createdAt: "2026-07-01T09:00:00.000Z",
        });

        const { lastReservation } = await loadLastReservation(
          customerId,
          "office",
          [
            makeDotyposReservation({
              id: dotyposReservationId,
              startDate,
              endDate: "2026-07-03T22:00:00.000Z",
              seats,
            }),
          ]
        );

        expect(lastReservation).toBeNull();
      }
    );
  }
);
