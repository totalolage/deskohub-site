import type { DotyposReservationId } from "@deskohub/dotypos";
import { and } from "drizzle-orm";
import { Effect, Option } from "effect";
import type { WorkspaceDatabaseClient } from "@/db/database.service";
import { equalsAny } from "@/db/equals-any";
import { workspaceReservations } from "@/db/schema";
import { StoredReservationDetails } from "@/features/reservation/backend/stored-reservation-details.server";
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
            StoredReservationDetails.earlySetupMeetingRoom
          )
        )
        .pipe(
          Effect.map(
            (rows) =>
              new Map(
                rows.flatMap(({ dotyposReservationId, reservationDetails }) =>
                  dotyposReservationId === null
                    ? []
                    : Option.match(
                        StoredReservationDetails.project(reservationDetails),
                        {
                          // A malformed document moves no booked start.
                          onNone: () => [],
                          onSome: (details) => [
                            [dotyposReservationId, details] as const,
                          ],
                        }
                      )
                )
              )
          )
        );
