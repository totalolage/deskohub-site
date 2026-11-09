import {
  type AdministrationAssistantConnectionIdType,
  type AdministrationChannel,
  CliMutationInProgress,
  CliMutationRejected,
  type CliMutationRequestIdType,
  type CliServiceUnavailable,
  type CliSessionIdType,
  CurrentAdministrationCaller,
} from "@deskohub/workspace-admin-api";
import { and, eq, isNull, lte } from "drizzle-orm";
import {
  Context,
  Data,
  Duration,
  Effect,
  Layer,
  Match,
  Option,
  Schema,
} from "effect";
import {
  WorkspaceDatabase,
  type WorkspaceTransaction,
} from "@/db/database.service";
import {
  type CliStoredMutation,
  type CliStoredMutationResult,
  cliMutationRequests,
} from "@/db/schema";
import type { DatabaseQueryError } from "@/db/sql-constraint";
import { CurrentAdministrationAction } from "./administration-action";
import { mapServiceFailure } from "./administration-api-failure";

/** One administration request: what it asks for, under its request ID. */
type LedgerRequest = {
  readonly requestId: CliMutationRequestIdType;
  /** A retry with the same request ID must ask for the same mutation. */
  readonly mutation: CliStoredMutation;
};

type DatabaseMutation<
  A extends CliStoredMutationResult,
  E,
  R,
> = LedgerRequest & {
  readonly result: Schema.Decoder<A>;
  /**
   * Writes only through the Workspace database; it runs inside the ledger's
   * transaction, so it may require `WorkspaceTransaction`.
   */
  readonly apply: Effect.Effect<A, E, R>;
};

/**
 * How a mutation's result is recorded and replayed. The stored form is a
 * `CliStoredMutationResult`, which never carries a credential such as an
 * access-code PIN, so a replay returns safe metadata only.
 */
export type StoredResult<A, S extends CliStoredMutationResult> = {
  readonly schema: Schema.Decoder<S>;
  readonly from: (result: A) => S;
  readonly replay: (stored: S) => A;
};

export const StoredResult = {
  /** A result that is already safe to store, replayed as it was stored. */
  unchanged: <S extends CliStoredMutationResult>(
    schema: Schema.Decoder<S>
  ): StoredResult<S, S> => ({
    schema,
    from: (result) => result,
    replay: (stored) => stored,
  }),
};

/**
 * Whether a claimed result must be recorded: `required` fails the call when
 * it can't be, and keeps the claim; `best-effort` logs the failure, releases
 * the claim and still returns the result.
 */
type Completion = "required" | "best-effort";

/** What a retry does with a claim whose attempt never recorded a result. */
type Interruption<E> = Data.TaggedEnum<{
  /** The claim stays in progress until its attempt settles. */
  StaysInProgress: Record<never, never>;
  /**
   * A retry takes over a claim untouched for `staleAfter` and resumes the
   * mutation; a resumed failure releases the claim when `releasesOn` holds.
   */
  ResumesAfter: {
    readonly staleAfter: Duration.Duration;
    readonly releasesOn: (failure: E) => boolean;
  };
}>;

interface InterruptionDefinition extends Data.TaggedEnum.WithGenerics<1> {
  readonly taggedEnum: Interruption<this["A"]>;
}

const Interruption = Data.taggedEnum<InterruptionDefinition>();

/**
 * How a mutation with external effects recovers when an attempt fails or
 * stops: which failures release its claim, whether its result must be
 * recorded, and what a retry does with an interrupted claim. Build one with
 * `RecoveryPolicy.noResume` or `RecoveryPolicy.resumeAfter` and name it
 * after the mutation it governs.
 */
export type RecoveryPolicy<E> = {
  /**
   * Failures that prove the attempt changed nothing, so its request ID is
   * free for a retry. Every other failure keeps the claim.
   */
  readonly releasesOn: (failure: E) => boolean;
  readonly completion: Completion;
  readonly interruption: Interruption<E>;
};

export const RecoveryPolicy = {
  /** An interrupted claim stays in progress; nothing resumes it. */
  noResume: <E>(policy: {
    readonly releasesOn: (failure: E) => boolean;
    readonly completion: Completion;
  }): RecoveryPolicy<E> => ({
    ...policy,
    interruption: Interruption.StaysInProgress(),
  }),
  /**
   * A retry after `staleAfter` takes the claim over and runs the mutation's
   * `resume`. A resumed failure releases the claim when `resumeReleasesOn`
   * holds, which defaults to `releasesOn`.
   */
  resumeAfter: <E>(
    staleAfter: Duration.Input,
    policy: {
      readonly releasesOn: (failure: E) => boolean;
      readonly resumeReleasesOn?: (failure: E) => boolean;
      readonly completion: Completion;
    }
  ): RecoveryPolicy<E> => ({
    releasesOn: policy.releasesOn,
    completion: policy.completion,
    interruption: Interruption.ResumesAfter({
      staleAfter: Duration.fromInputUnsafe(staleAfter),
      releasesOn: policy.resumeReleasesOn ?? policy.releasesOn,
    }),
  }),
};

