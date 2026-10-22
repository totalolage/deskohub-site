import {
  type AdministrationAssistantConnectionIdType,
  AdministrationCampaignAudience,
  AdministrationCampaignDetail,
  type AdministrationChannel,
  AdministrationDiscountMutationResult,
  AdministrationReservationAccessGrant,
  AdministrationStandaloneAccessCodeResult,
  CliMutationInProgress,
  CliMutationRejected,
  type CliMutationRequestIdType,
  type CliSessionIdType,
} from "@deskohub/workspace-admin-api";
import { and, eq, isNull, lte } from "drizzle-orm";
import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import { Context, Effect, Layer, Match, Option, Schema } from "effect";
import type { SqlError } from "effect/unstable/sql/SqlError";
import { WorkspaceDatabase } from "@/db/database.service";
import {
  type CliStoredMutation,
  type CliStoredMutationResult,
  cliMutationRequests,
} from "@/db/schema";
import { CurrentAdministrationAction } from "./administration-action";

type CliMutationClaim =
  | { readonly kind: "claimed" }
  | {
      readonly kind: "completed";
      readonly result: CliStoredMutationResult;
    }
  | { readonly kind: "in-progress" }
  | { readonly kind: "mismatch" };

/**
 * Where a request ID is unique and its result replays: the channel the
 * administrator called through.
 */
export type AdministrationMutationScope =
  | {
      readonly _tag: "CliSession";
      readonly sessionId: CliSessionIdType;
    }
  | {
      readonly _tag: "AssistantConnection";
      readonly connectionId: AdministrationAssistantConnectionIdType;
    };

/** The ledger scope of an administration caller's channel. */
export const mutationScopeOf = (
  channel: AdministrationChannel
): AdministrationMutationScope =>
  Match.value(channel).pipe(
    Match.tagsExhaustive({
      CliSession: ({ sessionId }) => ({
        _tag: "CliSession" as const,
        sessionId,
      }),
      AssistantConnection: ({ connectionId }) => ({
        _tag: "AssistantConnection" as const,
        connectionId,
      }),
    })
  );

const isInScope = (scope: AdministrationMutationScope) =>
  Match.value(scope).pipe(
    Match.tagsExhaustive({
      CliSession: ({ sessionId }) =>
        eq(cliMutationRequests.sessionId, sessionId),
      AssistantConnection: ({ connectionId }) =>
        eq(cliMutationRequests.assistantConnectionId, connectionId),
    })
  );

const scopeColumns = (scope: AdministrationMutationScope) =>
  Match.value(scope).pipe(
    Match.tagsExhaustive({
      CliSession: ({ sessionId }) => ({ sessionId }),
      AssistantConnection: ({ connectionId }) => ({
        assistantConnectionId: connectionId,
      }),
    })
  );

type CliMutationRequest = {
  readonly scope: AdministrationMutationScope;
  readonly requestId: CliMutationRequestIdType;
  readonly mutation: CliStoredMutation;
};

type CliDatabaseMutation<A extends CliStoredMutationResult, E, R> = {
  readonly request: CliMutationRequest;
  readonly result: Schema.Decoder<A>;
  /** Writes only through the Workspace database; it joins the transaction. */
  readonly apply: Effect.Effect<A, E, R>;
};

interface ICliMutationIdempotency {
  /**
   * Applies a database-only CLI mutation at most once per scope and
   * request ID. The claim, the mutation and the stored result commit in
   * one transaction, so a failure or crash anywhere leaves no trace and
   * the request ID free for a retry. A retry after the commit replays the
   * stored result; a concurrent retry waits on the claim's row until the
   * first commits or rolls back.
   */
  readonly applyOnce: <A extends CliStoredMutationResult, E, R>(
    mutation: CliDatabaseMutation<A, E, R>
  ) => Effect.Effect<
    A,
    | E
    | CliMutationInProgress
    | CliMutationRejected
    | EffectDrizzleQueryError
    | Schema.SchemaError
    | SqlError,
    R
  >;
  readonly claim: (
    request: CliMutationRequest
  ) => Effect.Effect<
    CliMutationClaim,
    EffectDrizzleQueryError | Schema.SchemaError
  >;
  readonly complete: (
    request: CliMutationRequest & {
      readonly result: CliStoredMutationResult;
    }
  ) => Effect.Effect<void, EffectDrizzleQueryError>;
  readonly release: (
    request: CliMutationRequest
  ) => Effect.Effect<void, EffectDrizzleQueryError>;
  readonly reclaimStale: (
    request: CliMutationRequest & {
      readonly reclaimedAt: Temporal.Instant;
      readonly staleBefore: Temporal.Instant;
    }
  ) => Effect.Effect<boolean, EffectDrizzleQueryError>;
}

export class CliMutationIdempotency extends Context.Service<
  CliMutationIdempotency,
  ICliMutationIdempotency
