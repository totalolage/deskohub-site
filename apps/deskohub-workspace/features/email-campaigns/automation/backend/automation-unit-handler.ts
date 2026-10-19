import type {
  ExternalAPIError,
  NetworkError,
  ValidationError,
} from "@deskohub/dotypos";
import { Data, Effect, Schema } from "effect";
import type { WorkspaceDatabaseClient } from "@/db/database.service";
import type { DatabaseQueryError } from "@/db/sql-constraint";
import type { ReservationVisitsUnavailable } from "@/features/reservation/backend/reservation-visits.service";
import type { CampaignId } from "../../campaign-identifiers";
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
    AutomationUnitDefect | DatabaseQueryError
  >;
}

/** Commits a fetched unit at the instant sampled after its fetch. */
export type AutomationUnitCommit = (
  tx: AutomationEngineTransaction,
  at: Temporal.Instant
) => Effect.Effect<
  ReadonlyArray<PlannedAutomationUnit>,
  AutomationUnitDefect | DatabaseQueryError
>;

/** A handler with its subject and fetched types closed over, so a registry can hold every kind. */
export interface RegisteredAutomationUnitHandler {
  readonly kind: AutomationWorkUnitKind;
  readonly fetch: (
    unit: ClaimedAutomationUnit<unknown>
  ) => Effect.Effect<
    AutomationUnitCommit,
    AutomationUnitFetchFailure | AutomationUnitDefect
  >;
}

export const registerAutomationUnitHandler = <Subject, Fetched>(
  handler: AutomationUnitHandler<Subject, Fetched>
): RegisteredAutomationUnitHandler => ({
  kind: handler.kind,
  fetch: (unit) =>
    Schema.decodeUnknownEffect(handler.subject)(unit.subject).pipe(
      Effect.mapError(
        (cause) =>
          new AutomationUnitDefect({ code: "subject-undecodable", cause })
      ),
      Effect.map((subject) => ({ ...unit, subject })),
      Effect.flatMap((decoded) =>
        handler.fetch(decoded).pipe(
          Effect.map(
            (fetched): AutomationUnitCommit =>
              (tx, at) =>
                handler.commit(tx, decoded, fetched, at)
          )
        )
      )
    ),
});
