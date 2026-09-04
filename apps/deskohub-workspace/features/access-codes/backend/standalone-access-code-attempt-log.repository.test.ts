import "@/shared/testing/workspace-test-env";

import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
} from "bun:test";
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
import { Pool } from "pg";
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
      readonly providerCredentialRemoved?: boolean;
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
        providerCredentialRemoved: input.providerCredentialRemoved ?? false,
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

    const barrierPool = new Pool({
      connectionString: process.env.WORKSPACE_TEST_DATABASE_URL,
    });
    afterAll(async () => {
      await barrierPool.end();
    });

    const reconcileBarrierKey = 987654321099;

    const waitForWaitingLock = async (
      predicate: string,
      description: string
    ) => {
      const deadline = Date.now() + 5_000;
      while (Date.now() < deadline) {
        const waiting = await barrierPool.query(
          `select 1 from pg_locks where not granted and ${predicate}`
        );
        if (waiting.rows.length > 0) return;
        await Bun.sleep(10);
      }
      throw new Error(`Timed out waiting for ${description}.`);
    };

    const installReconcileBarrier = async () => {
      await barrierPool.query(`
        create or replace function standalone_access_code_attempt_events_test_reconcile_barrier()
        returns trigger as $$
        begin
          if new.event_kind in ('ambiguous', 'reconciled') then
            perform pg_advisory_xact_lock(${reconcileBarrierKey}::bigint);
          end if;
          return new;
        end;
        $$ language plpgsql
      `);
      await barrierPool.query(`
        drop trigger if exists standalone_access_code_attempt_events_reconcile_barrier
        on standalone_access_code_attempt_events
      `);
      await barrierPool.query(`
        create trigger standalone_access_code_attempt_events_reconcile_barrier
        before insert on standalone_access_code_attempt_events
        for each row execute function
          standalone_access_code_attempt_events_test_reconcile_barrier()
      `);
    };

    const removeReconcileBarrier = async () => {
      await barrierPool.query(`
        drop trigger if exists standalone_access_code_attempt_events_reconcile_barrier
        on standalone_access_code_attempt_events
      `);
      await barrierPool.query(`
        drop function if exists
          standalone_access_code_attempt_events_test_reconcile_barrier()
      `);
    };

    const insertRogueCreatedEvent = {
      text: `insert into standalone_access_code_attempt_events
        (attempt_id, event_kind, actor, source, name, device_id, starts_at_local,
         ends_at_local, starts_at, ends_at, variance, provider_credential_id, occurred_at)
       values ($1, 'created', $2, $3, $4, $5, $6, $7, $8, $9, 2, $10, $11)`,
      values: (attemptId: string, occurredAt: Temporal.Instant) => [
        attemptId,
        actor,
        source,
        accessName,
        deviceId,
        window.startsAtLocal,
        window.endsAtLocal,
        window.startsAt.toString(),
        window.endsAt.toString(),
        providerCredentialId,
        occurredAt.toString(),
      ],
    };

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

      const unconfirmed = await Effect.runPromise(
        claim({ attempt: attemptFixture() })
      );
      expect(unconfirmed).toMatchObject({ kind: "cleanup-required" });

      const confirmed = await Effect.runPromise(
        claim({
          attempt: attemptFixture(),
          providerCredentialRemoved: true,
        })
      );
      expect(confirmed).toMatchObject({ kind: "claimed", variance: 3 });

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

      expect(first).toMatchObject({ kind: "appended" });
      expect(second).toMatchObject({
        kind: "already-terminal",
        terminal: { kind: "created" },
      });
      expect(await eventKindsOf(attempt.attemptId)).toEqual([
        "created",
        "started",
      ]);
    });

    test("returns the stored created resolution when a later terminal append conflicts", async () => {
      const attempt = attemptFixture();
      const occurredAt = Temporal.Instant.from("2026-09-10T08:00:00Z");
      await Effect.runPromise(claim({ attempt }));
      await Effect.runPromise(
        attempts.appendTerminal({
          attempt,
          variance: 2,
          eventKind: "created",
          occurredAt,
          providerCredentialId,
        })
      );

      const conflicting = await Effect.runPromise(
        attempts.appendTerminal({
          attempt,
          variance: 2,
          eventKind: "rejected",
          occurredAt: Temporal.Now.instant(),
          failureCode: "standalone_provider_rejected",
        })
      );

      expect(conflicting).toEqual({
        kind: "already-terminal",
        terminal: {
          kind: "created",
          terminal: {
            name: accessName,
            startsAtLocal: window.startsAtLocal,
            endsAtLocal: window.endsAtLocal,
            providerCredentialId,
            occurredAt,
          },
        },
      });
      expect(await eventKindsOf(attempt.attemptId)).toEqual([
        "created",
        "started",
      ]);
    });

    test("returns the stored stale-ambiguous resolution when a late created append conflicts", async () => {
      const attempt = attemptFixture();
      await Effect.runPromise(claim({ attempt }));
      await Effect.runPromise(
        attempts.appendTerminal({
          attempt,
          variance: 2,
          eventKind: "ambiguous",
          occurredAt: Temporal.Now.instant(),
          failureCode: "standalone_attempt_stale",
        })
      );

      const lateCreated = await Effect.runPromise(
        attempts.appendTerminal({
          attempt,
          variance: 2,
          eventKind: "created",
          occurredAt: Temporal.Now.instant(),
          providerCredentialId,
        })
      );

      expect(lateCreated).toEqual({
        kind: "already-terminal",
        terminal: {
          kind: "ambiguous",
          failureCode: "standalone_attempt_stale",
        },
      });
      expect(await eventKindsOf(attempt.attemptId)).toEqual([
        "ambiguous",
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

    test("blocks an unconfirmed new attempt while an ambiguous attempt occupies the window", async () => {
      const ambiguous = attemptFixture();
      await Effect.runPromise(claim({ attempt: ambiguous }));
      await Effect.runPromise(
        attempts.appendTerminal({
          attempt: ambiguous,
          variance: 2,
          eventKind: "ambiguous",
          occurredAt: Temporal.Now.instant(),
          failureCode: "standalone_provider_ambiguous",
        })
      );

      const blockedAttempt = attemptFixture();
      const blocked = await Effect.runPromise(
        claim({ attempt: blockedAttempt })
      );

      expect(blocked).toMatchObject({ kind: "cleanup-required" });
      expect(await eventKindsOf(blockedAttempt.attemptId)).toEqual([]);
    });

    test("treats a stale started attempt as ambiguous for the window until reconciled", async () => {
      const stale = attemptFixture();
      await Effect.runPromise(claim({ attempt: stale }));

      const blockedAttempt = attemptFixture();
      const blocked = await Effect.runPromise(
        claim({
          attempt: blockedAttempt,
          staleBefore: Temporal.Now.instant(),
        })
      );

      expect(blocked).toMatchObject({ kind: "cleanup-required" });
      expect(await eventKindsOf(blockedAttempt.attemptId)).toEqual([]);
    });

    test("does not treat an old created attempt as unresolved ambiguity", async () => {
      const created = attemptFixture();
      const staleClaimedAt = Temporal.Now.instant().subtract({ minutes: 5 });
      await Effect.runPromise(
        claim({ attempt: created, claimedAt: staleClaimedAt })
      );
      await Effect.runPromise(
        attempts.appendTerminal({
          attempt: created,
          variance: 2,
          eventKind: "created",
          occurredAt: staleClaimedAt,
          providerCredentialId,
        })
      );

      const next = attemptFixture();
      const unconfirmed = await Effect.runPromise(claim({ attempt: next }));
      expect(unconfirmed).toMatchObject({ kind: "claimed", variance: 3 });

      const reconciledRows = (await loadEvents(created.attemptId)).filter(
        ({ eventKind }) => eventKind === "reconciled"
      );
      expect(reconciledRows).toHaveLength(0);
    });

    test("never reconciles a created attempt even with explicit confirmation", async () => {
      const created = attemptFixture();
      const staleClaimedAt = Temporal.Now.instant().subtract({ minutes: 5 });
      await Effect.runPromise(
        claim({ attempt: created, claimedAt: staleClaimedAt })
      );
      await Effect.runPromise(
        attempts.appendTerminal({
          attempt: created,
          variance: 2,
          eventKind: "created",
          occurredAt: staleClaimedAt,
          providerCredentialId,
        })
      );

      const confirmed = await Effect.runPromise(
        claim({
          attempt: attemptFixture(),
          providerCredentialRemoved: true,
        })
      );
      expect(confirmed).toMatchObject({ kind: "claimed", variance: 3 });

      const reconciledRows = (await loadEvents(created.attemptId)).filter(
        ({ eventKind }) => eventKind === "reconciled"
      );
      expect(reconciledRows).toHaveLength(0);
    });

    test("does not treat an old rejected attempt as unresolved ambiguity", async () => {
      const rejected = attemptFixture();
      const staleClaimedAt = Temporal.Now.instant().subtract({ minutes: 5 });
      await Effect.runPromise(
        claim({ attempt: rejected, claimedAt: staleClaimedAt })
      );
      await Effect.runPromise(
        attempts.appendTerminal({
          attempt: rejected,
          variance: 2,
          eventKind: "rejected",
          occurredAt: staleClaimedAt,
          failureCode: "standalone_provider_rejected",
          providerStatusCode: 422,
        })
      );

      const next = attemptFixture();
      const unconfirmed = await Effect.runPromise(claim({ attempt: next }));
      expect(unconfirmed).toMatchObject({ kind: "claimed", variance: 2 });

      const reconciledRows = (await loadEvents(rejected.attemptId)).filter(
        ({ eventKind }) => eventKind === "reconciled"
      );
      expect(reconciledRows).toHaveLength(0);
    });

    test("reports cleanup-required before capacity exhaustion", async () => {
      const ambiguous = attemptFixture();
      const created = attemptFixture();
      await Effect.runPromise(claim({ attempt: ambiguous }));
      await Effect.runPromise(claim({ attempt: created }));
      await Effect.runPromise(
        attempts.appendTerminal({
          attempt: ambiguous,
          variance: 2,
          eventKind: "ambiguous",
          occurredAt: Temporal.Now.instant(),
          failureCode: "standalone_provider_ambiguous",
        })
      );
      await Effect.runPromise(
        attempts.appendTerminal({
          attempt: created,
          variance: 3,
          eventKind: "created",
          occurredAt: Temporal.Now.instant(),
          providerCredentialId,
        })
      );

      const next = await Effect.runPromise(
        claim({ attempt: attemptFixture() })
      );

      expect(next).toMatchObject({ kind: "cleanup-required" });
    });

    test("frees only the confirmed ambiguous variance after explicit reconciliation", async () => {
      const ambiguous = attemptFixture();
      const created = attemptFixture();
      await Effect.runPromise(claim({ attempt: ambiguous }));
      await Effect.runPromise(claim({ attempt: created }));
      await Effect.runPromise(
        attempts.appendTerminal({
          attempt: ambiguous,
          variance: 2,
          eventKind: "ambiguous",
          occurredAt: Temporal.Now.instant(),
          failureCode: "standalone_provider_ambiguous",
        })
      );
      await Effect.runPromise(
        attempts.appendTerminal({
          attempt: created,
          variance: 3,
          eventKind: "created",
          occurredAt: Temporal.Now.instant(),
          providerCredentialId,
        })
      );

      const confirmed = await Effect.runPromise(
        claim({
          attempt: attemptFixture(),
          providerCredentialRemoved: true,
        })
      );

      expect(confirmed).toMatchObject({ kind: "claimed", variance: 2 });
      expect(await eventKindsOf(ambiguous.attemptId)).toEqual([
        "ambiguous",
        "reconciled",
        "started",
      ]);
      const reconciled = (await loadEvents(ambiguous.attemptId)).find(
        ({ eventKind }) => eventKind === "reconciled"
      );
      expect(reconciled?.actor).toBe(actor);
      expect(reconciled?.failureCode).toBeNull();
      expect(reconciled?.providerCredentialId).toBeNull();
    });

    test("reconciles a stale started attempt and still replays it as ambiguous", async () => {
      const stale = attemptFixture();
      await Effect.runPromise(claim({ attempt: stale }));

      const confirmed = await Effect.runPromise(
        claim({
          attempt: attemptFixture(),
          providerCredentialRemoved: true,
          staleBefore: Temporal.Now.instant(),
        })
      );
      expect(confirmed).toMatchObject({ kind: "claimed", variance: 2 });

      const staleReplay = await Effect.runPromise(
        claim({ attempt: stale, staleBefore: Temporal.Now.instant() })
      );
      expect(staleReplay).toMatchObject({
        kind: "ambiguous",
        failureCode: "standalone_attempt_stale",
      });
    });

    test("keeps replaying a reconciled ambiguous attempt as ambiguous", async () => {
      const ambiguous = attemptFixture();
      await Effect.runPromise(claim({ attempt: ambiguous }));
      await Effect.runPromise(
        attempts.appendTerminal({
          attempt: ambiguous,
          variance: 2,
          eventKind: "ambiguous",
          occurredAt: Temporal.Now.instant(),
          failureCode: "standalone_provider_ambiguous",
        })
      );

      const confirmed = await Effect.runPromise(
        claim({
          attempt: attemptFixture(),
          providerCredentialRemoved: true,
        })
      );
      expect(confirmed).toMatchObject({ kind: "claimed", variance: 2 });

      const replay = await Effect.runPromise(claim({ attempt: ambiguous }));
      expect(replay).toMatchObject({
        kind: "ambiguous",
        failureCode: "standalone_provider_ambiguous",
      });
    });

    test("reports a reconciled replay without re-executing the attempt", async () => {
      const ambiguous = attemptFixture();
      await Effect.runPromise(claim({ attempt: ambiguous }));
      await Effect.runPromise(
        attempts.appendTerminal({
          attempt: ambiguous,
          variance: 2,
          eventKind: "ambiguous",
          occurredAt: Temporal.Now.instant(),
          failureCode: "standalone_provider_ambiguous",
        })
      );

      const reconciledReplay = await Effect.runPromise(
        claim({
          attempt: ambiguous,
          providerCredentialRemoved: true,
        })
      );
      expect(reconciledReplay).toMatchObject({ kind: "reconciled" });
      expect(await eventKindsOf(ambiguous.attemptId)).toEqual([
        "ambiguous",
        "reconciled",
        "started",
      ]);

      const unconfirmedReplay = await Effect.runPromise(
        claim({ attempt: ambiguous })
      );
      expect(unconfirmedReplay).toMatchObject({ kind: "ambiguous" });
    });

    test("records reconciliation at most once per attempt across confirmed claims", async () => {
      const ambiguous = attemptFixture();
      await Effect.runPromise(claim({ attempt: ambiguous }));
      await Effect.runPromise(
        attempts.appendTerminal({
          attempt: ambiguous,
          variance: 2,
          eventKind: "ambiguous",
          occurredAt: Temporal.Now.instant(),
          failureCode: "standalone_provider_ambiguous",
        })
      );

      const first = await Effect.runPromise(
        claim({
          attempt: attemptFixture(),
          providerCredentialRemoved: true,
        })
      );
      const second = await Effect.runPromise(
        claim({
          attempt: attemptFixture(),
          providerCredentialRemoved: true,
        })
      );

      expect(first).toMatchObject({ kind: "claimed" });
      expect(second).toMatchObject({ kind: "claimed" });
      const reconciledRows = (await loadEvents(ambiguous.attemptId)).filter(
        ({ eventKind }) => eventKind === "reconciled"
      );
      expect(reconciledRows).toHaveLength(1);
    });

    test("reconciles exactly once under concurrent confirmed claims", async () => {
      const ambiguous = attemptFixture();
      await Effect.runPromise(claim({ attempt: ambiguous }));
      await Effect.runPromise(
        attempts.appendTerminal({
          attempt: ambiguous,
          variance: 2,
          eventKind: "ambiguous",
          occurredAt: Temporal.Now.instant(),
          failureCode: "standalone_provider_ambiguous",
        })
      );

      const results = await Promise.all([
        Effect.runPromise(
          claim({
            attempt: attemptFixture(),
            providerCredentialRemoved: true,
          })
        ),
        Effect.runPromise(
          claim({
            attempt: attemptFixture(),
            providerCredentialRemoved: true,
          })
        ),
      ]);

      expect(results.map(({ kind }) => kind).sort()).toEqual([
        "claimed",
        "claimed",
      ]);
      const reconciledRows = (await loadEvents(ambiguous.attemptId)).filter(
        ({ eventKind }) => eventKind === "reconciled"
      );
      expect(reconciledRows).toHaveLength(1);
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

    test("resolves a stale confirmed replay to the durable created winner when a provider completion commits first", async () => {
      const attempt = attemptFixture();
      const staleClaimedAt = Temporal.Now.instant().subtract({ minutes: 5 });
      await Effect.runPromise(claim({ attempt, claimedAt: staleClaimedAt }));

      const barrier = await barrierPool.connect();
      try {
        const completionAt = Temporal.Now.instant();
        await barrier.query("begin");
        await barrier.query(insertRogueCreatedEvent.text, [
          ...insertRogueCreatedEvent.values(attempt.attemptId, completionAt),
        ]);

        const replay = Effect.runPromise(
          claim({
            attempt,
            providerCredentialRemoved: true,
            staleBefore: Temporal.Now.instant(),
          })
        );
        void replay.catch(() => {});
        await waitForWaitingLock(
          "locktype = 'transactionid'",
          "the stale replay to reach the contested terminal insert"
        );

        await barrier.query("commit");
        expect(await replay).toMatchObject({
          kind: "created",
          terminal: { providerCredentialId, name: accessName },
        });
      } finally {
        await barrier.query("rollback").catch(() => {});
        barrier.release();
      }

      expect(await eventKindsOf(attempt.attemptId)).toEqual([
        "created",
        "started",
      ]);
      const rows = await loadEvents(attempt.attemptId);
      expect(
        rows.filter(({ eventKind }) => eventKind === "reconciled")
      ).toHaveLength(0);
    });

    test("never reconciles a stale attempt whose provider completion wins the terminal race", async () => {
      const stale = attemptFixture();
      const staleClaimedAt = Temporal.Now.instant().subtract({ minutes: 5 });
      await Effect.runPromise(
        claim({ attempt: stale, claimedAt: staleClaimedAt })
      );

      const barrier = await barrierPool.connect();
      try {
        await installReconcileBarrier();
        await barrier.query("begin");
        await barrier.query(insertRogueCreatedEvent.text, [
          ...insertRogueCreatedEvent.values(
            stale.attemptId,
            Temporal.Now.instant()
          ),
        ]);
        await barrier.query(
          `select pg_advisory_lock(${reconcileBarrierKey}::bigint)`
        );

        const confirmed = Effect.runPromise(
          claim({
            attempt: attemptFixture(),
            providerCredentialRemoved: true,
          })
        );
        void confirmed.catch(() => {});
        await waitForWaitingLock(
          `locktype = 'advisory' and classid = (${reconcileBarrierKey}::bigint >> 32)::oid and objid = (${reconcileBarrierKey}::bigint & 4294967295)::oid`,
          "the confirmed claim to reach the reconciliation barrier"
        );

        await barrier.query("commit");
        await barrier.query(
          `select pg_advisory_unlock(${reconcileBarrierKey}::bigint)`
        );

        expect(await confirmed).toMatchObject({
          kind: "claimed",
          variance: 3,
        });
      } finally {
        await barrier.query("rollback").catch(() => {});
        await barrier
          .query(`select pg_advisory_unlock(${reconcileBarrierKey}::bigint)`)
          .catch(() => {});
        barrier.release();
        await removeReconcileBarrier();
      }

      const events = await loadEvents(stale.attemptId);
      expect(
        events.filter(({ eventKind }) => eventKind === "reconciled")
      ).toHaveLength(0);
      expect(events.some(({ eventKind }) => eventKind === "created")).toBe(
        true
      );
    });

    test("reconciles a confirmed stale replay immediately and rejects a later completion", async () => {
      const attempt = attemptFixture();
      await Effect.runPromise(claim({ attempt }));

      const replay = await Effect.runPromise(
        claim({
          attempt,
          providerCredentialRemoved: true,
          staleBefore: Temporal.Now.instant(),
        })
      );
      expect(replay).toMatchObject({ kind: "reconciled" });
      expect(await eventKindsOf(attempt.attemptId)).toEqual([
        "ambiguous",
        "reconciled",
        "started",
      ]);

      const lateCreated = await Effect.runPromise(
        attempts.appendTerminal({
          attempt,
          variance: 2,
          eventKind: "created",
          occurredAt: Temporal.Now.instant(),
          providerCredentialId,
        })
      );
      expect(lateCreated).toEqual({
        kind: "already-terminal",
        terminal: {
          kind: "ambiguous",
          failureCode: "standalone_attempt_stale",
        },
      });
      expect(await eventKindsOf(attempt.attemptId)).toEqual([
        "ambiguous",
        "reconciled",
        "started",
      ]);
    });
  }
);
