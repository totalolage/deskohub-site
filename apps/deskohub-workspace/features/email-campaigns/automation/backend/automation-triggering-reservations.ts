import { asc, inArray } from "drizzle-orm";
import { Effect } from "effect";
import { workspaceReservations } from "@/db/schema";
import type { WorkspaceReservationId } from "@/features/reservation/persistence-contracts";
import type { AutomationEngineTransaction } from "./automation-unit-handler";

/**
 * Locks the triggering reservations `FOR SHARE`, in id order, and returns
 * those Workspace cancelled (D28). Callers take it after the lifecycle lock;
 * it holds a Workspace cancellation back until the caller commits.
 */
export const lockTriggeringReservations = (
  tx: AutomationEngineTransaction,
  reservationIds: readonly (WorkspaceReservationId | null)[]
) =>
  Effect.succeed(
    [...new Set(reservationIds.filter((id) => id !== null))].sort()
  ).pipe(
    Effect.flatMap((ids) =>
      ids.length === 0
        ? Effect.succeed([])
        : tx
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
  );
