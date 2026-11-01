import { seededReservationReads } from "@deskohub/dotypos/backend/service.mock";
import "@/shared/testing/workspace-test-env";

import { describe, expect, mock, test } from "bun:test";
import {
  type DotyposCustomerId,
  DotyposCustomerIdSchema,
  type DotyposReservation,
  DotyposReservationSchema,
  DotyposService,
} from "@deskohub/dotypos";
import { Effect, Layer, Schema } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import type { StoredWorkspaceReservationDetails } from "@/features/reservation/persistence-contracts";
import type { WorkspaceReservationKind } from "@/features/reservation/reservation-kind";
import { workspaceFixtures } from "@/shared/testing/workspace-fixtures.test-utils";
import { connectWorkspacePostgresTestDatabase } from "@/shared/testing/workspace-postgres-test-database.test-utils";
import { CustomerLastReservationService } from "./customer-last-reservation.service";

const testDatabase = await connectWorkspacePostgresTestDatabase();

const uniqueCustomerId = () =>
  DotyposCustomerIdSchema.make(
    `${Math.floor(Math.random() * 900000) + 100000}${Math.floor(
      Math.random() * 900
    )}`
  );
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

/**
 * Inserts a reservation, paid and confirmed unless `confirmed` is false, and
 * returns its Dotypos reservation id, which only a confirmed one has.
 */
const insertReservation = async ({
  dotyposCustomerId,
  reservationDetails,
  createdAt,
  confirmed = true,
}: {
  readonly dotyposCustomerId: DotyposCustomerId;
  readonly reservationDetails: StoredWorkspaceReservationDetails;
  readonly createdAt: string;
  readonly confirmed?: boolean;
}) => {
  const at = Temporal.Instant.from(createdAt);
  const reservation = await Effect.runPromise(
    workspaceFixtures(testDatabase!.db).reservation({
      stage: confirmed
        ? { reservation: "confirmed", payment: "paid" }
        : { reservation: "draft" },
      customer: dotyposCustomerId,
      details: reservationDetails,
      at,
      overrides: { createdAt: at },
    })
  );
  return reservation.dotyposReservationId!;
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
          WorkspaceDatabase.make(testDatabase!.db)
        ),
        Layer.mock(DotyposService, {
          getReservationsByIds: (ids) =>
            listReservations({ ids: [...ids] }).pipe(
              Effect.flatMap((records) =>
                seededReservationReads(records).getReservationsByIds(ids)
              )
            ),
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

    test("returns null when the latest reservation's stored details are malformed", async () => {
      const customerId = uniqueCustomerId();
      const dotyposReservationId = await insertReservation({
        dotyposCustomerId: customerId,
        reservationDetails: {
          kind: "cowork",
          entryTier: "open-space",
          coffee: true,
        },
        createdAt: "2026-07-01T09:00:00.000Z",
      });
      // Only a write outside the encoder could store this.
      await testDatabase!.pool.query(
        "update workspace_reservations set reservation_details = $1::jsonb where dotypos_reservation_id = $2",
        [
          JSON.stringify({ kind: "cowork", entryTier: "open-space" }),
          dotyposReservationId,
        ]
      );

      const { lastReservation } = await loadLastReservation(
        customerId,
        "cowork"
      );

      expect(lastReservation).toBeNull();
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

    test("maps a booked meeting-room interval to its duration", async () => {
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
            startDate: "2026-07-01T08:00:00.000Z",
            endDate: "2026-07-01T12:00:00.000Z",
          }),
        ]
      );

      expect(lastReservation).toEqual({
        kind: "meeting-room",
        duration: "hour:4",
      });
      expect(listReservations).toHaveBeenCalledWith({
        ids: [dotyposReservationId],
      });
    });

    test("returns null when a booked meeting-room end is unreadable", async () => {
      const customerId = uniqueCustomerId();
      const dotyposReservationId = await insertReservation({
        dotyposCustomerId: customerId,
        reservationDetails: { kind: "meeting-room" },
        createdAt: "2026-07-01T09:00:00.000Z",
      });
      const reservation = makeDotyposReservation({
        id: dotyposReservationId,
        startDate: "2026-07-01T08:00:00.000Z",
        endDate: "2026-07-01T12:00:00.000Z",
      });

      const { lastReservation } = await loadLastReservation(
        customerId,
        "meeting-room",
        [{ ...reservation, endDate: "not-a-date" }]
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

    // Any spelling JavaScript reads as a positive whole number counts.
    test.each([["4"], ["4.0"], ["4e0"]] as const)(
      "maps a booked office interval and seats %p to a day count and seats",
      async (seats) => {
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
              seats,
            }),
          ]
        );

        expect(lastReservation).toEqual({
          kind: "office",
          dayCount: 3,
          seats: 4,
        });
      }
    );

    test.each([
      ["non-numeric seats", "four", "2026-06-30T22:00:00.000Z"],
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
