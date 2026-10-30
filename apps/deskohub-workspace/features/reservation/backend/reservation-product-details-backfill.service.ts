import { type DotyposReservationId, DotyposService } from "@deskohub/dotypos";
import { and, asc, eq, gt, inArray, sql } from "drizzle-orm";
import {
  Array as Arr,
  Context,
  Data,
  Effect,
  Layer,
  Match,
  Option,
  Result,
} from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import {
  type WorkspaceReservationRow,
  workspaceReservations,
} from "@/db/schema/workspace-reservations";
import {
  type BookedInterval,
  type BookedReservation,
  decodeBookedReservation,
} from "@/features/reservation/backend/booked-reservation";
import { StoredReservationDetails } from "@/features/reservation/backend/stored-reservation-details.server";
import { getMeetingRoomEarlySetupField } from "@/features/reservation/meeting-room-early-setup";
import { findMeetingRoomReservationDuration } from "@/features/reservation/meeting-room-reservation-time";
import { getOfficeReservationSelection } from "@/features/reservation/office-reservation";
import type {
  StoredWorkspaceReservationDetails,
  WorkspaceReservationId,
} from "@/features/reservation/persistence-contracts";
import {
  meetingRoomReservationKind,
  officeReservationKind,
} from "@/features/reservation/reservation-kind";
import { WorkspaceDotyposLayer } from "@/shared/backend/config/dotypos.config";

/** Rows read, and Dotypos reservations requested, per batch. */
const reservationProductDetailsBackfillBatchSize = 50;

const backfilledFamilies = [meetingRoomReservationKind, officeReservationKind];

type ReservationProductDetailsBackfillFamily =
  (typeof backfilledFamilies)[number];

type ReservationProductDetailsUnresolvedReason =
  | "stored_details_malformed"
  | "dotypos_reservation_id_missing"
  | "dotypos_reservation_not_found"
  | "dotypos_interval_invalid"
  | "interval_not_in_catalog"
  | "dotypos_seats_invalid";

export type ReservationProductDetailsBackfillBatch = {
  readonly updated: number;
  readonly alreadyComplete: number;
  readonly unresolved: readonly {
    readonly reservationId: WorkspaceReservationId;
    readonly family: ReservationProductDetailsBackfillFamily;
    readonly reason: ReservationProductDetailsUnresolvedReason;
  }[];
  /** Pass as `after` for the next batch; null once every row was read. */
  readonly nextCursor: WorkspaceReservationId | null;
};

class ReservationProductDetailsBackfillError extends Data.TaggedError(
  "ReservationProductDetailsBackfillError"
)<{ readonly message: string; readonly cause: unknown }> {}

interface IReservationProductDetailsBackfill {
  /**
   * Fills the catalog identity of meeting-room and office snapshots written
   * before snapshots recorded it, from the booked Dotypos interval and seats.
   * Reads one batch of rows after `after` in ID order. Rows that already have
   * it, and rows it can't resolve, are left as they are, so it's idempotent.
   */
  readonly runBatch: (input: {
    readonly after: WorkspaceReservationId | null;
    readonly dryRun: boolean;
  }) => Effect.Effect<
    ReservationProductDetailsBackfillBatch,
    ReservationProductDetailsBackfillError
  >;
}

type DotyposReservation = Effect.Success<
  ReturnType<DotyposService["Service"]["listReservations"]>
>[number];

type BackfillRow = {
  readonly id: WorkspaceReservationId;
  readonly family: ReservationProductDetailsBackfillFamily;
  readonly dotyposReservationId: DotyposReservationId | null;
  readonly reservationDetails: WorkspaceReservationRow["reservationDetails"];
};

type IncompleteRow = BackfillRow & {
  readonly dotyposReservationId: DotyposReservationId;
  readonly storedDetails: StoredWorkspaceReservationDetails;
};

type ResolvedRow = IncompleteRow & {
  readonly details: StoredWorkspaceReservationDetails;
};

type UnresolvedRow =
  ReservationProductDetailsBackfillBatch["unresolved"][number];

// The batch reads only backfilled families.
const storedFamily = sql<ReservationProductDetailsBackfillFamily>`${StoredReservationDetails.kind}`;

const isComplete = Match.type<StoredWorkspaceReservationDetails>().pipe(
  Match.discriminatorsExhaustive("kind")({
    // Cowork snapshots have no catalog identity to fill.
    cowork: () => true,
    "meeting-room": ({ duration }) => duration !== undefined,
    office: ({ seats, dayCount }) =>
      seats !== undefined && dayCount !== undefined,
  })
);

