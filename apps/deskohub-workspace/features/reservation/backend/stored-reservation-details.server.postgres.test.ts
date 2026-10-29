import "@/shared/testing/workspace-test-env";

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { DotyposCustomerIdSchema } from "@deskohub/dotypos";
import { asc, eq, type SQL, sql } from "drizzle-orm";
import { Effect } from "effect";
import { workspaceReservations } from "@/db/schema";
import type { WorkspaceReservationId } from "@/features/reservation/persistence-contracts";
import { workspaceFixtures } from "@/shared/testing/workspace-fixtures.test-utils";
import { connectWorkspacePostgresTestDatabase } from "@/shared/testing/workspace-postgres-test-database.test-utils";
import { StoredReservationDetails } from "./stored-reservation-details.server";

const testDatabase = await connectWorkspacePostgresTestDatabase();

const customerId = DotyposCustomerIdSchema.make(
  `stored-details-${crypto.randomUUID()}`
);

/** Documents as stored, malformed ones included, by label. */
const documents = {
  cowork: {
    kind: "cowork",
    entryTier: "reserved-desk",
    coffee: true,
    monitorOption: "2x27-4k",
  },
  meetingRoom: {
    kind: "meeting-room",
    duration: { unit: "hour", amount: 4 },
    earlySetup: true,
  },
  office: { kind: "office", seats: 6, dayCount: 2 },
  unresolvedOffice: { kind: "office" },
  unknownKind: { kind: "boat", seats: 2 },
  textValues: {
    kind: "office",
    seats: "six",
    dayCount: "2",
    coffee: "yes",
  },
  fractionalValues: { kind: "office", seats: 2.5, dayCount: 1e12 },
  largeValues: { kind: "office", seats: 2147483647, dayCount: 2147483648 },
  nonTextValues: {
    kind: "cowork",
    entryTier: {},
    monitorOption: 5,
    duration: { unit: "hour", amount: "4" },
  },
  stringCoffee: { kind: "cowork", entryTier: "open-space", coffee: "true" },
  scalar: "cowork",
  array: [{ kind: "office", seats: 2 }],
} as const;
type Label = keyof typeof documents;

describe.skipIf(!testDatabase)(
  "stored reservation details accessors on disposable Postgres",
  () => {
    if (!testDatabase) return;
    const labels = new Map<WorkspaceReservationId, Label>();

    beforeAll(async () => {
      for (const label of Object.keys(documents) as Label[]) {
        const { id } = await Effect.runPromise(
          workspaceFixtures(testDatabase.db).reservation({
            stage: {
              reservation: "confirmed",
              payment: "paid",
              fulfillment: "fulfilled",
            },
            customer: customerId,
          })
        );
        // Malformed documents only reach the table outside the encoder.
        await testDatabase.pool.query(
          "update workspace_reservations set reservation_details = $1::jsonb where id = $2",
          [JSON.stringify(documents[label]), id]
        );
        labels.set(id, label);
      }
    });

    afterAll(async () => {
      await testDatabase.pool.query(
        "delete from workspace_reservations where dotypos_customer_id = $1",
        [customerId]
      );
    });

    const read = <Value>(value: SQL<Value>) =>
      Effect.runPromise(
        testDatabase.db
          .select({ id: workspaceReservations.id, value })
          .from(workspaceReservations)
          .where(eq(workspaceReservations.dotyposCustomerId, customerId))
          .orderBy(asc(workspaceReservations.createdAt))
      ).then((rows) =>
        Object.fromEntries(rows.map(({ id, value }) => [labels.get(id), value]))
      );

    test("reads each family, and null for a document that names none", async () => {
      expect(await read(StoredReservationDetails.kind)).toEqual({
        cowork: "cowork",
        meetingRoom: "meeting-room",
        office: "office",
        unresolvedOffice: "office",
        unknownKind: null,
        textValues: "office",
        fractionalValues: "office",
        largeValues: "office",
        nonTextValues: "cowork",
        stringCoffee: "cowork",
        scalar: null,
        array: null,
      });
    });

    test("reads catalog properties, and null where a value is missing or malformed", async () => {
      const properties = await Promise.all([
        read(StoredReservationDetails.property("cowork", "tier")),
        read(StoredReservationDetails.property("cowork", "coffee")),
        read(StoredReservationDetails.property("cowork", "monitor")),
        read(StoredReservationDetails.property("meeting-room", "offer")),
        read(StoredReservationDetails.property("office", "seats")),
        read(StoredReservationDetails.property("office", "days")),
      ]);
      const none = [null, null, null, null, null, null];

      expect(
        Object.fromEntries(
          (Object.keys(documents) as Label[]).map((label) => [
            label,
            properties.map((values) => values[label]),
          ])
        )
      ).toEqual({
        cowork: ["reserved-desk", true, "2x27-4k", null, null, null],
        meetingRoom: [null, null, null, "hour:4", null, null],
        office: [null, null, null, null, 6, 2],
        unresolvedOffice: none,
        // A property reads its own field; callers pair it with the family.
        unknownKind: [null, null, null, null, 2, null],
        textValues: none,
        fractionalValues: none,
        largeValues: [null, null, null, null, 2147483647, null],
        nonTextValues: none,
        stringCoffee: ["open-space", null, null, null, null, null],
        scalar: none,
        array: none,
      });
    });

    test("finds only the early-setup meeting room", async () => {
      const earlySetup = await read(
        StoredReservationDetails.earlySetupMeetingRoom
      );
      expect(
        Object.entries(earlySetup).flatMap(([label, value]) =>
          value ? [label] : []
        )
      ).toEqual(["meetingRoom"]);
    });

    test("groups by an accessor it selects", async () => {
      const kind = StoredReservationDetails.kind;
      const rows = await Effect.runPromise(
        testDatabase.db
          .select({ kind, count: sql<number>`count(*)::int` })
          .from(workspaceReservations)
          .where(eq(workspaceReservations.dotyposCustomerId, customerId))
          .groupBy(kind)
          .orderBy(kind)
      );
      expect(rows).toEqual([
        { kind: "cowork", count: 3 },
        { kind: "meeting-room", count: 1 },
        { kind: "office", count: 5 },
        { kind: null, count: 3 },
      ]);
    });
  }
);