type MutationWithEffects<
  A,
  S extends CliStoredMutationResult,
  E,
  R,
> = LedgerRequest & {
  readonly stored: StoredResult<A, S>;
  /** The first attempt. Its external effects don't roll back. */
  readonly apply: Effect.Effect<A, E, R>;
  /** Finishes an interrupted attempt the policy resumes; defaults to `apply`. */
  readonly resume?: Effect.Effect<A, E, R>;
  readonly recovery: RecoveryPolicy<NoInfer<E>>;
  /**
   * Runs once the result is known, applied or replayed, before an applied
   * result is recorded.
   */
  readonly afterSettled?: Effect.Effect<void, never, R>;
  /** The answer while another attempt holds the claim. */
  readonly inProgressMessage?: string;
};

interface IAdministrationRequestLedger {
  /**
   * Applies a database-only mutation at most once per caller's channel and
   * request ID. The claim, the mutation and the stored result commit in
   * one transaction, so a failure or crash anywhere leaves no trace and
   * the request ID free for a retry. A retry after the commit replays the
   * stored result; a concurrent retry waits on the claim's row until the
   * first commits or rolls back.
   */
  readonly applyOnce: <A extends CliStoredMutationResult, E, R>(
    mutation: DatabaseMutation<A, E, R>
  ) => Effect.Effect<
    A,
    | E
    | CliMutationInProgress
    | CliMutationRejected
    | DatabaseQueryError
    | Schema.SchemaError,
    Exclude<R, WorkspaceTransaction> | CurrentAdministrationCaller
  >;
  /**
   * Applies a mutation with external effects at most once per caller's
   * channel and request ID. The claim commits before the attempt runs, and
   * the result is recorded after it, so a retry replays the stored result
   * and a concurrent retry finds the claim in progress. The recovery policy
   * decides what a failed or interrupted attempt leaves behind. Ledger
   * storage failures answer `CliServiceUnavailable`.
   */
  readonly applyOnceWithEffects: <A, S extends CliStoredMutationResult, E, R>(
    mutation: MutationWithEffects<A, S, E, R>
  ) => Effect.Effect<
    A,
    E | CliMutationInProgress | CliMutationRejected | CliServiceUnavailable,
    R | CurrentAdministrationCaller
  >;
}

/** Where a request ID is unique and its result replays. */
type AdministrationRequestScope =
  | {
      readonly _tag: "CliSession";
      readonly sessionId: CliSessionIdType;
    }
  | {
      readonly _tag: "AssistantConnection";
      readonly connectionId: AdministrationAssistantConnectionIdType;
    };

type LedgerEntry = LedgerRequest & {
  readonly scope: AdministrationRequestScope;
};

type Claim =
  | { readonly kind: "claimed" }
  | { readonly kind: "completed"; readonly result: CliStoredMutationResult }
  | { readonly kind: "in-progress" }
  | { readonly kind: "mismatch" };

const inProgressMessage =
  "This mutation is still being applied. Retrying with the same request identifier is safe.";

/**
 * The administration API's request ledger, stored in
 * `cli_mutation_requests`. Each caller's channel keeps its own request IDs:
 * a retried request replays its first result instead of applying again.
 */
export class AdministrationRequestLedger extends Context.Service<
  AdministrationRequestLedger,
  IAdministrationRequestLedger
