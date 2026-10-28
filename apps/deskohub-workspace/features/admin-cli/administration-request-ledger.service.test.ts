import "@/shared/testing/workspace-test-env";

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  AdministrationCampaignAudience,
  type AdministrationChannel,
  AdministrationDiscountMutationResult,
  AdministrationReservationAccessGrant,
  AdministrationStandaloneAccessCodeResult,
  CliMutationInProgress,
  CliMutationRejected,
  CliMutationRequestId,
  type CliMutationRequestIdType,
  CliMutationUncertain,
  CliResourceNotFound,
  CliServiceUnavailable,
  CliSessionId,
  CliStandaloneAccessCodeCleanupRequired,
  CliStandaloneAccessCodeReconciled,
  CurrentAdministrationCaller,
  digestCliAuthenticationSecret,
  makeCliAuthenticationSecret,
} from "@deskohub/workspace-admin-api";
import { NodeCrypto } from "@effect/platform-node";
import { Cause, Effect, Exit, Layer, Option, Ref, Schema } from "effect";
import type { CliStoredMutation } from "@/db/schema";
import { cliSessions } from "@/db/schema";
import { ReservationAccessAdministrationError } from "@/features/administration/reservation-access-administration.service";
import type { AdministratorAccountActor } from "@/features/administrators/account-role";
import { AdministratorAssistantConnections } from "@/features/administrators/backend/administrator-assistant-connections.service";
import { CampaignService } from "@/features/email-campaigns/backend/campaign.service";
import { CampaignAudienceService } from "@/features/email-campaigns/backend/campaign-audience.service";
import { workspaceFixtures } from "@/shared/testing/workspace-fixtures.test-utils";
import { connectWorkspacePostgresTestDatabase } from "@/shared/testing/workspace-postgres-test-database.test-utils";
import { CurrentAdministrationAction } from "./administration-action";
import {
  discountMutationRecovery,
  reservationAccessRecovery,
  standaloneAccessCodeRecovery,
  standaloneAccessCodeStoredResult,
} from "./administration-mutation-recovery";
import {
  AdministrationRequestLedger,
  StoredResult,
} from "./administration-request-ledger.service";

const testDatabase = await connectWorkspacePostgresTestDatabase();

