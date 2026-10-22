import type {
  AdministrationChannel,
  AdministratorActor,
} from "@deskohub/workspace-admin-api";
import { and, eq, lt } from "drizzle-orm";
import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import { Context, Effect, Layer } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import { administratorAssistantConnections } from "@/db/schema";
import { sensitiveDatabaseParameter } from "@/shared/backend/logging/database-query-parameter-classifier";

type AssistantConnectionChannel = Extract<
  AdministrationChannel,
  { readonly _tag: "AssistantConnection" }
>;

/** How often a connection's last use is written, as for CLI sessions. */
const lastUsedWriteIntervalMinutes = 5;

interface IAdministratorAssistantConnections {
  /**
   * The channel of an administrator's call through an AI assistant: the
   * connection for the account and the assistant's OAuth client, created
   * on its first use. A later use refreshes the client name and the last
   * use at most every five minutes.
   */
  readonly connect: (input: {
    readonly actor: AdministratorActor;
    readonly oauthClientId: string;
    readonly clientName: string;
  }) => Effect.Effect<AssistantConnectionChannel, EffectDrizzleQueryError>;
}

export class AdministratorAssistantConnections extends Context.Service<
  AdministratorAssistantConnections,
  IAdministratorAssistantConnections
>()("@deskohub-workspace/administrators/AdministratorAssistantConnections") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const { db } = yield* WorkspaceDatabase;

      const connect = Effect.fn("AdministratorAssistantConnections.connect")(
        function* (
          input: Parameters<IAdministratorAssistantConnections["connect"]>[0]
        ) {
          const now = Temporal.Now.instant();
          const isConnection = and(
            eq(
              administratorAssistantConnections.approvedByAccountId,
              input.actor.accountId
            ),
            eq(
              administratorAssistantConnections.oauthClientId,
              input.oauthClientId
            )
          );
          const toChannel = ({
            id,
          }: {
            readonly id: AssistantConnectionChannel["connectionId"];
          }): AssistantConnectionChannel => ({
            _tag: "AssistantConnection",
            connectionId: id,
            oauthClientId: input.oauthClientId,
          });

          const [touched] = yield* db
            .update(administratorAssistantConnections)
            .set({ lastUsedAt: now, clientName: input.clientName })
            .where(
              and(
                isConnection,
                lt(
                  administratorAssistantConnections.lastUsedAt,
                  now.subtract({ minutes: lastUsedWriteIntervalMinutes })
                )
              )
            )
            .returning({ id: administratorAssistantConnections.id });
          if (touched) return toChannel(touched);

          const [existing] = yield* findConnection(isConnection);
          if (existing) return toChannel(existing);

          const [created] = yield* db
            .insert(administratorAssistantConnections)
            .values({
              approvedByAccountId: input.actor.accountId,
              approvedByAccountEmail: sensitiveDatabaseParameter(
                input.actor.email
              ),
              oauthClientId: input.oauthClientId,
              clientName: input.clientName,
              createdAt: now,
              lastUsedAt: now,
            })
            .onConflictDoNothing()
            .returning({ id: administratorAssistantConnections.id });
          if (created) return toChannel(created);

          // A concurrent first use created it; connections are never deleted.
          const [concurrent] = yield* findConnection(isConnection);
          return concurrent
            ? toChannel(concurrent)
            : yield* Effect.die(
                new Error("Administrator assistant connection disappeared.")
              );
        }
      );

      const findConnection = (isConnection: ReturnType<typeof and>) =>
        db
          .select({ id: administratorAssistantConnections.id })
          .from(administratorAssistantConnections)
          .where(isConnection)
          .limit(1);

      return { connect } satisfies IAdministratorAssistantConnections;
    })
  );

  static Live = this.Default.pipe(Layer.provide(WorkspaceDatabase.Default));
}