>()("@deskohub-workspace/admin-cli/AdministrationRequestLedger") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const { db, transaction } = yield* WorkspaceDatabase;

      const claim = Effect.fn("AdministrationRequestLedger.claim")(function* (
        entry: LedgerEntry
      ) {
        const inserted = yield* db
          .insert(cliMutationRequests)
          .values({
            ...scopeColumns(entry.scope),
            requestId: entry.requestId,
            mutation: entry.mutation,
          })
          .onConflictDoNothing()
          .returning({ requestId: cliMutationRequests.requestId });
        if (inserted.length > 0) {
          return { kind: "claimed" } satisfies Claim;
        }

        const rows = yield* db
          .select({ result: cliMutationRequests.result })
          .from(cliMutationRequests)
          .where(isEntry(entry))
          .limit(1);
        const row = rows[0];
        if (!row) return { kind: "mismatch" } satisfies Claim;
        if (row.result === null) return { kind: "in-progress" } satisfies Claim;

        yield* Effect.serviceOption(CurrentAdministrationAction).pipe(
          Effect.flatMap(
            Option.match({
              onNone: () => Effect.void,
              onSome: (action) => action.markReplayed,
            })
          )
        );
        return { kind: "completed", result: row.result } satisfies Claim;
      });

      const complete = Effect.fn("AdministrationRequestLedger.complete")(
        (entry: LedgerEntry, result: CliStoredMutationResult) =>
          db
            .update(cliMutationRequests)
            .set({ result, completedAt: Temporal.Now.instant() })
            .where(and(isEntry(entry), isNull(cliMutationRequests.result)))
            .returning({ requestId: cliMutationRequests.requestId })
            .pipe(
              Effect.flatMap((rows) =>
                rows.length > 0
                  ? Effect.void
                  : Effect.die(
                      new Error(
                        "Claimed administration request could not be completed idempotently."
                      )
                    )
              )
            )
      );

      const release = Effect.fn("AdministrationRequestLedger.release")(
        (entry: LedgerEntry) =>
          db
            .delete(cliMutationRequests)
            .where(and(isEntry(entry), isNull(cliMutationRequests.result)))
            .pipe(Effect.asVoid)
      );

      /** Takes over a claim untouched since `staleBefore`. */
      const reclaimStale = Effect.fn(
        "AdministrationRequestLedger.reclaimStale"
      )((entry: LedgerEntry, staleAfter: Duration.Duration) => {
        const reclaimedAt = Temporal.Now.instant();
        return db
          .update(cliMutationRequests)
          .set({ createdAt: reclaimedAt })
          .where(
            and(
              isEntry(entry),
              isNull(cliMutationRequests.result),
              lte(
                cliMutationRequests.createdAt,
                reclaimedAt.subtract({
                  milliseconds: Duration.toMillis(staleAfter),
                })
              )
            )
          )
          .returning({ requestId: cliMutationRequests.requestId })
          .pipe(Effect.map((rows) => rows.length > 0));
      });

      const stillInProgress = (entry: LedgerEntry, message: string) =>
        new CliMutationInProgress({ requestId: entry.requestId, message });

      const reusedRequestId = () =>
        new CliMutationRejected({
          message:
            "This mutation request identifier was already used for different input.",
        });

      const claimAndApply = Effect.fn("AdministrationRequestLedger.applyOnce")(
        function* <A extends CliStoredMutationResult, E, R>(
          mutation: DatabaseMutation<A, E, R>
        ) {
          const entry = yield* entryOf(mutation);
          const claimed = yield* claim(entry);
          return yield* Match.value(claimed).pipe(
            Match.discriminatorsExhaustive("kind")({
              claimed: () =>
                mutation.apply.pipe(
                  Effect.tap((result) => complete(entry, result))
                ),
              completed: ({ result }) =>
                Schema.decodeUnknownEffect(mutation.result)(result),
              "in-progress": () => stillInProgress(entry, inProgressMessage),
              mismatch: reusedRequestId,
            })
          );
        }
      );

      const applyOnce = <A extends CliStoredMutationResult, E, R>(
        mutation: DatabaseMutation<A, E, R>
      ) => transaction(claimAndApply(mutation));

      /** Records an applied result as the policy's completion requires. */
      const record = <A, S extends CliStoredMutationResult, E, R>(
        entry: LedgerEntry,
        mutation: MutationWithEffects<A, S, E, R>,
        result: A
      ) => {
        const completed = complete(entry, mutation.stored.from(result));
        return Match.value(mutation.recovery.completion).pipe(
          Match.when("required", () => completed.pipe(mapServiceFailure)),
          Match.when("best-effort", () =>
            completed.pipe(
              Effect.catch((cause) =>
                Effect.logWarning(
                  "Administration request ledger could not record a concluded mutation; its claim is released",
                  {
                    requestId: entry.requestId,
                    mutation: entry.mutation.kind,
                    scope: entry.scope,
                    cause,
                  }
                ).pipe(Effect.andThen(release(entry).pipe(Effect.ignore)))
              )
            )
          ),
          Match.exhaustive
        );
      };

      /** Runs one attempt and settles the claim by its outcome. */
      const settle = <A, S extends CliStoredMutationResult, E, R>(
        entry: LedgerEntry,
        mutation: MutationWithEffects<A, S, E, R>,
        attempt: Effect.Effect<A, E, R>,
        releasesOn: (failure: E) => boolean
      ) =>
        attempt.pipe(
          Effect.tapError((failure) =>
            releasesOn(failure)
              ? release(entry).pipe(Effect.ignore)
              : Effect.void
          ),
          Effect.tap(() => mutation.afterSettled ?? Effect.void),
          Effect.tap((result) => record(entry, mutation, result))
        );

      const replay = <A, S extends CliStoredMutationResult, E, R>(
        mutation: MutationWithEffects<A, S, E, R>,
        result: CliStoredMutationResult
      ) =>
        Schema.decodeUnknownEffect(mutation.stored.schema)(result).pipe(
          mapServiceFailure,
          Effect.map(mutation.stored.replay),
          Effect.tap(() => mutation.afterSettled ?? Effect.void)
        );

      /** Answers a claim another attempt holds, resuming it if the policy does. */
      const recoverInterrupted = <A, S extends CliStoredMutationResult, E, R>(
        entry: LedgerEntry,
        mutation: MutationWithEffects<A, S, E, R>
      ): Effect.Effect<
        A,
        E | CliMutationInProgress | CliServiceUnavailable,
        R
      > => {
        const stillApplying = () =>
          stillInProgress(
            entry,
            mutation.inProgressMessage ?? inProgressMessage
          );
        const interruption: Interruption<E> = mutation.recovery.interruption;
        return Match.value(interruption).pipe(
          Match.withReturnType<
            Effect.Effect<
              A,
              E | CliMutationInProgress | CliServiceUnavailable,
              R
            >
          >(),
          Match.tagsExhaustive({
            StaysInProgress: () => Effect.fail(stillApplying()),
            ResumesAfter: ({ staleAfter, releasesOn }) =>
              reclaimStale(entry, staleAfter).pipe(
                mapServiceFailure,
                Effect.filterOrFail((reclaimed) => reclaimed, stillApplying),
                Effect.andThen(
                  settle(
                    entry,
                    mutation,
                    mutation.resume ?? mutation.apply,
                    releasesOn
                  )
                )
              ),
          })
        );
      };

      const applyOnceWithEffects = Effect.fn(
        "AdministrationRequestLedger.applyOnceWithEffects"
      )(function* <A, S extends CliStoredMutationResult, E, R>(
        mutation: MutationWithEffects<A, S, E, R>
      ) {
        const entry = yield* entryOf(mutation);
        const claimed = yield* claim(entry).pipe(mapServiceFailure);
        return yield* Match.value(claimed).pipe(
          Match.discriminatorsExhaustive("kind")({
            claimed: () =>
              settle(
                entry,
                mutation,
                mutation.apply,
                mutation.recovery.releasesOn
              ),
            completed: ({ result }) => replay(mutation, result),
            "in-progress": () => recoverInterrupted(entry, mutation),
            mismatch: reusedRequestId,
          })
        );
      });

      return {
        applyOnce,
        applyOnceWithEffects,
      } satisfies IAdministrationRequestLedger;
    })
  );

  static Live = this.Default.pipe(Layer.provide(WorkspaceDatabase.Default));
}