describe.skipIf(!testDatabase)("administration request ledger", () => {
  if (!testDatabase) return;
  const sessionId = CliSessionId.make(crypto.randomUUID());
  const oauthClientId = `https://assistant-${crypto.randomUUID()}.example/client.json`;
  const titlePrefix = `Ledger crash ${crypto.randomUUID()}`;
  const failCompletion = `fail_cli_mutation_completion_${crypto.randomUUID().replaceAll("-", "_")}`;
  let administrator: AdministratorAccountActor;
  let assistantChannel: AdministrationChannel;
  const sessionChannel: AdministrationChannel = {
    _tag: "CliSession",
    sessionId,
  };

  beforeAll(async () => {
    administrator = await Effect.runPromise(
      workspaceFixtures(testDatabase.db).account("request-ledger", {
        roles: ["administrator"],
      })
    );
    const tokenHash = await Effect.runPromise(
      makeCliAuthenticationSecret().pipe(
        Effect.flatMap(digestCliAuthenticationSecret),
        Effect.provide(NodeCrypto.layer)
      )
    );
    await Effect.runPromise(
      testDatabase.db.insert(cliSessions).values({
        id: sessionId,
        approvedByAccountId: administrator.accountId,
        approvedByAccountEmail: administrator.email,
        tokenHash,
        clientName: "request ledger test client",
        cliVersion: "1.0.0",
        buildTarget: "development",
        createdAt: Temporal.Now.instant(),
        lastUsedAt: Temporal.Now.instant(),
      })
    );
    const { connectionId } = await Effect.runPromise(
      AdministratorAssistantConnections.pipe(
        Effect.flatMap((connections) =>
          connections.connect({
            actor: administrator,
            oauthClientId,
            clientName: "Synthetic assistant",
          })
        ),
        Effect.provide(
          AdministratorAssistantConnections.Default.pipe(
            Layer.provide(testDatabase.layer)
          )
        )
      )
    );
    assistantChannel = {
      _tag: "AssistantConnection",
      connectionId,
      oauthClientId,
    };
  });

  afterAll(async () => {
    await testDatabase.pool.query(
      `drop trigger if exists ${failCompletion} on cli_mutation_requests`
    );
    await testDatabase.pool.query(`drop function if exists ${failCompletion}`);
    // Deleting the channels deletes their mutation requests.
    await testDatabase.pool.query("delete from cli_sessions where id = $1", [
      sessionId,
    ]);
    await testDatabase.pool.query(
      "delete from administrator_assistant_connections where oauth_client_id = $1",
      [oauthClientId]
    );
    await testDatabase.pool.query(
      "delete from email_campaigns where title like $1",
      [`${titlePrefix}%`]
    );
    await testDatabase.pool.query(
      "delete from email_campaign_audiences where title like $1",
      [`${titlePrefix}%`]
    );
    await Effect.runPromise(
      workspaceFixtures(testDatabase.db).deleteAccounts([administrator])
    );
  });

  const ledgerLayer = AdministrationRequestLedger.Default.pipe(
    Layer.provide(testDatabase.layer)
  );

  /** Runs a ledger operation as an administrator calling through `channel`. */
  const runAs = <A, E>(
    channel: AdministrationChannel,
    operation: Effect.Effect<
      A,
      E,
      AdministrationRequestLedger | CurrentAdministrationCaller
    >
  ) =>
    Effect.runPromiseExit(
      operation.pipe(
        Effect.provide(ledgerLayer),
        Effect.provideService(CurrentAdministrationCaller, {
          actor: administrator,
          channel,
        })
      )
    );

  const ledgerEntry = async (requestId: CliMutationRequestIdType) => {
    const result = (await testDatabase.pool.query(
      "select result from cli_mutation_requests where session_id = $1 and request_id = $2",
      [sessionId, requestId]
    )) as { rows: Array<{ result: unknown }> };
    return result.rows[0];
  };

  /** Backdates a claim, as if its attempt started `seconds` ago. */
  const ageClaim = (requestId: CliMutationRequestIdType, seconds: number) =>
    testDatabase.pool.query(
      `update cli_mutation_requests set created_at = now() - make_interval(secs => $3)
        where session_id = $1 and request_id = $2`,
      [sessionId, requestId, seconds]
    );

  /** Makes recording the result of `requestId` fail until the returned cleanup. */
  const failCompletionOf = async (requestId: CliMutationRequestIdType) => {
    await testDatabase.pool.query(
      `create or replace function ${failCompletion}() returns trigger language plpgsql as $$
        begin raise exception 'Injected CLI mutation completion failure'; end
      $$`
    );
    await testDatabase.pool.query(
      `create trigger ${failCompletion} before update on cli_mutation_requests
        for each row when (new.request_id = '${requestId}' and new.result is not null)
        execute function ${failCompletion}()`
    );
    return () =>
      testDatabase.pool.query(
        `drop trigger ${failCompletion} on cli_mutation_requests`
      );
  };

  const newRequestId = () => CliMutationRequestId.make(crypto.randomUUID());

  /** Deletes a claim, as if something else settled it mid-attempt. */
  const deleteClaim = (requestId: CliMutationRequestIdType) =>
    Effect.promise(() =>
      testDatabase.pool.query(
        "delete from cli_mutation_requests where session_id = $1 and request_id = $2",
        [sessionId, requestId]
      )
    );

  const failureOf = (exit: Exit.Exit<unknown, unknown>) =>
    Exit.isFailure(exit)
      ? Option.getOrUndefined(Cause.findErrorOption(exit.cause))
      : undefined;

  describe("database-only mutations", () => {
    const services = Layer.mergeAll(
      CampaignAudienceService.Default,
      CampaignService.Default
    ).pipe(Layer.provide(testDatabase.layer));

    /**
     * Creates an audience and a draft for it. The draft insert opens its own
     * transaction, so the mutation spans services and a nested transaction.
     */
    const createAudienceWithDraft = (
      title: string,
      requestId: CliMutationRequestIdType,
      afterWrite: Effect.Effect<void> = Effect.void
    ) =>
      runAs(
        sessionChannel,
        Effect.gen(function* () {
          const ledger = yield* AdministrationRequestLedger;
          const audiences = yield* CampaignAudienceService;
          const campaigns = yield* CampaignService;
          const filter = {
            attribute: "locale",
            _tag: "Condition",
            operator: "anyOf",
            value: ["cs-CZ"],
          } as const;
          return yield* ledger.applyOnce({
            requestId,
            mutation: {
              kind: "campaign-audience-create",
              audience: { title, filter },
            },
            result: AdministrationCampaignAudience,
            apply: Effect.gen(function* () {
              const audience = yield* audiences.create({ title, filter });
              yield* campaigns.create({
                title,
                purpose: "operational",
                templateKey: "workspace",
                audienceId: audience.id,
                content: {},
              });
              yield* afterWrite;
              return {
                id: audience.id,
                title: audience.title,
                filter: audience.filter,
                archivedAt: null,
                createdAt: audience.createdAt.toString(),
                updatedAt: audience.updatedAt.toString(),
              };
            }),
          });
        }).pipe(Effect.provide(services))
      );

    const countRows = async (table: string, title: string) => {
      const result = (await testDatabase.pool.query(
        `select count(*)::int as count from ${table} where title = $1`,
        [title]
      )) as { rows: Array<{ count: number }> };
      return result.rows[0]?.count;
    };

    const expectRecoverable = async (
      title: string,
      requestId: CliMutationRequestIdType,
      failed: Exit.Exit<unknown, unknown>
    ) => {
      expect(Exit.isFailure(failed)).toBe(true);
      expect(await countRows("email_campaign_audiences", title)).toBe(0);
      expect(await countRows("email_campaigns", title)).toBe(0);
      expect(await ledgerEntry(requestId)).toBeUndefined();

      const retried = await createAudienceWithDraft(title, requestId);
      const replayed = await createAudienceWithDraft(title, requestId);

      expect(Exit.isSuccess(retried)).toBe(true);
      expect(replayed).toEqual(retried);
      expect(await countRows("email_campaign_audiences", title)).toBe(1);
      expect(await countRows("email_campaigns", title)).toBe(1);
    };

    test("leaves nothing behind when a crash follows the mutation's writes", async () => {
      const title = `${titlePrefix} after apply`;
      const requestId = newRequestId();

      const failed = await createAudienceWithDraft(
        title,
        requestId,
        Effect.die(new Error("Process crashed after the mutation's writes"))
      );

      await expectRecoverable(title, requestId, failed);
    });

    test("rolls the mutation back when storing its result fails", async () => {
      const title = `${titlePrefix} at completion`;
      const requestId = newRequestId();
      const restoreCompletion = await failCompletionOf(requestId);

      const failed = await createAudienceWithDraft(title, requestId);
      await restoreCompletion();

      await expectRecoverable(title, requestId, failed);
    });
  });

  describe("request scope", () => {
    const audienceMutation = (title: string): CliStoredMutation => ({
      kind: "campaign-audience-create",
      audience: {
        title,
        filter: {
          attribute: "locale",
          _tag: "Condition",
          operator: "anyOf",
          value: ["cs-CZ"],
        },
      },
    });
    const audienceResult = (title: string) =>
      Schema.decodeUnknownSync(AdministrationCampaignAudience)({
        id: crypto.randomUUID(),
        title,
        filter: {
          attribute: "locale",
          _tag: "Condition",
          operator: "anyOf",
          value: ["cs-CZ"],
        },
        archivedAt: null,
        createdAt: "2026-10-22T08:00:00Z",
        updatedAt: "2026-10-22T08:00:00Z",
      });
    const createAudience = (
      requestId: CliMutationRequestIdType,
      title: string,
      apply: Effect.Effect<ReturnType<typeof audienceResult>, unknown>
    ) =>
      AdministrationRequestLedger.pipe(
        Effect.flatMap((ledger) =>
          ledger.applyOnce({
            requestId,
            mutation: audienceMutation(title),
            result: AdministrationCampaignAudience,
            apply,
          })
        )
      );

    test("replays, waits on and rejects an assistant's request IDs", async () => {
      const requestId = newRequestId();
      const result = audienceResult("Assistant audience");
      const replays = await Effect.runPromise(Ref.make(0));
      const inAction = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
        effect.pipe(
          Effect.provideService(CurrentAdministrationAction, {
            markReplayed: Ref.update(replays, (count) => count + 1),
          })
        );
      const applied = await Effect.runPromise(Ref.make(0));
      const apply = Ref.update(applied, (count) => count + 1).pipe(
        Effect.as(result)
      );

      const first = await runAs(
        assistantChannel,
        inAction(createAudience(requestId, "Assistant audience", apply))
      );
      const replayed = await runAs(
        assistantChannel,
        inAction(createAudience(requestId, "Assistant audience", apply))
      );
      const reused = await runAs(
        assistantChannel,
        inAction(createAudience(requestId, "Different audience", apply))
      );

      expect(first).toEqual(Exit.succeed(result));
      expect(replayed).toEqual(Exit.succeed(result));
      expect(failureOf(reused)).toBeInstanceOf(CliMutationRejected);
      expect(await Effect.runPromise(Ref.get(applied))).toBe(1);
      expect(await Effect.runPromise(Ref.get(replays))).toBe(1);
    });

    test("keeps a CLI session's and an assistant's same request ID apart", async () => {
      const requestId = newRequestId();
      const cliResult = audienceResult("CLI audience");
      const assistantResult = audienceResult("Assistant audience");

      const cli = await runAs(
        sessionChannel,
        createAudience(requestId, "CLI audience", Effect.succeed(cliResult))
      );
      const assistant = await runAs(
        assistantChannel,
        createAudience(
          requestId,
          "Assistant audience",
          Effect.succeed(assistantResult)
        )
      );
      const cliReplay = await runAs(
        sessionChannel,
        createAudience(requestId, "CLI audience", Effect.die("not applied"))
      );

      expect(cli).toEqual(Exit.succeed(cliResult));
      expect(assistant).toEqual(Exit.succeed(assistantResult));
      expect(cliReplay).toEqual(Exit.succeed(cliResult));
    });
  });

  /**
   * One administration mutation with external effects, as its handler
   * passes it to the ledger, with counters for every attempt it runs.
   */
  const mutationWithEffects = async <A, E>(definition: {
    readonly mutation: CliStoredMutation;
    readonly stored: unknown;
    readonly recovery: unknown;
    readonly inProgressMessage?: string;
    readonly result: A;
    readonly withResume?: boolean;
  }) => {
    const counts = await Effect.runPromise(
      Ref.make({ applied: 0, resumed: 0, settled: 0 })
    );
    const count = (key: "applied" | "resumed" | "settled") =>
      Ref.update(counts, (current) => ({
        ...current,
        [key]: current[key] + 1,
      }));
    const run = (
      requestId: CliMutationRequestIdType,
      outcome: {
        readonly apply?: Effect.Effect<A, E>;
        readonly resume?: Effect.Effect<A, E>;
        readonly mutation?: CliStoredMutation;
      } = {}
    ) =>
      runAs(
        sessionChannel,
        AdministrationRequestLedger.pipe(
          Effect.flatMap((ledger) =>
            ledger.applyOnceWithEffects({
              requestId,
              mutation: outcome.mutation ?? definition.mutation,
              stored: definition.stored as never,
              recovery: definition.recovery as never,
              inProgressMessage: definition.inProgressMessage,
              apply: count("applied").pipe(
                Effect.andThen(
                  outcome.apply ?? Effect.succeed(definition.result)
                )
              ),
              ...(definition.withResume && {
                resume: count("resumed").pipe(
                  Effect.andThen(
                    outcome.resume ?? Effect.succeed(definition.result)
                  )
                ),
              }),
              afterSettled: count("settled"),
            })
          )
        )
      );
    return {
      run,
      counts: () => Effect.runPromise(Ref.get(counts)),
    };
  };

  describe("discount mutations", () => {
    const mutation: CliStoredMutation = {
      kind: "delete-discount",
      id: crypto.randomUUID(),
    } as CliStoredMutation;
    const result = Schema.decodeUnknownSync(
      AdministrationDiscountMutationResult
    )({
      kind: "delete-discount",
      createdDiscountId: null,
      createdCodeId: null,
      createdVoucherId: null,
    });
    const discounts = () =>
      mutationWithEffects({
        mutation,
        stored: StoredResult.unchanged(AdministrationDiscountMutationResult),
        recovery: discountMutationRecovery,
        result,
      });

    test.each([
      ["not found", new CliResourceNotFound({ message: "Gone." })],
      ["rejected", new CliMutationRejected({ message: "Conflict." })],
    ])("frees the request ID when the mutation is %s", async (_, failure) => {
      const requestId = newRequestId();
      const { run, counts } = await discounts();

      const failed = await run(requestId, { apply: Effect.fail(failure) });
      expect(failureOf(failed)).toBe(failure);
      expect(await ledgerEntry(requestId)).toBeUndefined();

      expect(await run(requestId)).toEqual(Exit.succeed(result));
      expect((await counts()).applied).toBe(2);
    });

    test("keeps the claim, without resuming it, when the mutation may have applied", async () => {
      const requestId = newRequestId();
      const { run, counts } = await discounts();

      const failed = await run(requestId, {
        apply: Effect.fail(
          new CliServiceUnavailable({ message: "Unavailable." })
        ),
      });
      expect(failureOf(failed)).toBeInstanceOf(CliServiceUnavailable);
      expect(await ledgerEntry(requestId)).toEqual({ result: null });

      await ageClaim(requestId, 3600);
      const retried = await run(requestId);
      expect(failureOf(retried)).toEqual(
        new CliMutationInProgress({
          requestId,
          message:
            "This mutation is still being applied. Retrying with the same request identifier is safe.",
        })
      );
      expect((await counts()).applied).toBe(1);
    });

    test("fails and keeps the claim when the result can't be recorded", async () => {
      const requestId = newRequestId();
      const { run, counts } = await discounts();
      const restoreCompletion = await failCompletionOf(requestId);

      const failed = await run(requestId);
      await restoreCompletion();

      expect(failureOf(failed)).toBeInstanceOf(CliServiceUnavailable);
      expect(await ledgerEntry(requestId)).toEqual({ result: null });
      expect(await counts()).toEqual({ applied: 1, resumed: 0, settled: 1 });
    });

    test("dies when the claim vanished before its result is recorded", async () => {
      const requestId = newRequestId();
      const { run } = await discounts();

      const vanished = await run(requestId, {
        apply: deleteClaim(requestId).pipe(Effect.as(result)),
      });

      expect(Exit.isFailure(vanished) && Cause.hasDies(vanished.cause)).toBe(
        true
      );
    });

    test("marks a replay, then answers unavailable, when the stored result is unreadable", async () => {
      const requestId = newRequestId();
      const { run } = await discounts();
      await run(requestId);
      await testDatabase.pool.query(
        `update cli_mutation_requests set result = '{"kind": "unreadable"}'::jsonb
          where session_id = $1 and request_id = $2`,
        [sessionId, requestId]
      );
      const replays = await Effect.runPromise(Ref.make(0));

      const replayed = await runAs(
        sessionChannel,
        AdministrationRequestLedger.pipe(
          Effect.flatMap((ledger) =>
            ledger.applyOnceWithEffects({
              requestId,
              mutation,
              stored: StoredResult.unchanged(
                AdministrationDiscountMutationResult
              ),
              recovery: discountMutationRecovery,
              apply: Effect.die("not applied"),
            })
          ),
          Effect.provideService(CurrentAdministrationAction, {
            markReplayed: Ref.update(replays, (count) => count + 1),
          })
        )
      );

      expect(failureOf(replayed)).toBeInstanceOf(CliServiceUnavailable);
      expect(await Effect.runPromise(Ref.get(replays))).toBe(1);
    });

    test("replays the stored result and refreshes after both answers", async () => {
      const requestId = newRequestId();
      const { run, counts } = await discounts();

      expect(await run(requestId)).toEqual(Exit.succeed(result));
      expect(await run(requestId)).toEqual(Exit.succeed(result));
      expect(await ledgerEntry(requestId)).toEqual({ result });
      expect(await counts()).toEqual({ applied: 1, resumed: 0, settled: 2 });
    });

    test("rejects a reused request ID", async () => {
      const requestId = newRequestId();
      const { run } = await discounts();

      await run(requestId);
      const reused = await run(requestId, {
        mutation: { ...mutation, id: crypto.randomUUID() } as never,
      });
      expect(failureOf(reused)).toBeInstanceOf(CliMutationRejected);
    });
  });

  describe("reservation access mutations", () => {
    const mutation: CliStoredMutation = {
      kind: "reservation-access",
      reservationId: crypto.randomUUID(),
      mutation: { kind: "retry-failed" },
    } as CliStoredMutation;
    const result = Schema.decodeUnknownSync(
      AdministrationReservationAccessGrant
    )({
      id: "grant-1",
      state: "issued",
      provider: "igloohome",
      credentialType: "pin",
      deviceId: "device-1",
      providerCredentialId: "credential-1",
      accessName: "Synthetic reservation",
      scheduledStartsAt: "2026-11-02T09:00:00Z",
      startsAt: "2026-11-02T09:00:00Z",
      endsAt: "2026-11-02T17:00:00Z",
      provisioningStartedAt: "2026-11-01T09:00:00Z",
      issuedAt: "2026-11-01T09:00:01Z",
      failedAt: null,
      failureCode: null,
      createdAt: "2026-11-01T09:00:00Z",
      updatedAt: "2026-11-01T09:00:01Z",
    });
    const inProgressMessage =
      "This reservation access mutation is still being applied. Retrying with the same request identifier is safe.";
    const failure = (reason: ReservationAccessAdministrationError["reason"]) =>
      new ReservationAccessAdministrationError({ reason, message: reason });
    const reservationAccess = () =>
      mutationWithEffects({
        mutation,
        stored: StoredResult.unchanged(AdministrationReservationAccessGrant),
        recovery: reservationAccessRecovery,
        inProgressMessage,
        result,
        withResume: true,
      });

    test.each(["not_found", "invalid_state", "retryable_failure"] as const)(
      "frees the request ID after a %s failure",
      async (reason) => {
        const requestId = newRequestId();
        const { run } = await reservationAccess();

        const failed = await run(requestId, {
          apply: Effect.fail(failure(reason)),
        });
        expect(failureOf(failed)).toEqual(failure(reason));
        expect(await ledgerEntry(requestId)).toBeUndefined();
      }
    );

    test("keeps the claim when recovery failed, until the stale window passes", async () => {
      const requestId = newRequestId();
      const { run, counts } = await reservationAccess();

      await run(requestId, { apply: Effect.fail(failure("recovery_failed")) });
      expect(await ledgerEntry(requestId)).toEqual({ result: null });

      await ageClaim(requestId, 50);
      const waiting = await run(requestId);
      expect(failureOf(waiting)).toEqual(
        new CliMutationInProgress({ requestId, message: inProgressMessage })
      );
      expect(await counts()).toEqual({ applied: 1, resumed: 0, settled: 0 });
    });

    test("resumes the interrupted mutation after the stale window and records it", async () => {
      const requestId = newRequestId();
      const { run, counts } = await reservationAccess();

      await run(requestId, { apply: Effect.fail(failure("recovery_failed")) });
      await ageClaim(requestId, 70);

      expect(await run(requestId)).toEqual(Exit.succeed(result));
      expect(await ledgerEntry(requestId)).toEqual({ result });
      expect(await run(requestId)).toEqual(Exit.succeed(result));
      expect(await counts()).toEqual({ applied: 1, resumed: 1, settled: 2 });
    });

    test.each([
      "not_found",
      "invalid_state",
      "retryable_failure",
      "recovery_failed",
    ] as const)(
      "frees the request ID when a resumed mutation fails with %s",
      async (reason) => {
        const requestId = newRequestId();
        const { run, counts } = await reservationAccess();

        await run(requestId, {
          apply: Effect.fail(failure("recovery_failed")),
        });
        await ageClaim(requestId, 70);
        const failed = await run(requestId, {
          resume: Effect.fail(failure(reason)),
        });

        expect(failureOf(failed)).toEqual(failure(reason));
        expect(await ledgerEntry(requestId)).toBeUndefined();
        expect(await run(requestId)).toEqual(Exit.succeed(result));
        expect(await counts()).toEqual({ applied: 2, resumed: 1, settled: 1 });
      }
    );

    test("fails and keeps the claim when the result can't be recorded", async () => {
      const requestId = newRequestId();
      const { run } = await reservationAccess();
      const restoreCompletion = await failCompletionOf(requestId);

      const failed = await run(requestId);
      await restoreCompletion();

      expect(failureOf(failed)).toBeInstanceOf(CliServiceUnavailable);
      expect(await ledgerEntry(requestId)).toEqual({ result: null });
    });

    test("replays the stored grant and rejects a reused request ID", async () => {
      const requestId = newRequestId();
      const { run, counts } = await reservationAccess();

      await run(requestId);
      expect(await run(requestId)).toEqual(Exit.succeed(result));
      const reused = await run(requestId, {
        mutation: { ...mutation, reservationId: crypto.randomUUID() } as never,
      });

      expect(failureOf(reused)).toBeInstanceOf(CliMutationRejected);
      expect((await counts()).applied).toBe(1);
    });
  });

  describe("standalone access-code creation", () => {
    const attemptId = crypto.randomUUID();
    const mutation: CliStoredMutation = {
      kind: "standalone-access-code",
      request: {
        name: "Synthetic code",
        startsAt: "2026-11-02T10:00",
        endsAt: "2026-11-02T12:00",
      },
    } as CliStoredMutation;
    const stored = Schema.decodeUnknownSync(
      AdministrationStandaloneAccessCodeResult
    )({
      attemptId,
      providerCredentialId: "credential-1",
      name: "Synthetic code",
      startsAt: "2026-11-02T10:00",
      endsAt: "2026-11-02T12:00",
      issuedAt: "2026-11-01T09:00:00Z",
    });
    const created = {
      ...stored,
      outcome: "created" as const,
      pin: "1234567",
    };
    const inProgressMessage =
      "This standalone access-code creation is still being applied. Retrying with the same attempt identifier is safe.";
    const cleanupTarget = {
      attemptId,
      name: "Synthetic code",
    };
    const creation = () =>
      mutationWithEffects({
        mutation,
        stored: standaloneAccessCodeStoredResult,
        recovery: standaloneAccessCodeRecovery,
        inProgressMessage,
        result: created,
      });

    /** Failures that prove no code exists, which free the request ID. */
    const releasingFailures = [
      ["rejected", new CliMutationRejected({ message: "Rejected." })],
      ["unavailable", new CliServiceUnavailable({ message: "Unavailable." })],
      [
        "cleanup required",
        new CliStandaloneAccessCodeCleanupRequired({
          message: "Clean up first.",
          cleanupTarget,
        } as never),
      ],
      [
        "reconciled",
        new CliStandaloneAccessCodeReconciled({ message: "Reconciled." }),
      ],
    ] as const;
    /** Failures after which a code may exist, which keep the claim. */
    const retainingFailures = [
      ["uncertain", new CliMutationUncertain({ message: "Uncertain." })],
      [
        "in progress",
        new CliMutationInProgress({
          requestId: CliMutationRequestId.make(attemptId),
          message: inProgressMessage,
        }),
      ],
    ] as const;

    test.each(releasingFailures)(
      "frees the request ID when creation is %s",
      async (_, failure) => {
        const requestId = newRequestId();
        const { run } = await creation();

        const failed = await run(requestId, { apply: Effect.fail(failure) });
        expect(failureOf(failed)).toBe(failure);
        expect(await ledgerEntry(requestId)).toBeUndefined();
      }
    );

    test.each(retainingFailures)(
      "keeps the claim when creation is %s",
      async (_, failure) => {
        const requestId = newRequestId();
        const { run } = await creation();

        const failed = await run(requestId, { apply: Effect.fail(failure) });
        expect(failureOf(failed)).toBe(failure);
        expect(await ledgerEntry(requestId)).toEqual({ result: null });
      }
    );

    test("waits within the stale window, then creates again under the same claim", async () => {
      const requestId = newRequestId();
      const { run, counts } = await creation();

      await run(requestId, {
        apply: Effect.fail(new CliMutationUncertain({ message: "Uncertain." })),
      });
      await ageClaim(requestId, 50);
      const waiting = await run(requestId);
      expect(failureOf(waiting)).toEqual(
        new CliMutationInProgress({ requestId, message: inProgressMessage })
      );

      await ageClaim(requestId, 70);
      expect(await run(requestId)).toEqual(Exit.succeed(created));
      expect(await ledgerEntry(requestId)).toEqual({ result: stored });
      expect(await counts()).toEqual({ applied: 2, resumed: 0, settled: 1 });
    });

    test.each(releasingFailures)(
      "frees the request ID when creation resumed after the stale window is %s",
      async (_, failure) => {
        const requestId = newRequestId();
        const { run, counts } = await creation();

        await run(requestId, {
          apply: Effect.fail(
            new CliMutationUncertain({ message: "Uncertain." })
          ),
        });
        await ageClaim(requestId, 70);
        const failed = await run(requestId, { apply: Effect.fail(failure) });

        expect(failureOf(failed)).toBe(failure);
        expect(await ledgerEntry(requestId)).toBeUndefined();
        expect(await run(requestId)).toEqual(Exit.succeed(created));
        expect(await counts()).toEqual({ applied: 3, resumed: 0, settled: 1 });
      }
    );

    test.each(retainingFailures)(
      "keeps the claim when creation resumed after the stale window is %s",
      async (_, failure) => {
        const requestId = newRequestId();
        const { run, counts } = await creation();

        await run(requestId, {
          apply: Effect.fail(
            new CliMutationUncertain({ message: "Uncertain." })
          ),
        });
        await ageClaim(requestId, 70);
        const failed = await run(requestId, { apply: Effect.fail(failure) });

        expect(failureOf(failed)).toBe(failure);
        expect(await ledgerEntry(requestId)).toEqual({ result: null });
        const waiting = await run(requestId);
        expect(failureOf(waiting)).toEqual(
          new CliMutationInProgress({ requestId, message: inProgressMessage })
        );
        expect(await counts()).toEqual({ applied: 2, resumed: 0, settled: 0 });
      }
    );

    test("dies, despite best-effort recording, when the claim vanished before its result is recorded", async () => {
      const requestId = newRequestId();
      const { run } = await creation();

      const vanished = await run(requestId, {
        apply: deleteClaim(requestId).pipe(Effect.as(created)),
      });

      expect(Exit.isFailure(vanished) && Cause.hasDies(vanished.cause)).toBe(
        true
      );
    });

    test("still answers, and frees the request ID, when the result can't be recorded", async () => {
      const requestId = newRequestId();
      const { run } = await creation();
      const restoreCompletion = await failCompletionOf(requestId);

      const answered = await run(requestId);
      await restoreCompletion();

      expect(answered).toEqual(Exit.succeed(created));
      expect(await ledgerEntry(requestId)).toBeUndefined();
    });

    test("stores the code without its PIN and replays it as already created", async () => {
      const requestId = newRequestId();
      const { run, counts } = await creation();

      expect(await run(requestId)).toEqual(Exit.succeed(created));
      expect(await ledgerEntry(requestId)).toEqual({ result: stored });
      expect(await run(requestId)).toEqual(
        Exit.succeed({ ...stored, outcome: "already-created" })
      );
      expect((await counts()).applied).toBe(1);
    });

    test("rejects a reused attempt ID", async () => {
      const requestId = newRequestId();
      const { run } = await creation();

      await run(requestId);
      const reused = await run(requestId, {
        mutation: {
          ...mutation,
          providerCredentialRemovedAttemptId: crypto.randomUUID(),
        } as never,
      });
      expect(failureOf(reused)).toBeInstanceOf(CliMutationRejected);
    });
  });
});
