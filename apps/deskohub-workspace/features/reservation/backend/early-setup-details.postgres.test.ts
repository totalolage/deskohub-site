import "@/shared/testing/workspace-test-env";

import { afterAll, describe, expect, test } from "bun:test";
import { DotyposReservationIdSchema } from "@deskohub/dotypos";
import { Effect } from "effect";
import {
  type StoredWorkspaceReservationDetails,
  type WorkspaceReservationId,
  workspaceReservationIdSchema,
} from "@/features/reservation/persistence-contracts";
import { workspaceFixtures } from "@/shared/testing/workspace-fixtures.test-utils";
import { connectWorkspacePostgresTestDatabase } from "@/shared/testing/workspace-postgres-test-database.test-utils";
import { loadEarlySetupDetails } from "./early-setup-details";

const testDatabase = await connectWorkspacePostgresTestDatabase();

describe.skipIf(!testDatabase)("loadEarlySetupDetails on Postgres", () => {
  if (!testDatabase) return;
  const runId = crypto.randomUUID();
  const insertedIds: WorkspaceReservationId[] = [];
  const dotyposId = (label: string) =>
    DotyposReservationIdSchema.make(`early-setup-${label}-${runId}`);

  const insert = (
    reservations: ReadonlyArray<{
      readonly label: string;
      readonly details: StoredWorkspaceReservationDetails;
    }>
  ) =>
    Effect.runPromise(
      workspaceFixtures(testDatabase.db).reservations(
        reservations.map(({ label, details }) => {
          const id = workspaceReservationIdSchema.make(
            `early-setup-${label}-${runId}`
          );
          insertedIds.push(id);
          return {
            stage: { reservation: "confirmed", payment: "paid" },
            details,
            overrides: { id, dotyposReservationId: dotyposId(label) },
          };
        })
      )
    );

  afterAll(async () => {
    await testDatabase.pool.query(
      "delete from workspace_reservations where id = any($1)",
      [insertedIds]
    );
  });

  test("returns only the early-setup meeting rooms among the IDs", async () => {
    await insert([
      { label: "setup", details: { kind: "meeting-room", earlySetup: true } },
      {
        label: "no-setup",
        details: { kind: "meeting-room", earlySetup: false },
      },
      { label: "unflagged", details: { kind: "meeting-room" } },
      {
        label: "cowork",
        details: { kind: "cowork", entryTier: "basic", coffee: false },
      },
      {
        label: "unasked",
        details: { kind: "meeting-room", earlySetup: true },
      },
    ]);

    const details = await Effect.runPromise(
      loadEarlySetupDetails(
        testDatabase.db,
        ["setup", "no-setup", "unflagged", "cowork", "unlinked"].map(dotyposId)
      )
    );

    expect([...details]).toEqual([
      [dotyposId("setup"), { kind: "meeting-room", earlySetup: true }],
    ]);
  });

  test("leaves out an early-setup meeting room whose stored details are malformed", async () => {
    await insert([
      {
        label: "malformed",
        details: { kind: "meeting-room", earlySetup: true },
      },
    ]);
    // Only a write outside the encoder could store a field the schema lacks.
    await testDatabase.pool.query(
      "update workspace_reservations set reservation_details = $1::jsonb where dotypos_reservation_id = $2",
      [
        JSON.stringify({ kind: "meeting-room", earlySetup: true, room: "A" }),
        dotyposId("malformed"),
      ]
    );

    const details = await Effect.runPromise(
      loadEarlySetupDetails(testDatabase.db, [dotyposId("malformed")])
    );

    expect(details.size).toBe(0);
  });

  test("reads nothing for no IDs", async () => {
    const details = await Effect.runPromise(
      loadEarlySetupDetails(testDatabase.db, [])
    );

    expect(details.size).toBe(0);
  });
});
