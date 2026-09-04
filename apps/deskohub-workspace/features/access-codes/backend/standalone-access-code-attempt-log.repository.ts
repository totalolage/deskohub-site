import type { IgloohomeDeviceId } from "@deskohub/igloohome";
import type {
  AdministrationActorUsername,
  AdministrationProviderCredentialId,
  AdministrationStandaloneAccessCodeAttemptId,
  AdministrationStandaloneAccessCodeName,
  AdministrationWorkspaceSiteLocalWholeHourDateTime,
} from "@deskohub/workspace-admin-api";
import { and, eq, inArray, sql } from "drizzle-orm";
import type {
  EffectPgQueryResultHKT,
  EffectPgTransaction,
} from "drizzle-orm/effect-postgres";
import { Context, Data, Effect, Layer, Match } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import type { relations } from "@/db/relations";
import type { StandaloneAccessCodeAttemptEventRow } from "@/db/schema";
import { standaloneAccessCodeAttemptEvents } from "@/db/schema";
import { quotedSqlList } from "@/db/schema/sql-list";
import type {
  StandaloneAccessCodeFailureCode,
  StandaloneAccessCodeProviderVariance,
  StandaloneAccessCodeSource,
  StandaloneAccessCodeTerminalEventKind,
} from "../standalone-access-code";
import {
  standaloneAccessCodeProviderVariances,
  standaloneAccessCodeTerminalEventKinds,
} from "../standalone-access-code";

export interface StandaloneAccessCodeAttempt {
  readonly attemptId: AdministrationStandaloneAccessCodeAttemptId;
  readonly actor: AdministrationActorUsername;
  readonly source: StandaloneAccessCodeSource;
  readonly name: AdministrationStandaloneAccessCodeName;
  readonly deviceId: IgloohomeDeviceId;
  readonly startsAtLocal: AdministrationWorkspaceSiteLocalWholeHourDateTime;
  readonly endsAtLocal: AdministrationWorkspaceSiteLocalWholeHourDateTime;
  readonly startsAt: Temporal.Instant;
  readonly endsAt: Temporal.Instant;
}

export interface StandaloneAccessCodeCreatedAttemptTerminal {
  readonly name: AdministrationStandaloneAccessCodeName;
  readonly startsAtLocal: AdministrationWorkspaceSiteLocalWholeHourDateTime;
  readonly endsAtLocal: AdministrationWorkspaceSiteLocalWholeHourDateTime;
  readonly providerCredentialId: AdministrationProviderCredentialId;
  readonly occurredAt: Temporal.Instant;
}

export type StandaloneAccessCodeAttemptTerminalResolution =
  | {
      readonly kind: "created";
      readonly terminal: StandaloneAccessCodeCreatedAttemptTerminal;
    }
  | {
      readonly kind: "rejected";
      readonly failureCode: StandaloneAccessCodeFailureCode;
    }
  | {
      readonly kind: "ambiguous";
      readonly failureCode: StandaloneAccessCodeFailureCode;
    };

export type StandaloneAccessCodeAttemptClaim =
  | StandaloneAccessCodeAttemptTerminalResolution
  | {
      readonly kind: "claimed";
      readonly variance: StandaloneAccessCodeProviderVariance;
    }
  | { readonly kind: "in-progress" }
  | { readonly kind: "cleanup-required" }
  | { readonly kind: "reconciled" }
  | { readonly kind: "mismatch" }
  | { readonly kind: "exhausted" };

export type StandaloneAccessCodeAppendTerminalResult =
  | { readonly kind: "appended" }
  | {
      readonly kind: "already-terminal";
      readonly terminal: StandaloneAccessCodeAttemptTerminalResolution;
    };

export class StandaloneAccessCodeAttemptLogStorageError extends Data.TaggedError(
  "StandaloneAccessCodeAttemptLogStorageError"
)<{
  readonly operation: "claim" | "append_terminal";
  readonly attemptId: AdministrationStandaloneAccessCodeAttemptId;
  readonly message: string;
  readonly cause?: unknown;
}> {}

