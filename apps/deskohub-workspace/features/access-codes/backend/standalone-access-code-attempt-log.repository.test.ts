import "@/shared/testing/workspace-test-env";

import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { AlgoPinSchema, IgloohomeDeviceIdSchema } from "@deskohub/igloohome";
import {
  AdministrationActorUsername,
  AdministrationProviderCredentialId,
  AdministrationStandaloneAccessCodeAttemptId,
  AdministrationStandaloneAccessCodeName,
  AdministrationWorkspaceSiteLocalWholeHourDateTime,
} from "@deskohub/workspace-admin-api";
import { eq, inArray } from "drizzle-orm";
import { Effect, Layer, Schema } from "effect";
import { standaloneAccessCodeAttemptEvents } from "@/db/schema";
import {
  connectWorkspacePostgresTestDatabase,
  type WorkspacePostgresTestDatabase,
} from "@/shared/testing/workspace-postgres-test-database.test-utils";
import {
  type IStandaloneAccessCodeAttemptLogRepository,
  type StandaloneAccessCodeAttempt,
  StandaloneAccessCodeAttemptLogRepository,
} from "./standalone-access-code-attempt-log.repository";

const decodeAttemptId = Schema.decodeUnknownSync(
  AdministrationStandaloneAccessCodeAttemptId
);
const attemptIds = [
  decodeAttemptId("01980000-0000-7000-8000-000000000101"),
  decodeAttemptId("01980000-0000-7000-8000-000000000102"),
  decodeAttemptId("01980000-0000-7000-8000-000000000103"),
  decodeAttemptId("01980000-0000-7000-8000-000000000104"),
  decodeAttemptId("01980000-0000-7000-8000-000000000105"),
  decodeAttemptId("01980000-0000-7000-8000-000000000106"),
  decodeAttemptId("01980000-0000-7000-8000-000000000107"),
  decodeAttemptId("01980000-0000-7000-8000-000000000108"),
];
let nextAttemptIdIndex = 0;

const actor = AdministrationActorUsername.make("Fixture Operator");
const source = "dhw-cli";
const deviceId = Schema.decodeUnknownSync(IgloohomeDeviceIdSchema)(
  "fixture-ek1"
);
const providerCredentialId = Schema.decodeUnknownSync(
  AdministrationProviderCredentialId
)("fixture-pin-id");
const pin = Schema.decodeUnknownSync(AlgoPinSchema)("7654321");
const accessName = AdministrationStandaloneAccessCodeName.make("Booth A");
const siteLocal = (value: "2026-09-10T10:00" | "2026-09-10T12:00") =>
  AdministrationWorkspaceSiteLocalWholeHourDateTime.make(value);

const window = {
  startsAtLocal: siteLocal("2026-09-10T10:00"),
  endsAtLocal: siteLocal("2026-09-10T12:00"),
  startsAt: Temporal.Instant.from("2026-09-10T08:00:00Z"),
  endsAt: Temporal.Instant.from("2026-09-10T10:00:00Z"),
};

const newAttemptId = () => attemptIds[nextAttemptIdIndex++]!;

const attemptFixture = (
  overrides?: Partial<StandaloneAccessCodeAttempt>
): StandaloneAccessCodeAttempt => ({
  attemptId: newAttemptId(),
  actor,
  source,
  name: accessName,
  deviceId,
  startsAtLocal: window.startsAtLocal,
  endsAtLocal: window.endsAtLocal,
  startsAt: window.startsAt,
  endsAt: window.endsAt,
  ...overrides,
});

const postgresDatabase = await connectWorkspacePostgresTestDatabase();

