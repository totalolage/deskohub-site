import "@/shared/polyfills/temporal";

import { describe, test } from "bun:test";
import { AlgoPinSchema } from "@deskohub/igloohome";
import { NodeCrypto } from "@effect/platform-node";
import { Effect, Layer } from "effect";
import {
  collectDatabaseQueryLogs,
  expectQueryLogsToCensor,
} from "@/shared/testing/workspace-database-query-log.test-utils";
import { makeRecordingWorkspaceDatabase } from "@/shared/testing/workspace-recording-database.test-utils";
import { ReservationAccessRepository } from "./reservation-access.repository";

describe("ReservationAccessRepository query logging", () => {
  test("censors the issued access code", async () => {
    const recording = await makeRecordingWorkspaceDatabase();
    const accessCode = AlgoPinSchema.make("918273645");

    const logs = await collectDatabaseQueryLogs(
      Effect.gen(function* () {
        const repository = yield* ReservationAccessRepository;
        yield* repository.markIssued({
          id: "grant-1" as never,
          reservationId: "reservation-1" as never,
          accessCode,
          pinId: "pin-1" as never,
          issuedAt: Temporal.Instant.from("2099-06-10T08:00:00Z"),
        });
      }).pipe(
        Effect.provide(
          ReservationAccessRepository.Default.pipe(
            Layer.provide(Layer.mergeAll(recording.layer, NodeCrypto.layer))
          )
        )
      )
    );

    expectQueryLogsToCensor({ recording, logs, values: [accessCode] });
  });
});