export interface IStandaloneAccessCodeAttemptLogRepository {
  readonly claim: (input: {
    readonly attempt: StandaloneAccessCodeAttempt;
    readonly claimedAt: Temporal.Instant;
    readonly staleBefore: Temporal.Instant;
    readonly providerCredentialRemoved: boolean;
  }) => Effect.Effect<
    StandaloneAccessCodeAttemptClaim,
    StandaloneAccessCodeAttemptLogStorageError
  >;
  readonly appendTerminal: (input: {
    readonly attempt: StandaloneAccessCodeAttempt;
    readonly variance: StandaloneAccessCodeProviderVariance;
    readonly eventKind: StandaloneAccessCodeTerminalEventKind;
    readonly occurredAt: Temporal.Instant;
    readonly providerCredentialId?: AdministrationProviderCredentialId;
    readonly providerStatusCode?: number;
    readonly failureCode?: StandaloneAccessCodeFailureCode;
  }) => Effect.Effect<
    StandaloneAccessCodeAppendTerminalResult,
    StandaloneAccessCodeAttemptLogStorageError
  >;
}

export class StandaloneAccessCodeAttemptLogRepository extends Context.Service<
  StandaloneAccessCodeAttemptLogRepository,
  IStandaloneAccessCodeAttemptLogRepository
