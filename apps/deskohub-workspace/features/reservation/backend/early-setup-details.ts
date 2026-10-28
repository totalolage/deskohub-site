import type { DotyposReservationId } from "@deskohub/dotypos";
import { and, sql } from "drizzle-orm";
import { Effect } from "effect";
import type { WorkspaceDatabaseClient } from "@/db/database.service";
import { equalsAny } from "@/db/equals-any";
import { workspaceReservations } from "@/db/schema";
import type { StoredWorkspaceReservationDetails } from "@/features/reservation/persistence-contracts";

/**
 * The stored details of the early-setup meeting rooms among these Dotypos
 * reservations, by Dotypos ID, in one query. Only those details move a booked
 * start off the start Dotypos holds, so a reservation without an entry decodes
 * to its booked time without its details.
 */
export const loadEarlySetupDetails = (
  db: WorkspaceDatabaseClient,
  dotyposReservationIds: readonly DotyposReservationId[]
) =>
  dotyposReservationIds.length === 0
    ? Effect.succeed(
        new Map<DotyposReservationId, StoredWorkspaceReservationDetails>()
      )
    : db
        .select({
          dotyposReservationId: workspaceReservations.dotyposReservationId,
          reservationDetails: workspaceReservations.reservationDetails,
        })
        .from(workspaceReservations)
        .where(
          and(
            equalsAny(
              workspaceReservations.dotyposReservationId,
              dotyposReservationIds
            ),
            sql`${workspaceReservations.reservationDetails} @> '{"kind":"meeting-room","earlySetup":true}'::jsonb`
          )
        )
        .pipe(
          Effect.map(
            (rows) =>
              new Map(
                rows.flatMap(({ dotyposReservationId, reservationDetails }) =>
                  dotyposReservationId === null
                    ? []
                    : [[dotyposReservationId, reservationDetails] as const]
                )
              )
          )
        );
