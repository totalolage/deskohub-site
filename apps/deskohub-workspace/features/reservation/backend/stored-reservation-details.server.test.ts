import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";
import { Effect, Option } from "effect";
import type { WorkspaceReservationRow } from "@/db/schema";
import { workspaceReservationIdSchema } from "@/features/reservation/persistence-contracts";
import { StoredReservationDetails } from "./stored-reservation-details.server";

type StoredDocument = WorkspaceReservationRow["reservationDetails"];

const reservationId = workspaceReservationIdSchema.make("stored-details-1");

const documents = {
  cowork: { kind: "cowork", entryTier: "open-space", coffee: false },
  meetingRoom: {
    kind: "meeting-room",
    duration: { unit: "hour", amount: 4 },
    earlySetup: true,
  },
  unresolvedOffice: { kind: "office" },
} as const;

// A malformed document only reaches the column outside the encoder, so it
// comes from stored JSON here.
const malformed: readonly StoredDocument[] = [
  '{"kind":"boat"}',
  '{"kind":"cowork","entryTier":"open-space"}',
  '{"kind":"office","seats":"6","dayCount":2}',
  '{"kind":"office","seats":6,"dayCount":2,"floor":3}',
  '"cowork"',
].map((json) => JSON.parse(json));

describe("StoredReservationDetails", () => {
  test("decodes and projects every family's document unchanged", async () => {
    for (const document of Object.values(documents)) {
      expect(
        await Effect.runPromise(
          StoredReservationDetails.decode(reservationId, document)
        )
      ).toEqual(document);
      expect(StoredReservationDetails.project(document)).toEqual(
        Option.some(document)
      );
    }
  });

  test("fails a malformed document with the reservation it belongs to", async () => {
    for (const document of malformed) {
      const failure = await Effect.runPromise(
        StoredReservationDetails.decode(reservationId, document).pipe(
          Effect.flip
        )
      );
      expect(failure._tag).toBe("WorkspaceReservationDetailsMalformedError");
      expect(failure.reservationId).toBe(reservationId);
      expect(failure.cause).toBeDefined();
    }
  });

  test("decodes rows and keeps the rest of each row", async () => {
    const otherId = workspaceReservationIdSchema.make("stored-details-2");
    const rows = [
      { id: reservationId, reservationDetails: documents.cowork, label: "a" },
      {
        id: otherId,
        reservationDetails: documents.unresolvedOffice,
        label: "b",
      },
    ];
    expect(
      await Effect.runPromise(StoredReservationDetails.decodeRows(rows))
    ).toEqual(rows);

    const failure = await Effect.runPromise(
      StoredReservationDetails.decodeRows([
        rows[0]!,
        { ...rows[1]!, reservationDetails: malformed[0]! },
      ]).pipe(Effect.flip)
    );
    expect(failure.reservationId).toBe(otherId);
  });

  test("projects a malformed document as none", () => {
    for (const document of malformed) {
      expect(StoredReservationDetails.project(document)).toEqual(Option.none());
    }
  });
});
