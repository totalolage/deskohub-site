import "@/shared/testing/workspace-test-env";

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { DotyposCustomerIdSchema } from "@deskohub/dotypos";
import type { ReservationProductFilterType } from "@deskohub/workspace-admin-api";
import { Effect } from "effect";
import { workspaceFixtures } from "@/shared/testing/workspace-fixtures.test-utils";
import { connectWorkspacePostgresTestDatabase } from "@/shared/testing/workspace-postgres-test-database.test-utils";
import { CampaignCandidateRepository } from "./campaign-candidate.repository";

const testDatabase = await connectWorkspacePostgresTestDatabase();

const run = crypto.randomUUID();
const customer = (role: string) =>
  DotyposCustomerIdSchema.make(`product-${role}-${run}`);

/** One booked reservation per customer, with the snapshot it stores. */
const snapshots = {
  reservedDesk: {
    kind: "cowork",
    entryTier: "reserved-desk",
    coffee: true,
    monitorOption: "2x27-4k",
  },
  openSpace: { kind: "cowork", entryTier: "open-space", coffee: false },
  retiredProfi: {
    kind: "cowork",
    entryTier: "profi",
    coffee: true,
    monitorOption: "2x32-qhd",
  },
  fourHourRoom: {
    kind: "meeting-room",
    duration: { unit: "hour", amount: 4 },
  },
  unresolvedRoom: { kind: "meeting-room" },
  bigOffice: { kind: "office", seats: 6, dayCount: 2 },
  smallOffice: { kind: "office", seats: 2, dayCount: 5 },
  unresolvedOffice: { kind: "office" },
  malformedOffice: { kind: "office" },
} as const;
type Role = keyof typeof snapshots;
const roles = Object.keys(snapshots) as Role[];

/** Replaces the malformed role's snapshot, as only a write outside the encoder could. */
const malformedOfficeDetails = { kind: "office", seats: "many", dayCount: 2.5 };

describe.skipIf(!testDatabase)(
  "reservation product conditions on disposable Postgres",
  () => {
    if (!testDatabase) return;

    beforeAll(async () => {
      await Effect.runPromise(
        workspaceFixtures(testDatabase.db).reservations(
          roles.map((role) => ({
            stage: {
              reservation: "confirmed",
              payment: "paid",
              fulfillment: "fulfilled",
            },
            customer: customer(role),
            details: snapshots[role],
          }))
        )
      );
      await testDatabase.pool.query(
        "update workspace_reservations set reservation_details = $1::jsonb where dotypos_customer_id = $2",
        [JSON.stringify(malformedOfficeDetails), customer("malformedOffice")]
      );
    });

    afterAll(async () => {
      await testDatabase.pool.query(
        "delete from workspace_reservations where dotypos_customer_id = any($1)",
        [roles.map(customer)]
      );
    });

    const matching = async (product: ReservationProductFilterType) => {
      const counts = await Effect.runPromise(
        CampaignCandidateRepository.pipe(
          Effect.flatMap((candidates) =>
            candidates.countReservations({ product })
          ),
          Effect.provide(CampaignCandidateRepository.Default),
          Effect.provide(testDatabase.layer)
        )
      );
      return roles.filter((role) => counts.has(customer(role)));
    };

    test("matches a family alone, resolved or not", async () => {
      expect(await matching({ family: "office", properties: [] })).toEqual([
        "bigOffice",
        "smallOffice",
        "unresolvedOffice",
        "malformedOffice",
      ]);
    });

    test("matches enum properties with any of and none of", async () => {
      expect(
        await matching({
          family: "cowork",
          properties: [
            {
              property: "tier",
              operator: "anyOf",
              value: ["reserved-desk", "profi"],
            },
          ],
        })
      ).toEqual(["reservedDesk", "retiredProfi"]);
      expect(
        await matching({
          family: "cowork",
          properties: [
            { property: "monitor", operator: "noneOf", value: ["2x27-4k"] },
          ],
        })
      ).toEqual(["retiredProfi"]);
      expect(
        await matching({
          family: "meeting-room",
          properties: [
            { property: "offer", operator: "anyOf", value: ["hour:4"] },
          ],
        })
      ).toEqual(["fourHourRoom"]);
    });

    test("matches boolean and number properties", async () => {
      expect(
        await matching({
          family: "cowork",
          properties: [{ property: "coffee", operator: "is", value: false }],
        })
      ).toEqual(["openSpace"]);
      expect(
        await matching({
          family: "office",
          properties: [
            { property: "seats", operator: "gte", value: 4 },
            { property: "days", operator: "lt", value: 3 },
          ],
        })
      ).toEqual(["bigOffice"]);
    });

    test("never matches a property condition on an unresolved snapshot", async () => {
      expect(
        await matching({
          family: "office",
          properties: [{ property: "seats", operator: "ne", value: 99 }],
        })
      ).toEqual(["bigOffice", "smallOffice"]);
      expect(
        await matching({
          family: "meeting-room",
          properties: [
            { property: "offer", operator: "noneOf", value: ["day:1"] },
          ],
        })
      ).toEqual(["fourHourRoom"]);
    });

    test("compares every catalog property with every operator it allows", async () => {
      const cases: readonly [ReservationProductFilterType, readonly Role[]][] =
        [
          [
            {
              family: "cowork",
              properties: [{ property: "coffee", operator: "is", value: true }],
            },
            ["reservedDesk", "retiredProfi"],
          ],
          [
            {
              family: "cowork",
              properties: [
                { property: "tier", operator: "noneOf", value: ["open-space"] },
              ],
            },
            ["reservedDesk", "retiredProfi"],
          ],
          [
            {
              family: "cowork",
              properties: [
                {
                  property: "monitor",
                  operator: "anyOf",
                  value: ["2x27-4k", "2x32-qhd"],
                },
              ],
            },
            ["reservedDesk", "retiredProfi"],
          ],
          [
            {
              family: "meeting-room",
              properties: [
                { property: "offer", operator: "noneOf", value: ["hour:4"] },
              ],
            },
            [],
          ],
          [
            {
              family: "office",
              properties: [{ property: "seats", operator: "eq", value: 2 }],
            },
            ["smallOffice"],
          ],
          [
            {
              family: "office",
              properties: [{ property: "seats", operator: "lte", value: 6 }],
            },
            ["bigOffice", "smallOffice"],
          ],
          [
            {
              family: "office",
              properties: [{ property: "days", operator: "gt", value: 2 }],
            },
            ["smallOffice"],
          ],
          [
            {
              family: "office",
              properties: [{ property: "days", operator: "gte", value: 2 }],
            },
            ["bigOffice", "smallOffice"],
          ],
          [
            {
              family: "office",
              properties: [{ property: "days", operator: "ne", value: 5 }],
            },
            ["bigOffice"],
          ],
        ];
      for (const [product, expected] of cases) {
        expect(await matching(product)).toEqual([...expected]);
      }
    });

    test("never matches a property condition on a malformed value", async () => {
      expect(
        await matching({
          family: "office",
          properties: [{ property: "seats", operator: "ne", value: 99 }],
        })
      ).toEqual(["bigOffice", "smallOffice"]);
      expect(
        await matching({
          family: "office",
          properties: [{ property: "days", operator: "gte", value: 1 }],
        })
      ).toEqual(["bigOffice", "smallOffice"]);
    });

    test("matches nothing for an unknown property", async () => {
      expect(
        await matching({
          family: "office",
          properties: [{ property: "floor", operator: "gte", value: 1 }],
        })
      ).toEqual([]);
    });
  }
);
