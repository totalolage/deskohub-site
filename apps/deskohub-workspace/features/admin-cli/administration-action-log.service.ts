import type {
  AdministrationOperationReference,
  CurrentAdministrationCaller,
} from "@deskohub/workspace-admin-api";
import { and, eq } from "drizzle-orm";
import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import { Context, Effect, Layer, Match } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import { administrationActions } from "@/db/schema";
import type { AdministrationActionOutcome } from "./administration-action";

type AdministrationActionId = string;

/** How a recorded request ended; a `failed` one names its error. */
export type AdministrationActionEnd =
  | {
      readonly outcome: Exclude<
        AdministrationActionOutcome,
        "started" | "failed"
      >;
    }
  | { readonly outcome: "failed"; readonly failure: string };

interface IAdministrationActionLog {
  /** Records that a caller started an operation, before it runs. */
  readonly start: (input: {
    readonly operation: AdministrationOperationReference;
    readonly caller: CurrentAdministrationCaller["Service"];
  }) => Effect.Effect<AdministrationActionId, EffectDrizzleQueryError>;
  /** Records how a started request ended. */
  readonly finish: (
    id: AdministrationActionId,
    end: AdministrationActionEnd
  ) => Effect.Effect<void, EffectDrizzleQueryError>;
}

export class AdministrationActionLog extends Context.Service<
  AdministrationActionLog,
  IAdministrationActionLog
>()("@deskohub-workspace/admin-cli/AdministrationActionLog") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const { db } = yield* WorkspaceDatabase;

      const start = Effect.fn("AdministrationActionLog.start")(function* ({
        operation,
        caller,
      }: Parameters<IAdministrationActionLog["start"]>[0]) {
        const [row] = yield* db
          .insert(administrationActions)
          .values({
            operation,
            outcome: "started",
            actorAccountId: caller.actor.accountId,
            actorAccountEmail: caller.actor.email,
            ...channelColumns(caller.channel),
          })
          .returning({ id: administrationActions.id });
        return row
          ? row.id
          : yield* Effect.die(
              new Error("Administration action insert returned no row.")
            );
      });

      const finish = Effect.fn("AdministrationActionLog.finish")(
        (id: AdministrationActionId, end: AdministrationActionEnd) =>
          db
            .update(administrationActions)
            .set({
              outcome: end.outcome,
              failure: end.outcome === "failed" ? end.failure : null,
              finishedAt: Temporal.Now.instant(),
            })
            .where(
              and(
                eq(administrationActions.id, id),
                eq(administrationActions.outcome, "started")
              )
            )
            .pipe(Effect.asVoid)
      );

      return { start, finish } satisfies IAdministrationActionLog;
    })
  );

  static Live = this.Default.pipe(Layer.provide(WorkspaceDatabase.Default));
}

const channelColumns = (
  channel: CurrentAdministrationCaller["Service"]["channel"]
) =>
  Match.value(channel).pipe(
    Match.tagsExhaustive({
      CliSession: ({ sessionId }) => ({ cliSessionId: sessionId }),
      AssistantConnection: ({ connectionId }) => ({
        assistantConnectionId: connectionId,
      }),
    })
  );