>()(
  "@deskohub-workspace/access-codes/StandaloneAccessCodeAttemptLogRepository"
) {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const { db } = yield* WorkspaceDatabase;

      const events = standaloneAccessCodeAttemptEvents;
      type Transaction = EffectPgTransaction<
        EffectPgQueryResultHKT,
        typeof relations
      >;

      const findStartedEvent = (
        tx: Transaction,
        attemptId: AdministrationStandaloneAccessCodeAttemptId
      ) =>
        tx
          .select()
          .from(events)
          .where(
            and(
              eq(events.attemptId, attemptId),
              eq(events.eventKind, "started")
            )
          )
          .limit(1);

      const findTerminalEvent = (
        tx: Transaction,
        attemptId: AdministrationStandaloneAccessCodeAttemptId
      ) =>
        tx
          .select()
          .from(events)
          .where(
            and(
              eq(events.attemptId, attemptId),
              inArray(events.eventKind, [
                ...standaloneAccessCodeTerminalEventKinds,
              ])
            )
          )
          .limit(1);

      const matchesAttempt = (
        event: {
          readonly actor: AdministrationActorUsername;
          readonly source: StandaloneAccessCodeSource;
          readonly name: AdministrationStandaloneAccessCodeName;
          readonly deviceId: IgloohomeDeviceId;
          readonly startsAt: Temporal.Instant;
          readonly endsAt: Temporal.Instant;
        },
        attempt: StandaloneAccessCodeAttempt
      ) =>
        event.actor === attempt.actor &&
        event.source === attempt.source &&
        event.name === attempt.name &&
        event.deviceId === attempt.deviceId &&
        event.startsAt.equals(attempt.startsAt) &&
        event.endsAt.equals(attempt.endsAt);

      const insertStartedEvent = (
        tx: Transaction,
        input: {
          readonly attempt: StandaloneAccessCodeAttempt;
          readonly variance: StandaloneAccessCodeProviderVariance;
          readonly claimedAt: Temporal.Instant;
        }
      ) =>
        tx
          .insert(events)
          .values({
            attemptId: input.attempt.attemptId,
            eventKind: "started",
            actor: input.attempt.actor,
            source: input.attempt.source,
            name: input.attempt.name,
            deviceId: input.attempt.deviceId,
            startsAtLocal: input.attempt.startsAtLocal,
            endsAtLocal: input.attempt.endsAtLocal,
            startsAt: input.attempt.startsAt,
            endsAt: input.attempt.endsAt,
            variance: input.variance,
            providerCredentialId: null,
            providerStatusCode: null,
            failureCode: null,
            occurredAt: input.claimedAt,
          })
          .onConflictDoNothing({
            target: [events.attemptId],
            where: sql`${events.eventKind} = 'started'`,
          })
          .returning({ id: events.id });

      const insertTerminalEvent = (
        tx: Transaction,
        input: {
          readonly attempt: StandaloneAccessCodeAttempt;
          readonly variance: StandaloneAccessCodeProviderVariance;
          readonly eventKind: StandaloneAccessCodeTerminalEventKind;
          readonly occurredAt: Temporal.Instant;
          readonly providerCredentialId: AdministrationProviderCredentialId | null;
          readonly providerStatusCode: number | null;
          readonly failureCode: StandaloneAccessCodeFailureCode | null;
        }
      ) =>
        tx
          .insert(events)
          .values({
            attemptId: input.attempt.attemptId,
            eventKind: input.eventKind,
            actor: input.attempt.actor,
            source: input.attempt.source,
            name: input.attempt.name,
            deviceId: input.attempt.deviceId,
            startsAtLocal: input.attempt.startsAtLocal,
            endsAtLocal: input.attempt.endsAtLocal,
            startsAt: input.attempt.startsAt,
            endsAt: input.attempt.endsAt,
            variance: input.variance,
            providerCredentialId: input.providerCredentialId,
            providerStatusCode: input.providerStatusCode,
            failureCode: input.failureCode,
            occurredAt: input.occurredAt,
          })
          .onConflictDoNothing({
            target: [events.attemptId],
            where: sql`${events.eventKind} in (${quotedSqlList([...standaloneAccessCodeTerminalEventKinds])})`,
          })
          .returning({ id: events.id });

      const occupiedVariances = (
        tx: Transaction,
        attempt: StandaloneAccessCodeAttempt
      ) =>
        Effect.gen(function* () {
          const startedEvents = yield* tx
            .select({
              attemptId: events.attemptId,
              variance: events.variance,
            })
            .from(events)
            .where(
              and(
                eq(events.deviceId, attempt.deviceId),
                eq(events.startsAt, attempt.startsAt),
                eq(events.endsAt, attempt.endsAt),
                eq(events.eventKind, "started")
              )
            );
          if (startedEvents.length === 0) return [];

          const freedAttempts = yield* tx
            .selectDistinct({ attemptId: events.attemptId })
            .from(events)
            .where(
              and(
                inArray(
                  events.attemptId,
                  startedEvents.map((event) => event.attemptId)
                ),
                inArray(events.eventKind, ["rejected", "reconciled"])
              )
            );
          const freedAttemptIds = new Set(
            freedAttempts.map((event) => event.attemptId)
          );

          return [
            ...new Set(
              startedEvents
                .filter((event) => !freedAttemptIds.has(event.attemptId))
                .map((event) => event.variance)
            ),
          ];
        });

      const unreconciledAmbiguousAttempts = (
        tx: Transaction,
        input: {
          readonly attempt: StandaloneAccessCodeAttempt;
          readonly staleBefore: Temporal.Instant;
        }
      ) =>
        Effect.gen(function* () {
          const startedEvents = yield* tx
            .select()
            .from(events)
            .where(
              and(
                eq(events.deviceId, input.attempt.deviceId),
                eq(events.startsAt, input.attempt.startsAt),
                eq(events.endsAt, input.attempt.endsAt),
                eq(events.eventKind, "started")
              )
            );
          if (startedEvents.length === 0) return [];

          const [terminalEvents, reconciledEvents] = yield* Effect.all([
            tx
              .select({
                attemptId: events.attemptId,
                eventKind: events.eventKind,
              })
              .from(events)
              .where(
                and(
                  inArray(
                    events.attemptId,
                    startedEvents.map((event) => event.attemptId)
                  ),
                  inArray(
                    events.eventKind,
                    standaloneAccessCodeTerminalEventKinds
                  )
                )
              ),
            tx
              .select({ attemptId: events.attemptId })
              .from(events)
              .where(
                and(
                  inArray(
                    events.attemptId,
                    startedEvents.map((event) => event.attemptId)
                  ),
                  eq(events.eventKind, "reconciled")
                )
              ),
          ]);
          const ambiguousAttemptIds = new Set(
            terminalEvents
              .filter(({ eventKind }) => eventKind === "ambiguous")
              .map(({ attemptId }) => attemptId)
          );
          const terminalAttemptIds = new Set(
            terminalEvents.map(({ attemptId }) => attemptId)
          );
          const reconciledAttemptIds = new Set(
            reconciledEvents.map((event) => event.attemptId)
          );

          return startedEvents.filter((event) => {
            if (reconciledAttemptIds.has(event.attemptId)) return false;
            if (ambiguousAttemptIds.has(event.attemptId)) return true;
            const isStale =
              Temporal.Instant.compare(event.occurredAt, input.staleBefore) <=
              0;
            return isStale && !terminalAttemptIds.has(event.attemptId);
          });
        });

      const insertReconciledEvent = (
        tx: Transaction,
        input: {
          readonly attempt: StandaloneAccessCodeAttempt;
          readonly prior: StandaloneAccessCodeAttemptEventRow;
          readonly occurredAt: Temporal.Instant;
        }
      ) =>
        tx
          .insert(events)
          .values({
            attemptId: input.prior.attemptId,
            eventKind: "reconciled",
            actor: input.attempt.actor,
            source: input.attempt.source,
            name: input.prior.name,
            deviceId: input.prior.deviceId,
            startsAtLocal: input.prior.startsAtLocal,
            endsAtLocal: input.prior.endsAtLocal,
            startsAt: input.prior.startsAt,
            endsAt: input.prior.endsAt,
            variance: input.prior.variance,
            providerCredentialId: null,
            providerStatusCode: null,
            failureCode: null,
            occurredAt: input.occurredAt,
          })
          .onConflictDoNothing({
            target: [events.attemptId],
            where: sql`${events.eventKind} = 'reconciled'`,
          })
          .returning({ id: events.id });

      const resolveTerminalEvent = (
        terminal: StandaloneAccessCodeAttemptEventRow
      ):
        | StandaloneAccessCodeAttemptTerminalResolution
        | {
            readonly kind: "in-progress";
          } =>
        Match.value(terminal.eventKind).pipe(
          Match.when("created", () => {
            if (terminal.providerCredentialId === null) {
              return {
                kind: "ambiguous",
                failureCode: "standalone_attempt_stale",
              } as const;
            }
            return {
              kind: "created",
              terminal: {
                name: terminal.name,
                startsAtLocal: terminal.startsAtLocal,
                endsAtLocal: terminal.endsAtLocal,
                providerCredentialId: terminal.providerCredentialId,
                occurredAt: terminal.occurredAt,
              },
            } as const;
          }),
          Match.when(
            "rejected",
            () =>
              ({
                kind: "rejected",
                failureCode:
                  terminal.failureCode ?? "standalone_provider_rejected",
              }) as const
          ),
          Match.when(
            "ambiguous",
            () =>
              ({
                kind: "ambiguous",
                failureCode:
                  terminal.failureCode ?? "standalone_provider_ambiguous",
              }) as const
          ),
          Match.when("started", () => ({ kind: "in-progress" }) as const),
          Match.when("reconciled", () => ({ kind: "in-progress" }) as const),
          Match.exhaustive
        );

      const resolveReplay = (
        tx: Transaction,
        stored: StandaloneAccessCodeAttemptEventRow,
        input: {
          readonly attempt: StandaloneAccessCodeAttempt;
          readonly claimedAt: Temporal.Instant;
          readonly staleBefore: Temporal.Instant;
          readonly providerCredentialRemoved: boolean;
        }
      ) =>
        Effect.gen(function* () {
          if (!matchesAttempt(stored, input.attempt)) {
            return { kind: "mismatch" } as const;
          }

          const [terminal] = yield* findTerminalEvent(
            tx,
            input.attempt.attemptId
          );
          if (terminal) {
            if (
              terminal.eventKind === "ambiguous" &&
              input.providerCredentialRemoved
            ) {
              yield* insertReconciledEvent(tx, {
                attempt: input.attempt,
                prior: terminal,
                occurredAt: input.claimedAt,
              });
              return { kind: "reconciled" } as const;
            }
            return resolveTerminalEvent(terminal);
          }

          if (
            Temporal.Instant.compare(stored.occurredAt, input.staleBefore) <= 0
          ) {
            yield* insertTerminalEvent(tx, {
              attempt: input.attempt,
              variance: stored.variance,
              eventKind: "ambiguous",
              occurredAt: input.claimedAt,
              providerCredentialId: null,
              providerStatusCode: null,
              failureCode: "standalone_attempt_stale",
            });
            return {
              kind: "ambiguous",
              failureCode: "standalone_attempt_stale",
            } as const;
          }

          return { kind: "in-progress" } as const;
        });

      const claimInTransaction = (
        tx: Transaction,
        input: {
          readonly attempt: StandaloneAccessCodeAttempt;
          readonly claimedAt: Temporal.Instant;
          readonly staleBefore: Temporal.Instant;
          readonly providerCredentialRemoved: boolean;
        }
      ) =>
        Effect.gen(function* () {
          const [existing] = yield* findStartedEvent(
            tx,
            input.attempt.attemptId
          );
          if (existing) return yield* resolveReplay(tx, existing, input);

          const unresolved = yield* unreconciledAmbiguousAttempts(tx, {
            attempt: input.attempt,
            staleBefore: input.staleBefore,
          });
          if (unresolved.length > 0) {
            if (!input.providerCredentialRemoved) {
              return { kind: "cleanup-required" } as const;
            }
            for (const prior of unresolved) {
              yield* insertReconciledEvent(tx, {
                attempt: input.attempt,
                prior,
                occurredAt: input.claimedAt,
              });
            }
          }

          const occupied = yield* occupiedVariances(tx, input.attempt);
          const variance = standaloneAccessCodeProviderVariances.find(
            (candidate) => !occupied.includes(candidate)
          );
          if (variance === undefined) return { kind: "exhausted" } as const;

          const inserted = yield* insertStartedEvent(tx, {
            attempt: input.attempt,
            variance,
            claimedAt: input.claimedAt,
          });
          if (inserted.length > 0) {
            return { kind: "claimed", variance } as const;
          }

          const [raced] = yield* findStartedEvent(tx, input.attempt.attemptId);
          if (!raced) {
            return yield* new StandaloneAccessCodeAttemptLogStorageError({
              operation: "claim",
              attemptId: input.attempt.attemptId,
              message:
                "Concurrent attempt claim could not be read after conflict.",
            });
          }
          return yield* resolveReplay(tx, raced, input);
        });

      return StandaloneAccessCodeAttemptLogRepository.of({
        claim: Effect.fn("StandaloneAccessCodeAttemptLogRepository.claim")(
          function* (input) {
            const windowKey = `${input.attempt.deviceId}|${input.attempt.startsAt.toString()}|${input.attempt.endsAt.toString()}`;
            return yield* db
              .transaction((tx) =>
                tx
                  .execute(
                    sql`select pg_advisory_xact_lock(hashtext('standalone-access-code'), hashtext(${windowKey}))`
                  )
                  .pipe(Effect.andThen(claimInTransaction(tx, input)))
              )
              .pipe(
                Effect.mapError(
                  (cause) =>
                    new StandaloneAccessCodeAttemptLogStorageError({
                      operation: "claim",
                      attemptId: input.attempt.attemptId,
                      message:
                        "Standalone access-code attempt could not be claimed.",
                      cause,
                    })
                )
              );
          }
        ),
        appendTerminal: Effect.fn(
          "StandaloneAccessCodeAttemptLogRepository.appendTerminal"
        )(function* (input) {
          return yield* db
            .transaction((tx) =>
              Effect.gen(function* () {
                const written = yield* insertTerminalEvent(tx, {
                  attempt: input.attempt,
                  variance: input.variance,
                  eventKind: input.eventKind,
                  occurredAt: input.occurredAt,
                  providerCredentialId: input.providerCredentialId ?? null,
                  providerStatusCode: input.providerStatusCode ?? null,
                  failureCode: input.failureCode ?? null,
                });
                if (written.length > 0) {
                  return { kind: "appended" } as const;
                }

                const [existing] = yield* findTerminalEvent(
                  tx,
                  input.attempt.attemptId
                );
                if (!existing) {
                  return yield* new StandaloneAccessCodeAttemptLogStorageError({
                    operation: "append_terminal",
                    attemptId: input.attempt.attemptId,
                    message:
                      "Conflicting standalone access-code terminal event could not be read.",
                  });
                }

                const stored = resolveTerminalEvent(existing);
                if (stored.kind === "in-progress") {
                  return yield* new StandaloneAccessCodeAttemptLogStorageError({
                    operation: "append_terminal",
                    attemptId: input.attempt.attemptId,
                    message:
                      "Conflicting standalone access-code terminal event did not resolve to a terminal outcome.",
                  });
                }
                return {
                  kind: "already-terminal",
                  terminal: stored,
                } as const;
              })
            )
            .pipe(
              Effect.mapError(
                (cause) =>
                  new StandaloneAccessCodeAttemptLogStorageError({
                    operation: "append_terminal",
                    attemptId: input.attempt.attemptId,
                    message:
                      "Standalone access-code terminal event could not be written.",
                    cause,
                  })
              )
            );
        }),
      });
    })
  );

  static Live = this.Default.pipe(Layer.provide(WorkspaceDatabase.Default));
}
