import "server-only";

import type { DotyposCustomerId } from "@deskohub/dotypos";
import type {
  AutomationTriggerType as AutomationTrigger,
  ReservationProductFilterType,
} from "@deskohub/workspace-admin-api";
import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  like,
  lt,
  lte,
  max,
  ne,
  type SQL,
  sql,
} from "drizzle-orm";
import { Effect, Match, Option } from "effect";
import {
  type WorkspaceDatabaseClient,
  WorkspaceTransaction,
} from "@/db/database.service";
import {
  customerEvents,
  emailCampaignAutomationPreviewRows as previewRows,
  emailCampaignAutomationPreviews as previews,
  emailCampaignAutomationWorkUnits as units,
  workspaceReservations,
} from "@/db/schema";
import type { DatabaseQueryError } from "@/db/sql-constraint";
import type { WorkspaceReservationId } from "@/features/reservation/persistence-contracts";
import type {
  CustomerEventId,
  CustomerEventKind,
} from "@/shared/backend/customer-events/customer-event";
import { reservationProductCondition } from "../../backend/reservation-product-condition";
import type { DryRunOutcome } from "../automation-dry-run-simulation";
import type {
  AutomationPreviewId,
  AutomationWorkUnitId,
} from "../automation-identifiers";
import {
  type AutomationPreviewOutcome,
  automationPreviewOutcomes,
} from "../automation-states";
import { triggeringCustomerEvent } from "./automation-triggering-events";

export type AutomationPreviewRow = typeof previews.$inferSelect;

/** How far back an event-trigger dry run replays (D20). */
const replayWindow = { hours: 30 * 24 } as const;

/** The most events one replay evaluates; `events_total` counts the rest. */
export const replayEventLimit = 1000;

/** A running dry run with no progress for this long has failed. */
const previewStallLimit = { hours: 1 } as const;

/** Stored on a dry run that stalled. */
const previewStalledCode = "preview-stalled";

/** The events of the trigger's kind a replay evaluates. */
export type ReplayEventScope = {
  readonly kind: CustomerEventKind;
  /** Reservation triggers only: the trigger's product filter (D27). */
  readonly product: Option.Option<ReservationProductFilterType>;
  /** Events in `[asOf − 30 days, asOf)`. */
  readonly asOf: Temporal.Instant;
  /**
   * Events recorded by then, so an event the sweep records late doesn't
   * shift which 1,000 a running replay evaluates.
   */
  readonly recordedBy: Temporal.Instant;
};

/** One replayed event, ids and times only (D35). */
export type ReplayEvent = {
  readonly id: CustomerEventId;
  readonly occurredAt: Temporal.Instant;
  readonly dotyposCustomerId: DotyposCustomerId;
  readonly workspaceReservationId: WorkspaceReservationId | null;
};

/**
 * The events an event trigger's dry run replays: its kind, with a
 * reservation trigger's product filter. None for a schedule.
 */
export const replayEventScope = (
  trigger: AutomationTrigger,
  preview: Pick<AutomationPreviewRow, "asOf" | "createdAt">
): Option.Option<ReplayEventScope> => {
  const scope = (
    kind: CustomerEventKind,
    product?: ReservationProductFilterType
  ) =>
    Option.some<ReplayEventScope>({
      kind,
      product: Option.fromUndefinedOr(product),
      asOf: preview.asOf,
      recordedBy: preview.createdAt,
    });
  return Match.value(trigger).pipe(
    Match.tagsExhaustive({
      Schedule: () => Option.none(),
      ReservationBooked: ({ product }) => scope("reservation-booked", product),
      ReservationCancelled: ({ product }) =>
        scope("reservation-cancelled", product),
      ReservationStarted: ({ product }) =>
        scope("reservation-started", product),
      ReservationFinished: ({ product }) =>
        scope("reservation-finished", product),
      AccountCreated: () => scope("account-created"),
    })
  );
};

const replayEventCondition = (scope: ReplayEventScope): SQL =>
  and(
    eq(customerEvents.kind, scope.kind),
    gte(customerEvents.occurredAt, scope.asOf.subtract(replayWindow)),
    lt(customerEvents.occurredAt, scope.asOf),
    lte(customerEvents.recordedAt, scope.recordedBy),
    triggeringCustomerEvent,
    Option.match(scope.product, {
      onNone: () => undefined,
      onSome: reservationProductCondition,
    })
  )!;