>()("@deskohub-workspace/admin-cli/CliMutationIdempotency") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const { db } = yield* WorkspaceDatabase;

      const claim = Effect.fn("CliMutationIdempotency.claim")(function* (
        request: CliMutationRequest
      ) {
        const inserted = yield* db
          .insert(cliMutationRequests)
          .values({
            ...scopeColumns(request.scope),
            requestId: request.requestId,
            mutation: request.mutation,
          })
          .onConflictDoNothing()
          .returning({ requestId: cliMutationRequests.requestId });
        if (inserted.length > 0) {
          return { kind: "claimed" } as const;
        }

        const rows = yield* db
          .select({ result: cliMutationRequests.result })
          .from(cliMutationRequests)
          .where(
            and(
              isInScope(request.scope),
              eq(cliMutationRequests.requestId, request.requestId),
              eq(cliMutationRequests.mutation, request.mutation)
            )
          )
          .limit(1);
        const row = rows[0];
        if (!row) return { kind: "mismatch" } as const;
        if (row.result === null) return { kind: "in-progress" } as const;

        yield* Effect.serviceOption(CurrentAdministrationAction).pipe(
          Effect.flatMap(
            Option.match({
              onNone: () => Effect.void,
              onSome: (action) => action.markReplayed,
            })
          )
        );

        const result = yield* Schema.decodeUnknownEffect(
          Schema.Union([
            AdministrationDiscountMutationResult,
            AdministrationReservationAccessGrant,
            AdministrationStandaloneAccessCodeResult,
            AdministrationCampaignAudience,
            AdministrationCampaignDetail,
          ])
        )(row.result);
        return { kind: "completed", result } as const;
      });

      const complete = Effect.fn("CliMutationIdempotency.complete")(
        (
          request: CliMutationRequest & {
            readonly result: CliStoredMutationResult;
          }
        ) =>
          db
            .update(cliMutationRequests)
            .set({
              result: request.result,
              completedAt: Temporal.Now.instant(),
            })
            .where(
              and(
                isInScope(request.scope),
                eq(cliMutationRequests.requestId, request.requestId),
                eq(cliMutationRequests.mutation, request.mutation),
                isNull(cliMutationRequests.result)
              )
            )
            .returning({ requestId: cliMutationRequests.requestId })
            .pipe(
              Effect.flatMap((rows) =>
                rows.length > 0
                  ? Effect.void
                  : Effect.die(
                      new Error(
                        "Claimed CLI mutation could not be completed idempotently."
                      )
                    )
              )
            )
      );

      const release = Effect.fn("CliMutationIdempotency.release")(
        (request: CliMutationRequest) =>
          db
            .delete(cliMutationRequests)
            .where(
              and(
                isInScope(request.scope),
                eq(cliMutationRequests.requestId, request.requestId),
                eq(cliMutationRequests.mutation, request.mutation),
                isNull(cliMutationRequests.result)
              )
            )
            .pipe(Effect.asVoid)
      );

      const reclaimStale = Effect.fn("CliMutationIdempotency.reclaimStale")(
        (
          request: CliMutationRequest & {
            readonly reclaimedAt: Temporal.Instant;
            readonly staleBefore: Temporal.Instant;
          }
        ) =>
          db
            .update(cliMutationRequests)
            .set({ createdAt: request.reclaimedAt })
            .where(
              and(
                isInScope(request.scope),
                eq(cliMutationRequests.requestId, request.requestId),
                eq(cliMutationRequests.mutation, request.mutation),
                isNull(cliMutationRequests.result),
                lte(cliMutationRequests.createdAt, request.staleBefore)
              )
            )
            .returning({ requestId: cliMutationRequests.requestId })
            .pipe(Effect.map((rows) => rows.length > 0))
      );

      const claimAndApply = Effect.fn("CliMutationIdempotency.applyOnce")(
        function* <A extends CliStoredMutationResult, E, R>(
          mutation: CliDatabaseMutation<A, E, R>
        ) {
          const claimed = yield* claim(mutation.request);
          return yield* Match.value(claimed).pipe(
            Match.discriminatorsExhaustive("kind")({
              claimed: () =>
                mutation.apply.pipe(
                  Effect.tap((result) =>
                    complete({ ...mutation.request, result })
                  )
                ),
              completed: ({ result }) =>
                Schema.decodeUnknownEffect(mutation.result)(result),
              "in-progress": () =>
                new CliMutationInProgress({
                  requestId: mutation.request.requestId,
                  message:
                    "This mutation is still being applied. Retrying with the same request identifier is safe.",
                }),
              mismatch: () =>
                new CliMutationRejected({
                  message:
                    "This mutation request identifier was already used for different input.",
                }),
            })
          );
        }
      );

      const applyOnce = <A extends CliStoredMutationResult, E, R>(
        mutation: CliDatabaseMutation<A, E, R>
      ) => db.transaction(() => claimAndApply(mutation));

      return {
        applyOnce,
        claim,
        complete,
        reclaimStale,
        release,
      } satisfies ICliMutationIdempotency;
    })
  );

  static Live = this.Default.pipe(Layer.provide(WorkspaceDatabase.Default));
}
