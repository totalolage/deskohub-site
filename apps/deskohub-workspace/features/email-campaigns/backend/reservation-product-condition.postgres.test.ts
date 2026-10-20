import "@/shared/testing/workspace-test-env";

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { DotyposCustomerIdSchema } from "@deskohub/dotypos";
import type { ReservationProductFilterType } from "@deskohub/workspace-admin-api";
import { Effect } from "effect";
import {
  connectWorkspacePostgresTestDatabase,
  fixtureReservationAuthorId,
} from "@/shared/testing/workspace-postgres-test-database.test-utils";
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
} as const;
type Role = keyof typeof snapshots;
const roles = Object.keys(snapshots) as Role[];

describe.skipIf(!testDatabase)(
  "reservation product conditions on disposable Postgres",
  () => {
    if (!testDatabase) return;

    beforeAll(async () => {
      for (const role of roles) {
        await testDatabase.pool.query(
          `insert into workspace_reservations (checkout_attempt_key, dotypos_reservation_id, dotypos_customer_id, reservation_state, reservation_confirmed_at, payment_state, paid_at, fulfillment_state, fulfilled_at, reservation_details, locale, author_account_id)
           values ($1, $1, $2, 'confirmed', now(), 'paid', now(), 'fulfilled', now(), $3, 'cs-CZ', $4)`,
          [
            `product-${role}-${run}`,
            customer(role),
            JSON.stringify(snapshots[role]),
            fixtureReservationAuthorId,
          ]
        );
      }
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