/** The request under the scope of the calling administrator's channel. */
const entryOf = (request: LedgerRequest) =>
  Effect.map(
    CurrentAdministrationCaller,
    ({ channel }): LedgerEntry => ({
      scope: scopeOf(channel),
      requestId: request.requestId,
      mutation: request.mutation,
    })
  );

const scopeOf = (channel: AdministrationChannel): AdministrationRequestScope =>
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

/** The entry's row, matched on scope, request ID and mutation. */
const isEntry = (entry: LedgerEntry) =>
  and(
    Match.value(entry.scope).pipe(
      Match.tagsExhaustive({
        CliSession: ({ sessionId }) =>
          eq(cliMutationRequests.sessionId, sessionId),
        AssistantConnection: ({ connectionId }) =>
          eq(cliMutationRequests.assistantConnectionId, connectionId),
      })
    ),
    eq(cliMutationRequests.requestId, entry.requestId),
    eq(cliMutationRequests.mutation, entry.mutation)
  );

const scopeColumns = (scope: AdministrationRequestScope) =>
  Match.value(scope).pipe(
    Match.tagsExhaustive({
      CliSession: ({ sessionId }) => ({ sessionId }),
      AssistantConnection: ({ connectionId }) => ({
        assistantConnectionId: connectionId,
      }),
    })
  );