describe.skipIf(!postgresDatabase)(
  "StandaloneAccessCodeAttemptLogRepository on Postgres",
  () => {
    const postgres = postgresDatabase as WorkspacePostgresTestDatabase;
    let attempts: IStandaloneAccessCodeAttemptLogRepository;

    const claim = (input: {
      readonly attempt: StandaloneAccessCodeAttempt;
      readonly claimedAt?: Temporal.Instant;
      readonly staleBefore?: Temporal.Instant;
    }) => {
      const claimedAt = input.claimedAt ?? Temporal.Now.instant();
      return attempts.claim({
        attempt: input.attempt,
        claimedAt,
        staleBefore:
          input.staleBefore ??
          claimedAt.subtract({
            milliseconds: 60_000,
          }),
      });
    };

    beforeAll(async () => {
      attempts = await Effect.runPromise(
        Effect.gen(function* () {
          return yield* StandaloneAccessCodeAttemptLogRepository;
        }).pipe(
          Effect.provide(
            StandaloneAccessCodeAttemptLogRepository.Default.pipe(
              Layer.provide(postgres.layer)
            )
          )
        )
      );
    });

    afterEach(async () => {
      await Effect.runPromise(
        postgres.db
          .delete(standaloneAccessCodeAttemptEvents)
          .where(
            inArray(standaloneAccessCodeAttemptEvents.attemptId, attemptIds)
          )
      );
      nextAttemptIdIndex = 0;
    });

    const eventKindsOf = async (attemptId: (typeof attemptIds)[number]) => {
      const rows = await Effect.runPromise(
        postgres.db
          .select({ eventKind: standaloneAccessCodeAttemptEvents.eventKind })
          .from(standaloneAccessCodeAttemptEvents)
          .where(eq(standaloneAccessCodeAttemptEvents.attemptId, attemptId))
      );
      return rows.map(({ eventKind }) => eventKind).sort();
    };

    const loadEvents = async (attemptId: (typeof attemptIds)[number]) =>
      Effect.runPromise(
        postgres.db
          .select()
          .from(standaloneAccessCodeAttemptEvents)
          .where(eq(standaloneAccessCodeAttemptEvents.attemptId, attemptId))
      );

    test("allocates standalone variances 2 and 3, then rejects a third attempt", async () => {
      const firstAttempt = attemptFixture();
      const secondAttempt = attemptFixture();
      const thirdAttempt = attemptFixture();

      const first = await Effect.runPromise(claim({ attempt: firstAttempt }));
      const second = await Effect.runPromise(claim({ attempt: secondAttempt }));
      const third = await Effect.runPromise(claim({ attempt: thirdAttempt }));

      expect(first).toMatchObject({ kind: "claimed", variance: 2 });
      expect(second).toMatchObject({ kind: "claimed", variance: 3 });
      expect(third).toMatchObject({ kind: "exhausted" });
      expect(await eventKindsOf(thirdAttempt.attemptId)).toEqual([]);
    });

    test("reuses a variance once its attempt is definitively rejected", async () => {
      const first = attemptFixture();
      const second = attemptFixture();
      await Effect.runPromise(claim({ attempt: first }));
      await Effect.runPromise(claim({ attempt: second }));

      await Effect.runPromise(
        attempts.appendTerminal({
          attempt: first,
          variance: 2,
          eventKind: "rejected",
          occurredAt: Temporal.Now.instant(),
          failureCode: "standalone_provider_rejected",
          providerStatusCode: 422,
        })
      );

      const reused = await Effect.runPromise(
        claim({ attempt: attemptFixture() })
      );
      expect(reused).toMatchObject({ kind: "claimed", variance: 2 });
    });

    test("keeps created and ambiguous attempts occupying their variance", async () => {
      const created = attemptFixture();
      const ambiguous = attemptFixture();
      await Effect.runPromise(claim({ attempt: created }));
      await Effect.runPromise(claim({ attempt: ambiguous }));
      await Effect.runPromise(
        attempts.appendTerminal({
          attempt: created,
          variance: 2,
          eventKind: "created",
          occurredAt: Temporal.Now.instant(),
          providerCredentialId,
        })
      );
      await Effect.runPromise(
        attempts.appendTerminal({
          attempt: ambiguous,
          variance: 3,
          eventKind: "ambiguous",
          occurredAt: Temporal.Now.instant(),
          failureCode: "standalone_provider_ambiguous",
        })
      );

      const next = await Effect.runPromise(
        claim({ attempt: attemptFixture() })
      );
      expect(next).toMatchObject({ kind: "exhausted" });
    });

    test("replays an in-flight attempt and rejects a replay with different input", async () => {
      const attempt = attemptFixture();
      const first = await Effect.runPromise(claim({ attempt }));
      const replay = await Effect.runPromise(claim({ attempt }));
      const mismatch = await Effect.runPromise(
        claim({
          attempt: {
            ...attempt,
            name: AdministrationStandaloneAccessCodeName.make("Renamed Booth"),
          },
        })
      );

      expect(first).toMatchObject({ kind: "claimed", variance: 2 });
      expect(replay).toMatchObject({ kind: "in-progress" });
      expect(mismatch).toMatchObject({ kind: "mismatch" });
      expect(await eventKindsOf(attempt.attemptId)).toEqual(["started"]);
    });

    test("rejects a replay that changes actor or source", async () => {
      const attempt = attemptFixture();
      await Effect.runPromise(claim({ attempt }));

      const otherActor = await Effect.runPromise(
        claim({
          attempt: {
            ...attempt,
            actor: AdministrationActorUsername.make("Other Operator"),
          },
        })
      );
      const otherSource = await Effect.runPromise(
        claim({
          attempt: { ...attempt, source: "admin-ui" },
        })
      );

      expect(otherActor).toMatchObject({ kind: "mismatch" });
      expect(otherSource).toMatchObject({ kind: "mismatch" });
    });

    test("resolves a stale started event conservatively to ambiguous", async () => {
      const attempt = attemptFixture();
      await Effect.runPromise(claim({ attempt }));

      const staleReplay = await Effect.runPromise(
        claim({ attempt, staleBefore: Temporal.Now.instant() })
      );
      expect(staleReplay).toMatchObject({
        kind: "ambiguous",
        failureCode: "standalone_attempt_stale",
      });
      expect(await eventKindsOf(attempt.attemptId)).toEqual([
        "ambiguous",
        "started",
      ]);

      const laterReplay = await Effect.runPromise(claim({ attempt }));
      expect(laterReplay).toMatchObject({
        kind: "ambiguous",
        failureCode: "standalone_attempt_stale",
      });
    });

    test("replays a created attempt with its provider credential", async () => {
      const attempt = attemptFixture();
      await Effect.runPromise(claim({ attempt }));
      await Effect.runPromise(
        attempts.appendTerminal({
          attempt,
          variance: 2,
          eventKind: "created",
          occurredAt: Temporal.Instant.from("2026-09-10T08:00:00Z"),
          providerCredentialId,
        })
      );

      const replay = await Effect.runPromise(claim({ attempt }));
      expect(replay).toMatchObject({
        kind: "created",
        terminal: {
          providerCredentialId,
          name: accessName,
          startsAtLocal: window.startsAtLocal,
          endsAtLocal: window.endsAtLocal,
          occurredAt: Temporal.Instant.from("2026-09-10T08:00:00Z"),
        },
      });
    });

    test("records the provider status code on a rejected terminal event", async () => {
      const attempt = attemptFixture();
      await Effect.runPromise(claim({ attempt }));

      await Effect.runPromise(
        attempts.appendTerminal({
          attempt,
          variance: 2,
          eventKind: "rejected",
          occurredAt: Temporal.Now.instant(),
          failureCode: "standalone_provider_rejected",
          providerStatusCode: 502,
        })
      );

      const rows = await loadEvents(attempt.attemptId);
      const terminal = rows.find(({ eventKind }) => eventKind === "rejected");
      expect(terminal?.providerStatusCode).toBe(502);
      expect(terminal?.failureCode).toBe("standalone_provider_rejected");
      expect(terminal?.providerCredentialId).toBeNull();
    });

    test("appends exactly one terminal event per attempt", async () => {
      const attempt = attemptFixture();
      await Effect.runPromise(claim({ attempt }));

      const first = await Effect.runPromise(
        attempts.appendTerminal({
          attempt,
          variance: 2,
          eventKind: "created",
          occurredAt: Temporal.Now.instant(),
          providerCredentialId,
        })
      );
      const second = await Effect.runPromise(
        attempts.appendTerminal({
          attempt,
          variance: 2,
          eventKind: "rejected",
          occurredAt: Temporal.Now.instant(),
          failureCode: "standalone_provider_rejected",
        })
      );

      expect(first).toBe(true);
      expect(second).toBe(false);
      expect(await eventKindsOf(attempt.attemptId)).toEqual([
        "created",
        "started",
      ]);
    });

    test("serializes concurrent claims into distinct variances", async () => {
      const results = await Promise.all([
        Effect.runPromise(claim({ attempt: attemptFixture() })),
        Effect.runPromise(claim({ attempt: attemptFixture() })),
        Effect.runPromise(claim({ attempt: attemptFixture() })),
      ]);
      const variances = results
        .filter((result) => result.kind === "claimed")
        .map((result) => (result.kind === "claimed" ? result.variance : null));

      expect(variances.sort()).toEqual([2, 3]);
      expect(
        results.filter((result) => result.kind === "exhausted")
      ).toHaveLength(1);
    });

    test("keeps concurrent identical claims at most once", async () => {
      const attempt = attemptFixture();
      const results = await Promise.all([
        Effect.runPromise(claim({ attempt })),
        Effect.runPromise(claim({ attempt })),
      ]);
      const kinds = results.map((result) => result.kind).sort();

      expect(kinds).toEqual(["claimed", "in-progress"]);
    });

    test("enforces the closed vocabularies and UUID format at the database", async () => {
      const attempt = attemptFixture();
      await Effect.runPromise(claim({ attempt }));

      const rejectedSource = Effect.runPromise(
        postgres.db.insert(standaloneAccessCodeAttemptEvents).values({
          attemptId: newAttemptId(),
          eventKind: "started",
          actor,
          source: "operator-console" as never,
          name: accessName,
          deviceId,
          startsAtLocal: window.startsAtLocal,
          endsAtLocal: window.endsAtLocal,
          startsAt: window.startsAt,
          endsAt: window.endsAt,
          variance: 3,
          occurredAt: Temporal.Now.instant(),
        })
      );
      await expect(rejectedSource).rejects.toThrow();

      const rejectedFailureCode = Effect.runPromise(
        attempts.appendTerminal({
          attempt,
          variance: 2,
          eventKind: "rejected",
          occurredAt: Temporal.Now.instant(),
          failureCode: "provider_said_no" as never,
        })
      );
      await expect(rejectedFailureCode).rejects.toThrow();

      const rejectedAttemptId = Effect.runPromise(
        postgres.db.insert(standaloneAccessCodeAttemptEvents).values({
          attemptId: "not-a-uuid" as never,
          eventKind: "started",
          actor,
          source,
          name: accessName,
          deviceId,
          startsAtLocal: window.startsAtLocal,
          endsAtLocal: window.endsAtLocal,
          startsAt: window.startsAt,
          endsAt: window.endsAt,
          variance: 3,
          occurredAt: Temporal.Now.instant(),
        })
      );
      await expect(rejectedAttemptId).rejects.toThrow();
    });

    test("never persists provider PIN material in attempt events", async () => {
      const attempt = attemptFixture();
      await Effect.runPromise(claim({ attempt }));
      await Effect.runPromise(
        attempts.appendTerminal({
          attempt,
          variance: 2,
          eventKind: "created",
          occurredAt: Temporal.Now.instant(),
          providerCredentialId,
        })
      );

      const rows = await loadEvents(attempt.attemptId);
      const serialized = JSON.stringify(rows);
      expect(serialized).not.toContain(pin);
      expect(serialized).not.toMatch(/"pin"/i);
    });
  }
);
