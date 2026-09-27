import { Effect } from "effect";
import {
  AdministrationService,
  ReservationExportRangeUnavailableError,
} from "@/features/administration/administration.service";

import {
  getAdministrationReservationExportCsv,
  loadAdministrationReservationExportFilters,
} from "@/features/administration/reservation-export.server";
import { requireAdministratorAuthorization } from "@/shared/administrator/administrator-authorization.server";
import { runWorkspaceEffect } from "@/shared/backend/workspace-effect";

const privateNoStoreHeaders = { "Cache-Control": "private, no-store" };
const plainTextHeaders = {
  ...privateNoStoreHeaders,
  "Content-Type": "text/plain; charset=utf-8",
};

export async function GET(request: Request) {
  const username = await requireAdministratorAuthorization.pipe(
    Effect.catchTag("AdministratorUnauthorizedError", () =>
      Effect.succeed(null)
    ),
    runWorkspaceEffect("administrator.authorize", { boundary: "route" })
  );
  if (username === null) {
    return new Response(null, {
      headers: privateNoStoreHeaders,
      status: 404,
    });
  }

  const filters = loadAdministrationReservationExportFilters(
    new URL(request.url).searchParams
  );
  if (!filters.ok) {
    return new Response(
      "This export contains a filter value that is not supported. Adjust the reservation filters and try again.",
      { headers: plainTextHeaders, status: 400 }
    );
  }
  return await Effect.gen(function* () {
    const administration = yield* AdministrationService;
    const reservations = yield* administration.exportReservations(
      filters.input
    );
    return new Response(getAdministrationReservationExportCsv(reservations), {
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Disposition": 'attachment; filename="reservations-export.csv"',
        "Content-Type": "text/csv; charset=utf-8",
      },
    });
  }).pipe(
    Effect.catch((cause) => {
      if (cause instanceof ReservationExportRangeUnavailableError) {
        return Effect.logWarning("Reservation export range unavailable").pipe(
          Effect.as(
            new Response(
              "Reservation booking dates are temporarily unavailable. Try this export again shortly.",
              { headers: plainTextHeaders, status: 503 }
            )
          )
        );
      }
      return Effect.fail(cause);
    }),
    Effect.provide(AdministrationService.Live),
    runWorkspaceEffect("administration.reservation-export", {
      boundary: "route",
    })
  );
}
