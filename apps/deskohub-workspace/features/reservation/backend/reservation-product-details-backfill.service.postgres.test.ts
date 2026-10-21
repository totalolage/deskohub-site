import "@/shared/testing/workspace-test-env";

import { afterAll, describe, expect, test } from "bun:test";
import {
  DotyposCustomerIdSchema,
  type DotyposReservationId,
  DotyposReservationIdSchema,
  type DotyposService,
} from "@deskohub/dotypos";
import { DotyposServiceMock } from "@deskohub/dotypos/backend/service.mock";
import { inArray } from "drizzle-orm";
import { Effect, Layer } from "effect";
import { workspaceReservations } from "@/db/schema";
import { checkoutAttemptKeySchema } from "@/features/checkout/checkout-identifiers";
import { workspaceMeetingRoomCatalog } from "@/features/checkout/product-catalog";
import { getMeetingRoomReservationDurationKey } from "@/features/reservation/meeting-room-reservation-duration";
import { getMeetingRoomReservationInterval } from "@/features/reservation/meeting-room-reservation-time";
import {
  type StoredWorkspaceReservationDetails,
  type WorkspaceReservationId,
  workspaceReservationIdSchema,
} from "@/features/reservation/persistence-contracts";
import {
  connectWorkspacePostgresTestDatabase,
  fixtureReservationAuthorId,
} from "@/shared/testing/workspace-postgres-test-database.test-utils";
import {
  ReservationProductDetailsBackfill,
  type ReservationProductDetailsBackfillBatch,
} from "./reservation-product-details-backfill.service";

const testDatabase = await connectWorkspacePostgresTestDatabase();

type DotyposReservation = Effect.Success<
  ReturnType<DotyposService["Service"]["listReservations"]>
>[number];

