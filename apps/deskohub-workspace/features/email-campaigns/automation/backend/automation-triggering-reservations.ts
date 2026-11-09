import { asc, inArray } from "drizzle-orm";
import { Effect } from "effect";
import { WorkspaceTransaction } from "@/db/database.service";
import { workspaceReservations } from "@/db/schema";
import type { WorkspaceReservationId } from "@/features/reservation/persistence-contracts";

/**
 * Locks the triggering reservations `FOR SHARE`, in id order, and returns
 * those Workspace cancelled (D28). Callers take it after the lifecycle lock;
 * it holds a Workspace cancellation back until the caller commits.
 */
export const lockTriggeringReservations = (
  reservationIds: readonly (WorkspaceReservationId | null)[]
) =>
  Effect.flatMap(WorkspaceTransaction, ({ db }) =>
    Effect.succeed(
      [...new Set(reservationIds.filter((id) => id !== null))].sort()
    ).pipe(
      Effect.flatMap((ids) =>
        ids.length === 0
          ? Effect.succeed([])
          : db
              .select({
                id: workspaceReservations.id,
                cancelledAt: workspaceReservations.reservationCancelledAt,
              })
              .from(workspaceReservations)
              .where(inArray(workspaceReservations.id, ids))
              .orderBy(asc(workspaceReservations.id))
              .for("share")
      ),
      Effect.map(
        (rows): ReadonlySet<WorkspaceReservationId> =>
          new Set(
            rows.flatMap((row) => (row.cancelledAt === null ? [] : [row.id]))
          )
      )
    )
  );
