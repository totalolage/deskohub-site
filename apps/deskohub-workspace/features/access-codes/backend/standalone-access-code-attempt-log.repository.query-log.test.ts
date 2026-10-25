import "@/shared/polyfills/temporal";

import { describe, test } from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import {
  AdministrationStandaloneAccessCodeAttemptId,
  AdministrationStandaloneAccessCodeName,
  AdministrationWorkspaceSiteLocalWholeHourDateTime,
} from "@deskohub/workspace-admin-api";
import { Effect, Layer, Schema } from "effect";
import { customerAccountIdSchema } from "@/features/account/customer-account";
import type { AdministratorAccountActor } from "@/features/administrators/account-role";
import {
  collectDatabaseQueryLogs,
  expectQueryLogsToCensor,
} from "@/shared/testing/workspace-database-query-log.test-utils";
import { makeRecordingWorkspaceDatabase } from "@/shared/testing/workspace-recording-database.test-utils";
import {
  type IStandaloneAccessCodeAttemptLogRepository,
  type StandaloneAccessCodeAttempt,
  StandaloneAccessCodeAttemptLogRepository,
} from "./standalone-access-code-attempt-log.repository";

const actor: AdministratorAccountActor = {
  accountId: customerAccountIdSchema.make(
    "01980000-0000-7000-8000-000000000201"
  ),
  email: testEmailAddress("access-code-query-log-actor"),
};
const attemptId = Schema.decodeUnknownSync(
  AdministrationStandaloneAccessCodeAttemptId
)("01980000-0000-7000-8000-000000000202");
const attempt: StandaloneAccessCodeAttempt = {
  attemptId,
  actor,
  source: "dhw-cli",
  name: AdministrationStandaloneAccessCodeName.make("Synthetic Booth"),
  deviceId: "fixture-ek1" as StandaloneAccessCodeAttempt["deviceId"],
  startsAtLocal:
    AdministrationWorkspaceSiteLocalWholeHourDateTime.make("2026-09-10T10:00"),
  endsAtLocal:
    AdministrationWorkspaceSiteLocalWholeHourDateTime.make("2026-09-10T12:00"),
  startsAt: Temporal.Instant.from("2026-09-10T08:00:00Z"),
  endsAt: Temporal.Instant.from("2026-09-10T10:00:00Z"),
};
const occurredAt = Temporal.Instant.from("2026-09-10T08:00:00Z");
const staleBefore = occurredAt.subtract({ minutes: 1 });

const collectAttemptLogs = <A, E>(
  recording: Awaited<ReturnType<typeof makeRecordingWorkspaceDatabase>>,
  run: (
    repository: IStandaloneAccessCodeAttemptLogRepository
  ) => Effect.Effect<A, E>
) =>
  collectDatabaseQueryLogs(
    Effect.gen(function* () {
      const repository = yield* StandaloneAccessCodeAttemptLogRepository;
      return yield* run(repository);
    }).pipe(
      Effect.provide(
        StandaloneAccessCodeAttemptLogRepository.Default.pipe(
          Layer.provide(recording.layer)
        )
      )
    )
  );

/** A full event row in standalone_access_code_attempt_events column order. */
const eventRow = (eventKind: "started" | "ambiguous") => [
  "01980000-0000-7000-8000-000000000203",
  attempt.attemptId,
  eventKind,
  null,
  actor.accountId,
  actor.email,
  attempt.source,
  attempt.name,
  attempt.deviceId,
  attempt.startsAtLocal,
  attempt.endsAtLocal,
  attempt.startsAt.toString(),
  attempt.endsAt.toString(),
  2,
  null,
  null,
  eventKind === "ambiguous" ? "standalone_provider_ambiguous" : null,
  occurredAt.toString(),
  occurredAt.toString(),
];

describe("StandaloneAccessCodeAttemptLogRepository query logging", () => {
  test("censors the actor email in a started event insert", async () => {
    const recording = await makeRecordingWorkspaceDatabase();
    recording.setRows([[], [], [], [], [["synthetic-event-id"]]]);

    const logs = await collectAttemptLogs(recording, (repository) =>
      repository.claim({ attempt, claimedAt: occurredAt, staleBefore })
    );

    expectQueryLogsToCensor({ recording, logs, values: [actor.email] });
  });

  test("censors the actor email in a terminal event insert", async () => {
    const recording = await makeRecordingWorkspaceDatabase();
    recording.setRows([[], [["synthetic-event-id"]]]);

    const logs = await collectAttemptLogs(recording, (repository) =>
      repository.appendTerminal({
        attempt,
        variance: 2,
        eventKind: "ambiguous",
        occurredAt,
        failureCode: "standalone_provider_ambiguous",
      })
    );

    expectQueryLogsToCensor({ recording, logs, values: [actor.email] });
  });

  test("censors the actor email in a reconciled event insert", async () => {
    const recording = await makeRecordingWorkspaceDatabase();
    recording.setRows([
      [],
      [eventRow("started")],
      [eventRow("ambiguous")],
      [["synthetic-event-id"]],
    ]);

    const logs = await collectAttemptLogs(recording, (repository) =>
      repository.claim({
        attempt,
        claimedAt: occurredAt,
        staleBefore,
        providerCredentialRemovedAttemptId: attemptId,
      })
    );

    expectQueryLogsToCensor({ recording, logs, values: [actor.email] });
  });
});