const unresolvedRow = ({
  row,
  reason,
}: {
  readonly row: BackfillRow;
  readonly reason: ReservationProductDetailsUnresolvedReason;
}): UnresolvedRow => ({ reservationId: row.id, family: row.family, reason });

/** An incomplete row to resolve, none when the row is already complete. */
const triageRow = (
  row: BackfillRow
): Result.Result<Option.Option<IncompleteRow>, UnresolvedRow> => {
  const details = StoredReservationDetails.project(row.reservationDetails);
  if (Option.isNone(details)) {
    return Result.fail(
      unresolvedRow({ row, reason: "stored_details_malformed" })
    );
  }
  if (isComplete(details.value)) return Result.succeed(Option.none());
  const { dotyposReservationId } = row;
  if (dotyposReservationId === null) {
    return Result.fail(
      unresolvedRow({ row, reason: "dotypos_reservation_id_missing" })
    );
  }
  return Result.succeed(
    Option.some({ ...row, dotyposReservationId, storedDetails: details.value })
  );
};

const triageRows = ({ rows }: { readonly rows: readonly BackfillRow[] }) => {
  const [unresolved, pending] = Arr.partition(rows, triageRow);
  const incomplete = Arr.getSomes(pending);
  return {
    unresolved,
    incomplete,
    alreadyComplete: pending.length - incomplete.length,
  };
};

const resolveMeetingRoomDetails = (
  interval: BookedInterval,
  storedDetails: StoredWorkspaceReservationDetails
): Result.Result<
  StoredWorkspaceReservationDetails,
  ReservationProductDetailsUnresolvedReason
> =>
  Result.fromNullishOr(
    findMeetingRoomReservationDuration(interval),
    () => "interval_not_in_catalog" as const
  ).pipe(
    Result.map((duration) => ({
      kind: meetingRoomReservationKind,
      duration,
      ...(storedDetails.kind === meetingRoomReservationKind &&
        getMeetingRoomEarlySetupField(storedDetails)),
    }))
  );

const resolveOfficeDetails = ({
  seats,
  ...interval
}: BookedInterval & Pick<BookedReservation, "seats">): Result.Result<
  StoredWorkspaceReservationDetails,
  ReservationProductDetailsUnresolvedReason
> =>
  seats.pipe(
    Result.fromOption(() => "dotypos_seats_invalid" as const),
    Result.flatMap((seats) =>
      Result.fromNullishOr(
        getOfficeReservationSelection({ ...interval, seats }),
        () => "interval_not_in_catalog" as const
      )
    ),
    Result.map((selection) => ({ kind: officeReservationKind, ...selection }))
  );

/**
 * The full snapshot for an incomplete row, from the Dotypos reservation's
 * booked interval and seats only. The stored details say how to read the
 * interval: an early-setup meeting room is held from before its booked
 * start, and keeps that flag. The reservation note is freeform and never
 * read.
 */
const resolveDetails = ({
  family,
  reservation,
  storedDetails,
}: {
  readonly family: ReservationProductDetailsBackfillFamily;
  readonly reservation: DotyposReservation;
  readonly storedDetails: StoredWorkspaceReservationDetails;
}): Result.Result<
  StoredWorkspaceReservationDetails,
  ReservationProductDetailsUnresolvedReason
> => {
  const { interval, seats } = decodeBookedReservation(
    reservation,
    storedDetails
  );
  if (Option.isNone(interval)) return Result.fail("dotypos_interval_invalid");
  return Match.value(family).pipe(
    Match.when(meetingRoomReservationKind, () =>
      resolveMeetingRoomDetails(interval.value, storedDetails)
    ),
    Match.when(officeReservationKind, () =>
      resolveOfficeDetails({ ...interval.value, seats })
    ),
    Match.exhaustive
  );
};

const resolveRow = ({
  row,
  dotyposById,
}: {
  readonly row: IncompleteRow;
  readonly dotyposById: ReadonlyMap<
    DotyposReservation["id"],
    DotyposReservation
  >;
}): Result.Result<ResolvedRow, UnresolvedRow> =>
  Result.fromNullishOr(
    dotyposById.get(row.dotyposReservationId),
    () => "dotypos_reservation_not_found" as const
  ).pipe(
    Result.flatMap((reservation) =>
      resolveDetails({
        family: row.family,
        reservation,
        storedDetails: row.storedDetails,
      })
    ),
    Result.map((details) => ({ ...row, details })),
    Result.mapError((reason) => unresolvedRow({ row, reason }))
  );