describe.skipIf(!testDatabase)(
  "ReservationProductDetailsBackfill on disposable Postgres",
  () => {
    if (!testDatabase) return;
    const runId = crypto.randomUUID();
    const reservationId = (label: string) =>
      workspaceReservationIdSchema.make(`product-backfill-${label}-${runId}`);
    const dotyposId = (label: string) =>
      DotyposReservationIdSchema.make(`product-backfill-${label}-${runId}`);
    const insertedIds: WorkspaceReservationId[] = [];
    const dotyposReservations = new Map<
      DotyposReservationId,
      DotyposReservation
    >();
    const listedIds: DotyposReservationId[][] = [];

    const insert = async (input: {
      readonly label: string;
      readonly details: StoredWorkspaceReservationDetails;
      readonly dotypos: {
        readonly startDate: string;
        readonly endDate: string;
        readonly seats: string;
      } | null;
      readonly linked?: boolean;
    }) => {
      const id = reservationId(input.label);
      const linked = input.linked ?? true;
      insertedIds.push(id);
      if (input.dotypos && linked) {
        dotyposReservations.set(dotyposId(input.label), {
          id: dotyposId(input.label),
          _branchId: "branch",
          _cloudId: "cloud",
          status: "CONFIRMED",
          // A freeform note naming another product must never be read.
          note: "Meeting room 8 hours, 9 seats",
          ...input.dotypos,
        });
      }
      await Effect.runPromise(
        testDatabase.db.insert(workspaceReservations).values({
          authorAccountId: fixtureReservationAuthorId,
          id,
          checkoutAttemptKey: checkoutAttemptKeySchema.make(id),
          dotyposCustomerId: DotyposCustomerIdSchema.make(`customer-${runId}`),
          dotyposReservationId: input.dotypos ? dotyposId(input.label) : null,
          reservationState: input.dotypos ? "confirmed" : "hold_expired",
          paymentState: input.dotypos ? "paid" : "not_started",
          paidAt: input.dotypos
            ? Temporal.Instant.from("2001-01-01T00:00:00Z")
            : null,
          fulfillmentState: "not_started",
          reservationDetails: input.details,
          locale: "en-US",
          updatedAt: Temporal.Instant.from("2001-01-01T00:00:00Z"),
        })
      );
      return id;
    };

    afterAll(async () => {
      await testDatabase.pool.query(
        "delete from workspace_reservations where id = any($1)",
        [insertedIds]
      );
    });

    const dotypos = DotyposServiceMock({
      listReservations: (options) =>
        Effect.sync(() => {
          listedIds.push([...(options?.ids ?? [])]);
          return (options?.ids ?? []).flatMap((id) => {
            const reservation = dotyposReservations.get(id);
            return reservation ? [reservation] : [];
          });
        }),
    });

    /** Runs every batch, as `dhw` does, and keeps this suite's rows only. */
    const runBackfill = (dryRun: boolean) =>
      Effect.gen(function* () {
        const backfill = yield* ReservationProductDetailsBackfill;
        const batches: ReservationProductDetailsBackfillBatch[] = [];
        let after: WorkspaceReservationId | null = null;
        do {
          const batch: ReservationProductDetailsBackfillBatch =
            yield* backfill.runBatch({ after, dryRun });
          batches.push(batch);
          after = batch.nextCursor;
        } while (after !== null);
        return {
          updated: batches.reduce((sum, batch) => sum + batch.updated, 0),
          unresolved: batches
            .flatMap((batch) => batch.unresolved)
            .filter(({ reservationId }) => insertedIds.includes(reservationId)),
        };
      }).pipe(
        Effect.provide(
          ReservationProductDetailsBackfill.Default.pipe(
            Layer.provide(Layer.merge(testDatabase.layer, dotypos))
          )
        ),
        Effect.runPromise
      );

    const loadRows = async () => {
      const rows = await Effect.runPromise(
        testDatabase.db
          .select({
            id: workspaceReservations.id,
            reservationDetails: workspaceReservations.reservationDetails,
            updatedAt: workspaceReservations.updatedAt,
          })
          .from(workspaceReservations)
          .where(inArray(workspaceReservations.id, insertedIds))
      );
      return new Map(rows.map((row) => [row.id, row]));
    };

    test("fills meeting-room offers and office seats and days from Dotypos, once", async () => {
      const meetingRooms = await Promise.all(
        workspaceMeetingRoomCatalog.map(async ({ duration }) => {
          const interval = getMeetingRoomReservationInterval(
            "2026-03-10T10:00",
            duration
          );
          if (!interval) throw new Error("catalog interval missing");
          const id = await insert({
            label: `meeting-room-${getMeetingRoomReservationDurationKey(duration)}`,
            details: { kind: "meeting-room" },
            dotypos: {
              startDate: Temporal.Instant.from(interval.startsAt).toString(),
              endDate: Temporal.Instant.from(interval.endsAt).toString(),
              seats: "1",
            },
          });
          return { id, duration };
        })
      );
      const office = await insert({
        label: "office",
        details: { kind: "office" },
        dotypos: {
          startDate: "2026-03-10T00:00:00+01:00",
          endDate: "2026-03-13T00:00:00+01:00",
          seats: "4",
        },
      });
      const complete = await insert({
        label: "complete",
        details: { kind: "office", seats: 2, dayCount: 1 },
        dotypos: {
          startDate: "2026-03-10T00:00:00+01:00",
          endDate: "2026-03-11T00:00:00+01:00",
          seats: "7",
        },
      });
      const cowork = await insert({
        label: "cowork",
        details: { kind: "cowork", entryTier: "open-space", coffee: false },
        dotypos: {
          startDate: "2026-03-10T08:00:00+01:00",
          endDate: "2026-03-10T16:00:00+01:00",
          seats: "1",
        },
      });
      const offCatalog = await insert({
        label: "off-catalog",
        details: { kind: "meeting-room" },
        dotypos: {
          startDate: "2026-03-10T10:00:00+01:00",
          endDate: "2026-03-10T10:17:00+01:00",
          seats: "1",
        },
      });
      const partialDay = await insert({
        label: "partial-day",
        details: { kind: "office" },
        dotypos: {
          startDate: "2026-03-10T09:00:00+01:00",
          endDate: "2026-03-11T00:00:00+01:00",
          seats: "4",
        },
      });
      const badSeats = await insert({
        label: "bad-seats",
        details: { kind: "office" },
        dotypos: {
          startDate: "2026-03-10T00:00:00+01:00",
          endDate: "2026-03-11T00:00:00+01:00",
          seats: "many",
        },
      });
      const notInDotypos = await insert({
        label: "not-in-dotypos",
        details: { kind: "meeting-room" },
        dotypos: {
          startDate: "2026-03-10T10:00:00+01:00",
          endDate: "2026-03-10T12:00:00+01:00",
          seats: "1",
        },
        linked: false,
      });
      const withoutDotypos = await insert({
        label: "without-dotypos",
        details: { kind: "office" },
        dotypos: null,
      });
      const expectedUnresolved = [
        {
          reservationId: offCatalog,
          family: "meeting-room",
          reason: "interval_not_in_catalog",
        },
        {
          reservationId: partialDay,
          family: "office",
          reason: "interval_not_in_catalog",
        },
        {
          reservationId: badSeats,
          family: "office",
          reason: "dotypos_seats_invalid",
        },
        {
          reservationId: notInDotypos,
          family: "meeting-room",
          reason: "dotypos_reservation_not_found",
        },
        {
          reservationId: withoutDotypos,
          family: "office",
          reason: "dotypos_reservation_id_missing",
        },
      ];
      const sortById = <Row extends { readonly reservationId: string }>(
        rows: readonly Row[]
      ) =>
        [...rows].sort((left, right) =>
          left.reservationId.localeCompare(right.reservationId)
        );
      const before = await loadRows();

      const dryRun = await runBackfill(true);
      expect(dryRun.updated).toBe(meetingRooms.length + 1);
      expect(sortById(dryRun.unresolved)).toEqual(sortById(expectedUnresolved));
      expect(await loadRows()).toEqual(before);

      const run = await runBackfill(false);
      expect(run.updated).toBe(meetingRooms.length + 1);
      expect(sortById(run.unresolved)).toEqual(sortById(expectedUnresolved));
      // Complete rows aren't requested from Dotypos.
      expect(listedIds.flat()).not.toContain(dotyposId("complete"));
      expect(listedIds.flat()).not.toContain(dotyposId("cowork"));

      const after = await loadRows();
      for (const { id, duration } of meetingRooms) {
        expect(after.get(id)?.reservationDetails).toEqual({
          kind: "meeting-room",
          duration,
        });
      }
      expect(after.get(office)?.reservationDetails).toEqual({
        kind: "office",
        seats: 4,
        dayCount: 3,
      });
      for (const id of [
        complete,
        cowork,
        offCatalog,
        partialDay,
        badSeats,
        notInDotypos,
        withoutDotypos,
      ]) {
        expect(after.get(id)).toEqual(before.get(id));
      }
      for (const [id, row] of after) {
        expect(row.updatedAt).toEqual(before.get(id)?.updatedAt);
      }

      const rerun = await runBackfill(false);
      expect(rerun.updated).toBe(0);
      expect(sortById(rerun.unresolved)).toEqual(sortById(expectedUnresolved));
      expect(await loadRows()).toEqual(after);
    });
  }
);
