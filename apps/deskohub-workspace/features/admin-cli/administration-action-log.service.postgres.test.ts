import "@/shared/testing/workspace-test-env";

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  type AdministrationChannel,
  CliSessionId,
  type CurrentAdministrationCaller,
} from "@deskohub/workspace-admin-api";
import { Effect, Layer } from "effect";
import { cliSessions } from "@/db/schema";
import type { AdministratorAccountActor } from "@/features/administrators/account-role";
import { AdministratorAssistantConnections } from "@/features/administrators/backend/administrator-assistant-connections.service";
import { workspaceFixtures } from "@/shared/testing/workspace-fixtures.test-utils";
import { connectWorkspacePostgresTestDatabase } from "@/shared/testing/workspace-postgres-test-database.test-utils";
import {
  type AdministrationActionEnd,
  AdministrationActionLog,
} from "./administration-action-log.service";

const testDatabase = await connectWorkspacePostgresTestDatabase();

describe.skipIf(!testDatabase)(
  "administration action log on disposable Postgres",
  () => {
    if (!testDatabase) return;
    const sessionId = CliSessionId.make(crypto.randomUUID());
    let administrator: AdministratorAccountActor;
    let assistantChannel: AdministrationChannel;

    const services = Layer.mergeAll(
      AdministrationActionLog.Default,
      AdministratorAssistantConnections.Default
    ).pipe(Layer.provide(testDatabase.layer));
    const run = <A, E>(
      effect: Effect.Effect<
        A,
        E,
        AdministrationActionLog | AdministratorAssistantConnections
      >
    ) => Effect.runPromise(effect.pipe(Effect.provide(services)));

    beforeAll(async () => {
      administrator = await Effect.runPromise(
        workspaceFixtures(testDatabase.db).account("action-log", {
          roles: ["administrator"],
        })
      );
      await Effect.runPromise(
        testDatabase.db.insert(cliSessions).values({
          id: sessionId,
          approvedByAccountId: administrator.accountId,
          approvedByAccountEmail: administrator.email,
          tokenHash: `${crypto.randomUUID().replaceAll("-", "")}${"a".repeat(11)}`,
          clientName: "action log test client",
          cliVersion: "1.0.0",
          buildTarget: "development",
          createdAt: Temporal.Now.instant(),
          lastUsedAt: Temporal.Now.instant(),
        })
      );
      assistantChannel = await run(
        AdministratorAssistantConnections.pipe(
          Effect.flatMap((connections) =>
            connections.connect({
              actor: administrator,
              oauthClientId: `https://assistant-${crypto.randomUUID()}.example/client.json`,
              clientName: "Synthetic assistant",
            })
          )
        )
      );
    });

    afterAll(async () => {
      await testDatabase.pool.query(
        "delete from administration_actions where cli_session_id = $1 or assistant_connection_id = $2",
        [
          sessionId,
          assistantChannel._tag === "AssistantConnection"
            ? assistantChannel.connectionId
            : null,
        ]
      );
      await testDatabase.pool.query("delete from cli_sessions where id = $1", [
        sessionId,
      ]);
      await testDatabase.pool.query(
        "delete from administrator_assistant_connections where approved_by_account_email = $1",
        [administrator.email]
      );
      await Effect.runPromise(
        workspaceFixtures(testDatabase.db).deleteAccounts([administrator])
      );
    });

    const caller = (
      channel: AdministrationChannel
    ): CurrentAdministrationCaller["Service"] => ({
      actor: administrator,
      channel,
    });

    const readAction = async (id: string) =>
      (
        await testDatabase.pool.query<{
          operation: string;
          outcome: string;
          failure: string | null;
          actor_account_id: string | null;
          actor_account_email: string;
          cli_session_id: string | null;
          assistant_connection_id: string | null;
          finished_at: Date | null;
        }>(
          `select operation, outcome, failure, actor_account_id,
             actor_account_email, cli_session_id, assistant_connection_id,
             finished_at
           from administration_actions where id = $1`,
          [id]
        )
      ).rows[0];

    const startAndFinish = (
      channel: AdministrationChannel,
      ends: ReadonlyArray<AdministrationActionEnd>
    ) =>
      run(
        Effect.gen(function* () {
          const log = yield* AdministrationActionLog;
          const id = yield* log.start({
            operation: "administration.renameSession",
            caller: caller(channel),
          });
          for (const end of ends) {
            yield* log.finish(id, end);
          }
          return id;
        })
      );

    test("records a CLI session's action before and after it runs", async () => {
      const started = await startAndFinish(
        { _tag: "CliSession", sessionId },
        []
      );
      expect(await readAction(started)).toMatchObject({
        operation: "administration.renameSession",
        outcome: "started",
        failure: null,
        actor_account_id: administrator.accountId,
        actor_account_email: administrator.email,
        cli_session_id: sessionId,
        assistant_connection_id: null,
        finished_at: null,
      });

      const finished = await startAndFinish({ _tag: "CliSession", sessionId }, [
        { outcome: "failed", failure: "CliResourceNotFound" },
        { outcome: "succeeded" },
      ]);
      // The first end recorded is the one that stays.
      expect(await readAction(finished)).toMatchObject({
        outcome: "failed",
        failure: "CliResourceNotFound",
      });
    });

    test("records an assistant's action under its connection", async () => {
      const id = await startAndFinish(assistantChannel, [
        { outcome: "replayed" },
      ]);

      expect(await readAction(id)).toMatchObject({
        outcome: "replayed",
        cli_session_id: null,
        assistant_connection_id:
          assistantChannel._tag === "AssistantConnection"
            ? assistantChannel.connectionId
            : undefined,
      });
    });

    test("keeps the channel while actions reference it", async () => {
      await startAndFinish(assistantChannel, [{ outcome: "succeeded" }]);

      await expect(
        testDatabase.pool.query(
          "delete from administrator_assistant_connections where approved_by_account_email = $1",
          [administrator.email]
        )
      ).rejects.toMatchObject({ code: "23503" });
    });
  }
);
