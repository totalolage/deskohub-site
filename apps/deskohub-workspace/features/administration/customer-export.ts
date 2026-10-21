import type { Locale } from "@/features/i18n";
import type { CsvColumn } from "@/shared/utils/csv";
import type { AdministrationCustomerSummary } from "./administration.service";
import {
  getAdministrationCustomerMarketingConsentLabel,
  getAdministrationCustomerName,
} from "./customer-presentation";
import { formatAdministrationExportDateTime } from "./formatters";
import { m } from "./i18n";

/**
 * The customer list as a spreadsheet for marketing outreach: what the table
 * shows, plus the Dotypos customer ID. Contact details Dotypos doesn't hold
 * stay empty.
 */
export const getAdministrationCustomerExportColumns = (
  locale: Locale
): readonly CsvColumn<AdministrationCustomerSummary>[] => [
  {
    header: m.administrationCustomerExportColumnCustomerId({}, { locale }),
    value: (summary) => summary.customerId,
  },
  {
    header: m.administrationCustomerExportColumnName({}, { locale }),
    value: (summary) =>
      summary.customer &&
      getAdministrationCustomerName(summary.customer, locale),
  },
  {
    header: m.administrationCustomerExportColumnEmail({}, { locale }),
    value: (summary) => summary.customer?.email,
  },
  {
    header: m.administrationCustomerExportColumnPhone({}, { locale }),
    value: (summary) => summary.customer?.phone,
  },
  {
    header: m.administrationCustomerExportColumnReservations({}, { locale }),
    value: (summary) => summary.reservationCount,
  },
  {
    header: m.administrationCustomerExportColumnLastActivity({}, { locale }),
    value: (summary) =>
      formatAdministrationExportDateTime(summary.lastActivityAt),
  },
  {
    header: m.administrationCustomerExportColumnMarketingConsent(
      {},
      { locale }
    ),
    value: (summary) =>
      getAdministrationCustomerMarketingConsentLabel(
        summary.marketingConsent,
        locale
      ),
  },
];
