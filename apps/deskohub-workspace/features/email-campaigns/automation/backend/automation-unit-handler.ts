import type {
  ExternalAPIError,
  NetworkError,
  ValidationError,
} from "@deskohub/dotypos";
import { Data, Effect, Option, Schema } from "effect";
import type { WorkspaceDatabaseClient } from "@/db/database.service";
import type { DatabaseQueryError } from "@/db/sql-constraint";
import type { ReservationVisitsUnavailable } from "@/features/reservation/backend/reservation-visits.service";
import type { CampaignId, CampaignSendId } from "../../campaign-identifiers";
import type { AutomationWorkUnitId } from "../automation-identifiers";
import type { AutomationWorkUnitKind } from "../automation-work-units";

export type AutomationEngineTransaction = Parameters<
  Parameters<WorkspaceDatabaseClient["transaction"]>[0]
>[0];

/** A claimed unit as its handler sees it. */
export type ClaimedAutomationUnit<Subject> = {
  readonly id: AutomationWorkUnitId;
  readonly kind: AutomationWorkUnitKind;
  readonly key: string;
  /** Null for sweep pages and intake. */
  readonly campaignId: CampaignId | null;
  readonly subject: Subject;
  /** Planned Dotypos requests. */
  readonly requestCost: number;
  /** Starts at 1 and counts every claim, including this one. */
  readonly attempt: number;
  readonly deadlineMisses: number;
};

/**
 * A unit whose commit persisted a send: it set the unit's `send_id` (§5.9).
 * The unit holds its claim and slot until the send settles, and only the
 * send's id matters from then on, so the subject isn't decoded again.
 */
type PersistedAutomationUnit = Omit<
  ClaimedAutomationUnit<unknown>,
  "subject"
> & {
  readonly sendId: CampaignSendId;
};

/**
 * The writes that settle a submitted send. The processor runs them in the
 * transaction that settles the unit `done`, before its claim CAS and the
 * slot hand-off, so the unit settles only with its send.
 */
type AutomationUnitSettlement = (
  tx: AutomationEngineTransaction,
  at: Temporal.Instant
) => Effect.Effect<void, AutomationUnitDefect | DatabaseQueryError>;

/**
 * Submits a persisted send outside any transaction. A failure returns the
 * unit to `enqueued`, keeping its slot; nothing drops or fails it.
 */
export type AutomationUnitSubmit = (
  unit: PersistedAutomationUnit
) => Effect.Effect<
  AutomationUnitSettlement,
  AutomationUnitFetchFailure | AutomationUnitDefect | DatabaseQueryError
>;

/**
 * A unit to plan. It's inserted `planned` and holds no slot until a hand-off
 * or the planner's top-up promotes it; a key that already exists is a no-op.
 */
export type PlannedAutomationUnit = {
  readonly kind: AutomationWorkUnitKind;
  /** Deterministic per kind, such as `sweep-page:<source>:<window>:<page>`. */
  readonly key: string;
  readonly campaignId?: CampaignId;
  /** The encoded subject: ids and windows only, never a fetched fact. */
  readonly subject: Schema.Json;
  readonly requestCost: number;
};

/**
 * A failure that proves nothing about the subject, such as a Dotypos 429,
 * 5xx, timeout or network error. The unit returns to `enqueued`, keeps its
 * slot and is redelivered by the queue.
 */
export class AutomationUnitFetchFailure extends Data.TaggedError(
  "AutomationUnitFetchFailure"
)<{
  /** Stored as `last_error_code`; stable and low-cardinality. */
  readonly code: string;
  readonly cause?: unknown;
}> {
  static readonly fromDotypos = (
    cause: ValidationError | ExternalAPIError | NetworkError
  ) =>
    new AutomationUnitFetchFailure({ code: dotyposFailureCode(cause), cause });

  static readonly fromReservationVisits = (
    unavailable: ReservationVisitsUnavailable
  ) =>
    new AutomationUnitFetchFailure({
      code: dotyposFailureCode(unavailable.cause),
      cause: unavailable,
    });
}

/** A low-cardinality `last_error_code` for a failed Dotypos read. */
const dotyposFailureCode = (
  cause: ValidationError | ExternalAPIError | NetworkError
) => {
  switch (cause._tag) {
    case "ExternalAPIError":
      return cause.statusCode === undefined
        ? "dotypos-error"
        : `dotypos-${cause.statusCode}`;
    case "NetworkError":
      return "dotypos-network";
    case "ValidationError":
      return "dotypos-invalid-response";
  }
};

/**
 * A commit whose lifecycle recheck failed (§5.4): the automation is no
 * longer active, or the fire no longer entering. The processor rolls the
 * commit back and settles the unit `dropped`, freeing its subjects where
 * they stand for the planner to replan after resume (§5.2).
 */
export class AutomationUnitRecheckFailed extends Data.TaggedError(
  "AutomationUnitRecheckFailed"
)<{
  /** Stored as `last_error_code`, such as `automation-paused`. */
  readonly code: string;
}> {}

/**
 * After this many deadline misses a solo unit's subjects count as
 * unavailable (§5.3); its handler's `expire` settles them.
 */
export const automationUnitDeadlineMissLimit = 3;

/** What `expire` left for the fetch. */
export type AutomationUnitExpiry = "remaining" | "settled";

/** A unit that can never succeed, such as a subject that no longer decodes. It settles `failed`. */
export class AutomationUnitDefect extends Data.TaggedError(
  "AutomationUnitDefect"
)<{
  /** Stored as `last_error_code`; stable and low-cardinality. */
  readonly code: string;
  readonly cause?: unknown;
}> {}