/** Product conditions read the triggering reservation's snapshot. */
const eventsWithReservations = (db: Pick<WorkspaceDatabaseClient, "select">) =>
  db
    .select({
      id: customerEvents.id,
      occurredAt: customerEvents.occurredAt,
      dotyposCustomerId: customerEvents.dotyposCustomerId,
      workspaceReservationId: customerEvents.workspaceReservationId,
    })
    .from(customerEvents)
    .leftJoin(
      workspaceReservations,
      eq(workspaceReservations.id, customerEvents.workspaceReservationId)
    );

/** How many events the replay window holds, before truncation. */
export const countReplayEvents = (
  scope: ReplayEventScope
): Effect.Effect<number, DatabaseQueryError, WorkspaceTransaction> =>
  Effect.flatMap(WorkspaceTransaction, ({ db }) =>
    db
      .select({ events: count() })
      .from(customerEvents)
      .leftJoin(
        workspaceReservations,
        eq(workspaceReservations.id, customerEvents.workspaceReservationId)
      )
      .where(replayEventCondition(scope))
      .pipe(Effect.map(([row]) => row?.events ?? 0))
  );

/**
 * The latest 1,000 events of the replay window, optionally only the given
 * customers' among them, in time order.
 */
export const selectReplayEvents = (
  scope: ReplayEventScope,
  customers?: readonly DotyposCustomerId[]
): Effect.Effect<
  readonly ReplayEvent[],
  DatabaseQueryError,
  WorkspaceTransaction
> =>
  Effect.flatMap(WorkspaceTransaction, ({ db }) => {
    const latest = eventsWithReservations(db)
      .where(replayEventCondition(scope))
      .orderBy(desc(customerEvents.occurredAt), desc(customerEvents.id))
      .limit(replayEventLimit)
      .as("latest");
    return db
      .select()
      .from(latest)
      .where(
        customers === undefined
          ? undefined
          : inArray(latest.dotyposCustomerId, [...customers])
      )
      .orderBy(asc(latest.occurredAt), asc(latest.id));
  });

/** Units of one dry run, by their `preview:<previewId>:<n>` keys. */
const unitsOf = (previewId: AutomationPreviewId) =>
  like(units.key, `preview:${previewId}:%`);

/**
 * Ends a running dry run as superseded or failed, dropping its planned
 * units, which hold no slot, and marking its enqueued and claimed ones,
 * which keep their slots until their claimant or the reaper settles them.
 * A dry run that is no longer running is left alone.
 */
export const closePreview = (input: {
  readonly previewId: AutomationPreviewId;
  readonly status: "superseded" | "failed";
  readonly errorCode?: string;
  readonly at: Temporal.Instant;
  /** A unit closing its own dry run, so its commit still settles it `done`. */
  readonly committingUnit?: AutomationWorkUnitId;
}): Effect.Effect<boolean, DatabaseQueryError, WorkspaceTransaction> =>
  Effect.flatMap(WorkspaceTransaction, ({ db }) =>
    db
      .update(previews)
      .set({
        status: input.status,
        errorCode: input.errorCode ?? null,
        completedAt: input.at,
      })
      .where(
        and(eq(previews.id, input.previewId), eq(previews.status, "running"))
      )
      .returning({ id: previews.id })
      .pipe(
        Effect.tap(([closed]) =>
          closed === undefined
            ? Effect.void
            : Effect.all(
                [
                  db
                    .update(units)
                    .set({ status: "dropped", settledAt: input.at })
                    .where(
                      and(unitsOf(input.previewId), eq(units.status, "planned"))
                    ),
                  db
                    .update(units)
                    .set({ cancelRequestedAt: input.at })
                    .where(
                      and(
                        unitsOf(input.previewId),
                        inArray(units.status, ["enqueued", "claimed"]),
                        isNull(units.cancelRequestedAt),
                        input.committingUnit === undefined
                          ? undefined
                          : ne(units.id, input.committingUnit)
                      )
                    ),
                ],
                { discard: true }
              )
        ),
        Effect.map(([closed]) => closed !== undefined)
      )
  );

/**
 * Fails a running dry run whose last progress, its creation or a unit's
 * commit, is more than an hour before `at`, and returns the dry run as it
 * stands afterwards.
 */
export const failStalledPreview = (
  preview: AutomationPreviewRow,
  at: Temporal.Instant
): Effect.Effect<
  AutomationPreviewRow,
  DatabaseQueryError,
  WorkspaceTransaction
