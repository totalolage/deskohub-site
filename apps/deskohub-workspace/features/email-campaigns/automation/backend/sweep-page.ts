import type { DotyposService } from "@deskohub/dotypos";
import { Effect, Option, Schema, SchemaGetter } from "effect";
import type { WorkspaceDatabase } from "@/db/database.service";
import {
  type ReservationActivityFetch,
  ReservationActivitySweep,
} from "@/features/reservation/backend/reservation-activity-sweep.service";
import type { ReservationActivityPage } from "@/features/reservation/backend/reservation-activity-sweep-window";
import {
  ReservationVisits,
  type ReservationVisitsUnavailable,
} from "@/features/reservation/backend/reservation-visits.service";
import { customerEventSweepSourceSchema } from "@/shared/backend/customer-events/customer-event";
import {
  type Instant,
  instantStringSchema,
  TemporalInstantSchema,
  temporalInstantToIsoString,
} from "@/shared/utils/temporal";
import {
  AutomationUnitFetchFailure,
  type AutomationUnitHandler,
  type PlannedAutomationUnit,
  registerAutomationUnitHandler,
} from "./automation-unit-handler";

/** Window bounds are whole milliseconds, so the ISO form round-trips exactly. */
const windowBoundSchema = instantStringSchema.pipe(
  Schema.decodeTo(TemporalInstantSchema, {
    decode: SchemaGetter.transform((value) => Temporal.Instant.from(value)),
    encode: SchemaGetter.transform(
      (value) => temporalInstantToIsoString(value) as Instant
    ),
  })
);

const sweepPageSubjectSchema = Schema.Struct({
  source: customerEventSweepSourceSchema,
  windowStartsAt: windowBoundSchema,
  windowEndsAt: windowBoundSchema,
  page: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
});
type SweepPageSubject = typeof sweepPageSubjectSchema.Type;

/** The `sweep-page` unit that fetches and records one page of a sweep source. */
export const plannedSweepPage = (
  page: ReservationActivityPage
): PlannedAutomationUnit => ({
  kind: "sweep-page",
  key: `sweep-page:${page.source}:${temporalInstantToIsoString(page.window.startsAt)}:${page.page}`,
  subject: Schema.encodeSync(sweepPageSubjectSchema)({
    source: page.source,
    windowStartsAt: page.window.startsAt,
    windowEndsAt: page.window.endsAt,
    page: page.page,
  }),
  requestCost: 1,
});

const toPage = (subject: SweepPageSubject): ReservationActivityPage => ({
  source: subject.source,
  window: { startsAt: subject.windowStartsAt, endsAt: subject.windowEndsAt },
  page: subject.page,
});

/**
 * Adapts `ReservationActivitySweep` to the engine. Each fetch builds a fresh
 * `ReservationVisits`, so no Dotypos fact outlives the invocation.
 */
export const makeSweepPageHandler = Effect.gen(function* () {
  const sweep = yield* ReservationActivitySweep;
  const context = yield* Effect.context<WorkspaceDatabase | DotyposService>();

  const handler: AutomationUnitHandler<
    SweepPageSubject,
    ReservationActivityFetch
  > = {
    kind: "sweep-page",
    subject: sweepPageSubjectSchema,
    fetch: (unit) =>
      sweep.fetchPage(toPage(unit.subject)).pipe(
        Effect.provide(ReservationVisits.Default),
        Effect.provideContext(context),
        Effect.mapError(
          (unavailable) =>
            new AutomationUnitFetchFailure({
              code: dotyposFailureCode(unavailable),
              cause: unavailable,
            })
        )
      ),
    commit: (tx, unit, fetched, at) =>
      sweep
        .commitPage(tx, toPage(unit.subject), fetched, at)
        .pipe(
          Effect.map((next) =>
            Option.toArray(Option.map(next, plannedSweepPage))
          )
        ),
  };

  return registerAutomationUnitHandler(handler);
});

/** A low-cardinality `last_error_code` for a failed Dotypos page read. */
const dotyposFailureCode = ({ cause }: ReservationVisitsUnavailable) => {
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