/**
 * One unit kind. The processor decodes the subject, runs `fetch` outside any
 * transaction under the unit deadline, samples the instant, then runs
 * `commit` inside its single commit transaction before the claim CAS, so
 * domain rows lock before the unit row and the slot lock (§5.4). A commit
 * whose claim CAS fails rolls back with the handler's writes.
 */
export interface AutomationUnitHandler<Subject, Fetched> {
  readonly kind: AutomationWorkUnitKind;
  readonly subject: Schema.Codec<Subject, Schema.Json>;
  /**
   * §5.2 step 2: settles, locally and before any fetch, the subjects past
   * their limit (24 hours, or `automationUnitDeadlineMissLimit` misses for a
   * solo unit), and reports whether any subject is left to fetch. The
   * processor runs it in a transaction guarded by the claim; when it returns
   * `settled`, that transaction also settles the unit `done`, so its writes
   * commit at most once. A `remaining` expiry commits without settling the
   * unit and may run again, so it must read the subjects' current rows to
   * make a repeated call a no-op. Kinds without a limit omit it.
   */
  readonly expire?: (
    tx: AutomationEngineTransaction,
    unit: ClaimedAutomationUnit<Subject>,
    at: Temporal.Instant
  ) => Effect.Effect<
    AutomationUnitExpiry,
    AutomationUnitDefect | DatabaseQueryError
  >;
  /** At most `requestCost` sequential requests; returns in-memory facts only. */
  readonly fetch: (
    unit: ClaimedAutomationUnit<Subject>
  ) => Effect.Effect<
    Fetched,
    AutomationUnitFetchFailure | AutomationUnitDefect
  >;
  /** Writes the decisions and returns the follow-up units to plan. */
  readonly commit: (
    tx: AutomationEngineTransaction,
    unit: ClaimedAutomationUnit<Subject>,
    fetched: Fetched,
    at: Temporal.Instant
  ) => Effect.Effect<
    ReadonlyArray<PlannedAutomationUnit>,
    AutomationUnitDefect | AutomationUnitRecheckFailed | DatabaseQueryError
  >;
  /**
   * Submits the send a commit persisted by setting the unit's `send_id`
   * (§5.9), and returns the writes that settle it. Right after that commit,
   * `fetched` holds this invocation's facts. A unit claimed again with
   * `send_id` gets `None`: it skips the cancellation mark, `expire`, `fetch`
   * and `commit` and only submits, whatever the campaign's status, since
   * the send may already have reached the provider. Kinds that never
   * persist a send omit it.
   */
  readonly submit?: (
    unit: PersistedAutomationUnit,
    fetched: Option.Option<Fetched>
  ) => ReturnType<AutomationUnitSubmit>;
}

/** Commits a fetched unit at the instant sampled after its fetch. */
type AutomationUnitCommit = (
  tx: AutomationEngineTransaction,
  at: Temporal.Instant
) => Effect.Effect<
  ReadonlyArray<PlannedAutomationUnit>,
  AutomationUnitDefect | AutomationUnitRecheckFailed | DatabaseQueryError
>;

/** A fetched unit: its commit, and the submit for a send that commit persists. */
export type FetchedAutomationUnit = {
  readonly commit: AutomationUnitCommit;
  readonly submit?: AutomationUnitSubmit;
};

/** A handler with its subject and fetched types closed over, so a registry can hold every kind. */
export interface RegisteredAutomationUnitHandler {
  readonly kind: AutomationWorkUnitKind;
  readonly expire?: (
    tx: AutomationEngineTransaction,
    unit: ClaimedAutomationUnit<unknown>,
    at: Temporal.Instant
  ) => Effect.Effect<
    AutomationUnitExpiry,
    AutomationUnitDefect | DatabaseQueryError
  >;
  readonly fetch: (
    unit: ClaimedAutomationUnit<unknown>
  ) => Effect.Effect<
    FetchedAutomationUnit,
    AutomationUnitFetchFailure | AutomationUnitDefect
  >;
  /** Submits a send an earlier invocation persisted. */
  readonly submit?: AutomationUnitSubmit;
}

export const registerAutomationUnitHandler = <Subject, Fetched>(
  handler: AutomationUnitHandler<Subject, Fetched>
): RegisteredAutomationUnitHandler => {
  const decode = (unit: ClaimedAutomationUnit<unknown>) =>
    Schema.decodeUnknownEffect(handler.subject)(unit.subject).pipe(
      Effect.mapError(
        (cause) =>
          new AutomationUnitDefect({ code: "subject-undecodable", cause })
      ),
      Effect.map((subject) => ({ ...unit, subject }))
    );
  const { expire, submit } = handler;

  return {
    kind: handler.kind,
    ...(expire !== undefined && {
      expire: (tx, unit, at) =>
        decode(unit).pipe(Effect.flatMap((decoded) => expire(tx, decoded, at))),
    }),
    fetch: (unit) =>
      decode(unit).pipe(
        Effect.flatMap((decoded) =>
          handler.fetch(decoded).pipe(
            Effect.map(
              (fetched): FetchedAutomationUnit => ({
                commit: (tx, at) => handler.commit(tx, decoded, fetched, at),
                ...(submit !== undefined && {
                  submit: (persisted) =>
                    submit(persisted, Option.some(fetched)),
                }),
              })
            )
          )
        )
      ),
    ...(submit !== undefined && {
      submit: (persisted) => submit(persisted, Option.none()),
    }),
  };
};