> =>
  Effect.flatMap(WorkspaceTransaction, ({ db }) =>
    preview.status !== "running"
      ? Effect.succeed(preview)
      : db
          .select({ lastSettledAt: max(units.settledAt) })
          .from(units)
          .where(and(unitsOf(preview.id), eq(units.status, "done")))
          .pipe(
            Effect.map(([row]) =>
              [
                preview.createdAt,
                row?.lastSettledAt ?? preview.createdAt,
              ].reduce((latest, instant) =>
                Temporal.Instant.compare(instant, latest) > 0 ? instant : latest
              )
            ),
            Effect.flatMap((lastProgressAt) =>
              Temporal.Instant.compare(
                lastProgressAt.add(previewStallLimit),
                at
              ) > 0
                ? Effect.succeed(preview)
                : closePreview({
                    previewId: preview.id,
                    status: "failed",
                    errorCode: previewStalledCode,
                    at,
                  }).pipe(
                    Effect.as({
                      ...preview,
                      status: "failed" as const,
                      errorCode: previewStalledCode,
                      completedAt: at,
                    })
                  )
            )
          )
  );

/** One computed row of a dry run, as stored. */
export type AutomationPreviewOutcomeRow = DryRunOutcome & {
  readonly dotyposCustomerId: DotyposCustomerId;
  readonly customerEventId: CustomerEventId | null;
  /**
   * A replayed row whose conditions read a reservation status that changed
   * since its trigger in a way Workspace can't date, so they read it
   * approximately, or a row that depends on such an earlier row of the
   * customer (see `AutomationDryRunRow`).
   */
  readonly reservationStatusesApproximate?: boolean;
};

/**
 * Records one unit's rows on its running dry run: rows a retry or another
 * unit already wrote are skipped by the primary key, the counts grow by
 * the rows actually written, and the last unit completes the dry run.
 */
export const recordPreviewUnit = (input: {
  readonly previewId: AutomationPreviewId;
  readonly rows: readonly AutomationPreviewOutcomeRow[];
  readonly at: Temporal.Instant;
}): Effect.Effect<void, DatabaseQueryError, WorkspaceTransaction> =>
  Effect.flatMap(WorkspaceTransaction, ({ db }) =>
    insertRows(input).pipe(
      Effect.flatMap((written) => {
        const done = sql`${previews.unitsDone} + 1 >= ${previews.unitsTotal}`;
        return db
          .update(previews)
          .set({
            unitsDone: sql`${previews.unitsDone} + 1`,
            counts: addedCounts(written.map(({ outcome }) => outcome)),
            status: sql`case when ${done} then 'completed' else ${previews.status} end`,
            completedAt: sql`case when ${done} then ${input.at.toString({ smallestUnit: "microsecond" })}::timestamptz else ${previews.completedAt} end`,
          })
          .where(
            and(
              eq(previews.id, input.previewId),
              eq(previews.status, "running")
            )
          );
      }),
      Effect.asVoid
    )
  );

/** Inserts the rows no earlier commit wrote, returning their outcomes. */
const insertRows = (input: {
  readonly previewId: AutomationPreviewId;
  readonly rows: readonly AutomationPreviewOutcomeRow[];
}): Effect.Effect<
  readonly { readonly outcome: AutomationPreviewOutcome }[],
  DatabaseQueryError,
  WorkspaceTransaction
> =>
  Effect.flatMap(WorkspaceTransaction, ({ db }) =>
    input.rows.length === 0
      ? Effect.succeed([])
      : db
          .insert(previewRows)
          .values(
            input.rows.map((row) => ({
              previewId: input.previewId,
              dotyposCustomerId: row.dotyposCustomerId,
              triggerAt: row.triggerAt,
              customerEventId: row.customerEventId,
              outcome: row.outcome,
              stepId: row.stepId,
              sendAt: row.sendAt,
              projected: row.projected,
              reservationStatusesApproximate:
                row.reservationStatusesApproximate ?? false,
            }))
          )
          .onConflictDoNothing()
          .returning({ outcome: previewRows.outcome })
  );

/** The stored counts plus the written outcomes, every outcome present. */
const addedCounts = (written: readonly AutomationPreviewOutcome[]) =>
  sql`jsonb_build_object(${sql.join(
    automationPreviewOutcomes.map(
      (outcome) =>
        sql`${outcome}::text, coalesce((${previews.counts} ->> ${outcome}::text)::integer, 0) + ${
          written.filter((value) => value === outcome).length
        }::integer`
    ),
    sql`, `
  )})`;

/** A dry run's stored counts, with every outcome present. */
export const previewCounts = (
  counts: AutomationPreviewRow["counts"]
): Record<AutomationPreviewOutcome, number> =>
  Object.fromEntries(
    automationPreviewOutcomes.map((outcome) => [outcome, counts[outcome] ?? 0])
  ) as Record<AutomationPreviewOutcome, number>;
