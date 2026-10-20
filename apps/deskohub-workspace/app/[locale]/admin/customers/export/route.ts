import { Effect } from "effect";
import { AdministrationService } from "@/features/administration/administration.service";
import { getAdministrationCustomerExportColumns } from "@/features/administration/customer-export";
import { defineAdministrationListExportRoute } from "@/features/administration/list-export.server";
import { parseAdministrationCustomerExportSearchParams } from "@/features/administration/page-data.server";

// The export reads Dotypos in sequence: the date range, then batches of
// customers and single reads of any a batch left out. Each read can wait out
// the 30-second Dotypos request timeout and retry, which the default duration
// can't fit.
export const maxDuration = 300;

const exportCustomers = defineAdministrationListExportRoute({
  columns: getAdministrationCustomerExportColumns,
  name: "customers",
  rows: (params) =>
    Effect.flatMap(AdministrationService, (administration) =>
      administration.exportCustomers(
        parseAdministrationCustomerExportSearchParams(params)
      )
    ),
});

export { exportCustomers as GET };
