import {
  AdministrationDiscountMutationResult,
  AdministrationReservationAccessGrant,
  AdministrationStandaloneAccessCodeResult,
  type CliMutationRequestIdType,
  type CliSessionIdType,
} from "@deskohub/workspace-admin-api";
import { and, eq, isNull, lte } from "drizzle-orm";
import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import { Context, Effect, Layer, Schema } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import {
  type CliStoredMutation,
  type CliStoredMutationResult,
  cliMutationRequests,
} from "@/db/schema";

export type CliMutationClaim =
  | { readonly kind: "claimed" }
  | {
      readonly kind: "completed";
      readonly result: CliStoredMutationResult;
    }
  | { readonly kind: "in-progress" }
  | { readonly kind: "mismatch" };

type CliMutationRequest = {
  readonly sessionId: CliSessionIdType;
  readonly requestId: CliMutationRequestIdType;
  readonly mutation: CliStoredMutation;
};

interface ICliMutationIdempotency {
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
          .values(request)
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
              eq(cliMutationRequests.sessionId, request.sessionId),
              eq(cliMutationRequests.requestId, request.requestId),
              eq(cliMutationRequests.mutation, request.mutation)
            )
          )
          .limit(1);
        const row = rows[0];
        if (!row) return { kind: "mismatch" } as const;
        if (row.result === null) return { kind: "in-progress" } as const;

        const result = yield* Schema.decodeUnknownEffect(
          Schema.Union([
            AdministrationDiscountMutationResult,
            AdministrationReservationAccessGrant,
            AdministrationStandaloneAccessCodeResult,
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
                eq(cliMutationRequests.sessionId, request.sessionId),
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
                eq(cliMutationRequests.sessionId, request.sessionId),
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
                eq(cliMutationRequests.sessionId, request.sessionId),
                eq(cliMutationRequests.requestId, request.requestId),
                eq(cliMutationRequests.mutation, request.mutation),
                isNull(cliMutationRequests.result),
                lte(cliMutationRequests.createdAt, request.staleBefore)
              )
            )
            .returning({ requestId: cliMutationRequests.requestId })
            .pipe(Effect.map((rows) => rows.length > 0))
      );

      return {
        claim,
        complete,
        reclaimStale,
        release,
      } satisfies ICliMutationIdempotency;
    })
  );

  static Live = this.Default.pipe(Layer.provide(WorkspaceDatabase.Default));
}
