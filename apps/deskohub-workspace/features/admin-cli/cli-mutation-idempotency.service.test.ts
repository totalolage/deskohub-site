import "@/shared/testing/workspace-test-env";

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  type AdministrationAssistantConnectionIdType,
  AdministrationCampaignAudience,
  AdministrationLegacyUsername,
  CliMutationRequestId,
  type CliMutationRequestIdType,
  CliSessionId,
  digestCliAuthenticationSecret,
  makeCliAuthenticationSecret,
} from "@deskohub/workspace-admin-api";
import { NodeCrypto } from "@effect/platform-node";
import { Effect, Exit, Layer, Ref, Schema } from "effect";
import { cliSessions } from "@/db/schema";
import type { AdministratorAccountActor } from "@/features/administrators/account-role";
import { AdministratorAssistantConnections } from "@/features/administrators/backend/administrator-assistant-connections.service";
import { CampaignService } from "@/features/email-campaigns/backend/campaign.service";
import { CampaignAudienceService } from "@/features/email-campaigns/backend/campaign-audience.service";
import { connectWorkspacePostgresTestDatabase } from "@/shared/testing/workspace-postgres-test-database.test-utils";
import {
  deleteTestAccounts,
  insertTestAdministrator,
} from "@/shared/testing/workspace-test-accounts.test-utils";
import { CurrentAdministrationAction } from "./administration-action";
import {
  type AdministrationMutationScope,
  CliMutationIdempotency,
} from "./cli-mutation-idempotency.service";

const testDatabase = await connectWorkspacePostgresTestDatabase();

