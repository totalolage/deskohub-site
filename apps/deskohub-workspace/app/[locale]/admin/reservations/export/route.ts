import { Effect } from "effect";
import { AdministrationService } from "@/features/administration/administration.service";
import { defineAdministrationListExportRoute } from "@/features/administration/list-export.server";
import { parseAdministrationReservationExportSearchParams } from "@/features/administration/page-data.server";
import { getAdministrationReservationExportColumns } from "@/features/administration/reservation-export";

// The export reads Dotypos in sequence: the date range, then batches of
// bookings and customers. Each read can wait out the 30-second Dotypos request
// timeout and retry, which the default duration can't fit.
export const maxDuration = 300;

const exportReservations = defineAdministrationListExportRoute({
  columns: getAdministrationReservationExportColumns,
  name: "reservations",
  rows: (params) =>
    Effect.flatMap(AdministrationService, (administration) =>
      administration.exportReservations(
        parseAdministrationReservationExportSearchParams(params)
      )
    ),
});

export { exportReservations as GET };