const resolveRows = ({
  triaged: { incomplete },
  dotyposReservations,
}: {
  readonly triaged: { readonly incomplete: readonly IncompleteRow[] };
  readonly dotyposReservations: readonly DotyposReservation[];
}) => {
  const dotyposById = new Map(
    dotyposReservations.map(
      (reservation) => [reservation.id, reservation] as const
    )
  );
  const [unresolved, resolved] = Arr.partition(incomplete, (row) =>
    resolveRow({ row, dotyposById })
  );
  return { unresolved, resolved };
};

const nextCursor = ({ rows }: { readonly rows: readonly BackfillRow[] }) =>
  rows.length < reservationProductDetailsBackfillBatchSize
    ? null
    : (rows.at(-1)?.id ?? null);

export class ReservationProductDetailsBackfill extends Context.Service<
  ReservationProductDetailsBackfill,
  IReservationProductDetailsBackfill
>()("@deskohub-workspace/reservation/ReservationProductDetailsBackfill") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const { db } = yield* WorkspaceDatabase;
      const dotypos = yield* DotyposService;

      const fail = (message: string) => (cause: unknown) =>
        new ReservationProductDetailsBackfillError({ message, cause });

      const readRows = ({
        after,
      }: {
        readonly after: WorkspaceReservationId | null;
      }) =>
        db
          .select({
            id: workspaceReservations.id,
            family: storedFamily,
            dotyposReservationId: workspaceReservations.dotyposReservationId,
            reservationDetails: workspaceReservations.reservationDetails,
          })
          .from(workspaceReservations)
          .where(
            and(
              inArray(storedFamily, backfilledFamilies),
              after === null ? undefined : gt(workspaceReservations.id, after)
            )
          )
          .orderBy(asc(workspaceReservations.id))
          .limit(reservationProductDetailsBackfillBatchSize)
          .pipe(Effect.mapError(fail("Reservations could not be read.")));

      const loadDotyposReservations = ({
        incomplete,
      }: {
        readonly incomplete: readonly IncompleteRow[];
      }) =>
        dotypos
          .getReservationsByIds(
            incomplete.map(({ dotyposReservationId }) => dotyposReservationId)
          )
          .pipe(
            Effect.mapError(fail("Dotypos reservations could not be loaded.")),
            Effect.map((reservations) => [...reservations.values()]),
            Effect.when(Effect.succeed(incomplete.length > 0)),
            Effect.map(Option.getOrElse(() => []))
          );

      // Only the snapshot read above is replaced, so a concurrent change
      // wins. updated_at stays: it records business activity, and claims
      // compare it.
      const writeDetails = (row: ResolvedRow) =>
        db
          .update(workspaceReservations)
          .set({ reservationDetails: row.details })
          .where(
            and(
              eq(workspaceReservations.id, row.id),
              sql`${workspaceReservations.reservationDetails} = ${JSON.stringify(row.reservationDetails)}::jsonb`
            )
          )
          .returning({ id: workspaceReservations.id })
          .pipe(Effect.mapError(fail("A reservation could not be updated.")));

      /** Rows written; a dry run counts every resolved row instead. */
      const writeResolvedRows = ({
        resolution: { resolved },
        dryRun,
      }: {
        readonly resolution: { readonly resolved: readonly ResolvedRow[] };
        readonly dryRun: boolean;
      }) =>
        Effect.forEach(resolved, writeDetails).pipe(
          Effect.map((written) => written.flat().length),
          Effect.when(Effect.succeed(!dryRun)),
          Effect.map(Option.getOrElse(() => resolved.length))
        );

      return {
        runBatch: Effect.fn("ReservationProductDetailsBackfill.runBatch")(
          (input) =>
            Effect.succeed(input).pipe(
              Effect.bind("rows", readRows),
              Effect.let("triaged", triageRows),
              Effect.bind("dotyposReservations", ({ triaged }) =>
                loadDotyposReservations(triaged)
              ),
              Effect.let("resolution", resolveRows),
              Effect.bind("updated", writeResolvedRows),
              Effect.map(
                ({
                  rows,
                  triaged,
                  resolution,
                  updated,
                }): ReservationProductDetailsBackfillBatch => ({
                  updated,
                  alreadyComplete: triaged.alreadyComplete,
                  unresolved: [...triaged.unresolved, ...resolution.unresolved],
                  nextCursor: nextCursor({ rows }),
                })
              )
            )
        ),
      } satisfies IReservationProductDetailsBackfill;
    })
  );

  static Live = this.Default.pipe(
    Layer.provide(
      Layer.mergeAll(WorkspaceDatabase.Default, WorkspaceDotyposLayer)
    )
  );
}