describe.skipIf(!testDatabase)("CLI mutations on disposable Postgres", () => {
  if (!testDatabase) return;
  const sessionId = CliSessionId.make(crypto.randomUUID());
  const titlePrefix = `Ledger crash ${crypto.randomUUID()}`;
  const failCompletion = `fail_cli_mutation_completion_${crypto.randomUUID().replaceAll("-", "_")}`;

  beforeAll(() =>
    Effect.runPromise(
      makeCliAuthenticationSecret().pipe(
        Effect.flatMap(digestCliAuthenticationSecret),
        Effect.flatMap((tokenHash) =>
          testDatabase.db.insert(cliSessions).values({
            id: sessionId,
            approvedBy: AdministrationLegacyUsername.make("operator"),
            tokenHash,
            clientName: "ledger crash test client",
            cliVersion: "1.0.0",
            buildTarget: "development",
            createdAt: Temporal.Now.instant(),
            lastUsedAt: Temporal.Now.instant(),
          })
        ),
        Effect.provide(NodeCrypto.layer)
      )
    )
  );

  afterAll(async () => {
    await testDatabase.pool.query(
      `drop trigger if exists ${failCompletion} on cli_mutation_requests`
    );
    await testDatabase.pool.query(`drop function if exists ${failCompletion}`);
    // Deleting the session deletes its mutation requests.
    await testDatabase.pool.query("delete from cli_sessions where id = $1", [
      sessionId,
    ]);
    await testDatabase.pool.query(
      "delete from email_campaigns where title like $1",
      [`${titlePrefix}%`]
    );
    await testDatabase.pool.query(
      "delete from email_campaign_audiences where title like $1",
      [`${titlePrefix}%`]
    );
  });

  const services = Layer.mergeAll(
    CliMutationIdempotency.Default,
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
    Effect.gen(function* () {
      const ledger = yield* CliMutationIdempotency;
      const audiences = yield* CampaignAudienceService;
      const campaigns = yield* CampaignService;
      const filter = {
        attribute: "locale",
        _tag: "Condition",
        operator: "anyOf",
        value: ["cs-CZ"],
      } as const;
      return yield* ledger.applyOnce({
        request: {
          scope: { _tag: "CliSession", sessionId },
          requestId,
          mutation: {
            kind: "campaign-audience-create",
            audience: { title, filter },
          },
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
    }).pipe(Effect.provide(services));

  const countRows = async (table: string, title: string) => {
    const result = (await testDatabase.pool.query(
      `select count(*)::int as count from ${table} where title = $1`,
      [title]
    )) as { rows: Array<{ count: number }> };
    return result.rows[0]?.count;
  };

  const countLedgerEntries = async (requestId: CliMutationRequestIdType) => {
    const result = (await testDatabase.pool.query(
      "select count(*)::int as count from cli_mutation_requests where session_id = $1 and request_id = $2",
      [sessionId, requestId]
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
    expect(await countLedgerEntries(requestId)).toBe(0);

    const retried = await Effect.runPromise(
      createAudienceWithDraft(title, requestId)
    );
    const replayed = await Effect.runPromise(
      createAudienceWithDraft(title, requestId)
    );

    expect(retried.title).toBe(title);
    expect(replayed).toEqual(retried);
    expect(await countRows("email_campaign_audiences", title)).toBe(1);
    expect(await countRows("email_campaigns", title)).toBe(1);
  };

  test("leaves nothing behind when a crash follows the mutation's writes", async () => {
    const title = `${titlePrefix} after apply`;
    const requestId = CliMutationRequestId.make(crypto.randomUUID());

    const failed = await Effect.runPromiseExit(
      createAudienceWithDraft(
        title,
        requestId,
        Effect.die(new Error("Process crashed after the mutation's writes"))
      )
    );

    await expectRecoverable(title, requestId, failed);
  });

  test("rolls the mutation back when storing its result fails", async () => {
    const title = `${titlePrefix} at completion`;
    const requestId = CliMutationRequestId.make(crypto.randomUUID());
    await testDatabase.pool.query(
      `create function ${failCompletion}() returns trigger language plpgsql as $$
        begin raise exception 'Injected CLI mutation completion failure'; end
      $$`
    );
    await testDatabase.pool.query(
      `create trigger ${failCompletion} before update on cli_mutation_requests
        for each row when (new.request_id = '${requestId}' and new.result is not null)
        execute function ${failCompletion}()`
    );

    const failed = await Effect.runPromiseExit(
      createAudienceWithDraft(title, requestId)
    );
    await testDatabase.pool.query(
      `drop trigger ${failCompletion} on cli_mutation_requests`
    );

    await expectRecoverable(title, requestId, failed);
  });
});

describe.skipIf(!testDatabase)(
  "assistant connection mutations on disposable Postgres",
  () => {
    if (!testDatabase) return;
    const sessionId = CliSessionId.make(crypto.randomUUID());
    const oauthClientId = `https://assistant-${crypto.randomUUID()}.example/client.json`;
    let administrator: AdministratorAccountActor;
    let connectionId: AdministrationAssistantConnectionIdType;

    beforeAll(async () => {
      administrator = await insertTestAdministrator(
        testDatabase,
        "ledger-assistant"
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
          clientName: "ledger scope test client",
          cliVersion: "1.0.0",
          buildTarget: "development",
          createdAt: Temporal.Now.instant(),
          lastUsedAt: Temporal.Now.instant(),
        })
      );
      ({ connectionId } = await Effect.runPromise(
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
      ));
    });

    afterAll(async () => {
      // Deleting the channels deletes their mutation requests.
      await testDatabase.pool.query("delete from cli_sessions where id = $1", [
        sessionId,
      ]);
      await testDatabase.pool.query(
        "delete from administrator_assistant_connections where id = $1",
        [connectionId]
      );
      await deleteTestAccounts(testDatabase, [administrator]);
    });

    const assistantScope = (): AdministrationMutationScope => ({
      _tag: "AssistantConnection",
      connectionId,
    });
    const sessionScope: AdministrationMutationScope = {
      _tag: "CliSession",
      sessionId,
    };
    const audienceMutation = (title: string) =>
      ({
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
      }) as const;
    const audienceResult = (title: string) =>
      Schema.decodeUnknownSync(AdministrationCampaignAudience)({
        id: crypto.randomUUID(),
        title,
        filter: audienceMutation(title).audience.filter,
        archivedAt: null,
        createdAt: "2026-10-22T08:00:00Z",
        updatedAt: "2026-10-22T08:00:00Z",
      });

    const runLedger = <A, E>(
      operation: (
        ledger: CliMutationIdempotency["Service"]
      ) => Effect.Effect<A, E>
    ) =>
      Effect.runPromise(
        CliMutationIdempotency.pipe(
          Effect.flatMap(operation),
          Effect.provide(
            CliMutationIdempotency.Default.pipe(
              Layer.provide(testDatabase.layer)
            )
          )
        )
      );

    test("replays, waits on and rejects an assistant's request IDs", async () => {
      const requestId = CliMutationRequestId.make(crypto.randomUUID());
      const request = {
        scope: assistantScope(),
        requestId,
        mutation: audienceMutation("Assistant audience"),
      };
      const result = audienceResult("Assistant audience");
      const replays = await Effect.runPromise(Ref.make(0));
      const claimInAction = (claimed: typeof request) =>
        runLedger((ledger) =>
          ledger.claim(claimed).pipe(
            Effect.provideService(CurrentAdministrationAction, {
              markReplayed: Ref.update(replays, (count) => count + 1),
            })
          )
        );

      expect(await claimInAction(request)).toEqual({ kind: "claimed" });
      expect(await claimInAction(request)).toEqual({ kind: "in-progress" });
      await runLedger((ledger) => ledger.complete({ ...request, result }));
      expect(await claimInAction(request)).toEqual({
        kind: "completed",
        result,
      });
      expect(
        await claimInAction({
          ...request,
          mutation: audienceMutation("Different audience"),
        })
      ).toEqual({ kind: "mismatch" });
      expect(await Effect.runPromise(Ref.get(replays))).toBe(1);
    });

    test("keeps a CLI session's and an assistant's same request ID apart", async () => {
      const requestId = CliMutationRequestId.make(crypto.randomUUID());
      const cliRequest = {
        scope: sessionScope,
        requestId,
        mutation: audienceMutation("CLI audience"),
      };
      const assistantRequest = {
        scope: assistantScope(),
        requestId,
        mutation: audienceMutation("Assistant audience"),
      };

      expect(await runLedger((ledger) => ledger.claim(cliRequest))).toEqual({
        kind: "claimed",
      });
      expect(
        await runLedger((ledger) => ledger.claim(assistantRequest))
      ).toEqual({ kind: "claimed" });

      const cliResult = audienceResult("CLI audience");
      await runLedger((ledger) =>
        ledger.complete({ ...cliRequest, result: cliResult })
      );
      expect(await runLedger((ledger) => ledger.claim(cliRequest))).toEqual({
        kind: "completed",
        result: cliResult,
      });
      expect(
        await runLedger((ledger) => ledger.claim(assistantRequest))
      ).toEqual({ kind: "in-progress" });

      await runLedger((ledger) => ledger.release(assistantRequest));
      expect(await runLedger((ledger) => ledger.claim(cliRequest))).toEqual({
        kind: "completed",
        result: cliResult,
      });
    });
  }
);
