import "@/shared/testing/workspace-test-env";

import { afterAll, describe, expect, test } from "bun:test";
import { Effect, Layer } from "effect";
import type { AdministratorAccountActor } from "@/features/administrators/account-role";
import { connectWorkspacePostgresTestDatabase } from "@/shared/testing/workspace-postgres-test-database.test-utils";
import {
  deleteTestAccounts,
  insertTestAdministrator,
} from "@/shared/testing/workspace-test-accounts.test-utils";
import { AdministratorAssistantConnections } from "./administrator-assistant-connections.service";

const testDatabase = await connectWorkspacePostgresTestDatabase();

describe.skipIf(!testDatabase)(
  "administrator assistant connections on disposable Postgres",
  () => {
    if (!testDatabase) return;
    const administrators: AdministratorAccountActor[] = [];
    const clientId = `https://assistant-${crypto.randomUUID()}.example/client.json`;

    afterAll(async () => {
      await deleteTestAccounts(testDatabase, administrators);
      await testDatabase.pool.query(
        "delete from administrator_assistant_connections where oauth_client_id like $1",
        [`${clientId}%`]
      );
    });

    const insertAdministrator = async () => {
      const administrator = await insertTestAdministrator(
        testDatabase,
        "assistant-connection"
      );
      administrators.push(administrator);
      return administrator;
    };

    const connect = (
      actor: AdministratorAccountActor,
      oauthClientId = clientId,
      clientName = "Synthetic assistant"
    ) =>
      Effect.runPromise(
        AdministratorAssistantConnections.pipe(
          Effect.flatMap((connections) =>
            connections.connect({ actor, oauthClientId, clientName })
          ),
          Effect.provide(
            AdministratorAssistantConnections.Default.pipe(
              Layer.provide(testDatabase.layer)
            )
          )
        )
      );

    const readConnection = async (id: string) =>
      (
        await testDatabase.pool.query<{
          approved_by_account_id: string | null;
          approved_by_account_email: string;
          client_name: string;
          last_used_ms: number;
        }>(
          `select approved_by_account_id, approved_by_account_email,
             client_name,
             (extract(epoch from last_used_at) * 1000)::float8 as last_used_ms
           from administrator_assistant_connections where id = $1`,
          [id]
        )
      ).rows[0];

    test("keeps one connection per administrator and assistant", async () => {
      const administrator = await insertAdministrator();
      const other = await insertAdministrator();

      const first = await connect(administrator);
      const again = await connect(administrator);
      const otherClient = await connect(administrator, `${clientId}#other`);
      const otherAdministrator = await connect(other);

      expect(first).toMatchObject({
        _tag: "AssistantConnection",
        oauthClientId: clientId,
      });
      expect(again.connectionId).toBe(first.connectionId);
      expect(otherClient.connectionId).not.toBe(first.connectionId);
      expect(otherAdministrator.connectionId).not.toBe(first.connectionId);
      expect(await readConnection(first.connectionId)).toMatchObject({
        approved_by_account_id: administrator.accountId,
        approved_by_account_email: administrator.email,
      });
    });

    test("creates one connection when its first uses race", async () => {
      const administrator = await insertAdministrator();

      const [first, second] = await Promise.all([
        connect(administrator),
        connect(administrator),
      ]);

      expect(second.connectionId).toBe(first.connectionId);
    });

    test("writes the last use at most every five minutes", async () => {
      const administrator = await insertAdministrator();
      const { connectionId } = await connect(administrator);
      const recordedUse = (await readConnection(connectionId))!.last_used_ms;

      await connect(administrator, clientId, "Renamed assistant");
      expect(await readConnection(connectionId)).toMatchObject({
        client_name: "Synthetic assistant",
        last_used_ms: recordedUse,
      });

      await testDatabase.pool.query(
        `update administrator_assistant_connections
         set created_at = created_at - interval '6 minutes',
           last_used_at = last_used_at - interval '6 minutes'
         where id = $1`,
        [connectionId]
      );
      await connect(administrator, clientId, "Renamed assistant");
      const refreshed = await readConnection(connectionId);
      expect(refreshed?.client_name).toBe("Renamed assistant");
      // Moved back six minutes, then forward to now.
      expect(refreshed!.last_used_ms).toBeGreaterThan(recordedUse - 6 * 60_000);
    });

    test("keeps the connection and its email snapshot when the account is deleted", async () => {
      const administrator = await insertAdministrator();
      const { connectionId } = await connect(administrator);

      await deleteTestAccounts(testDatabase, [administrator]);

      expect(await readConnection(connectionId)).toMatchObject({
        approved_by_account_id: null,
        approved_by_account_email: administrator.email,
      });
    });
  }
);
