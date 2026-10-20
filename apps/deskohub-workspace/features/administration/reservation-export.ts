import type { Locale } from "@/features/i18n";
import type { CsvColumn } from "@/shared/utils/csv";
import type { AdministrationReservationSummary } from "./administration.service";
import { getAdministrationCustomerName } from "./customer-presentation";
import {
  formatAdministrationExportDateTime,
  getAdministrationMoneyAmount,
  getAdministrationPaymentStatus,
} from "./formatters";
import { m } from "./i18n";
import {
  getAdministrationReservationStatusLabel,
  getAdministrationReservationStatusNoteLabel,
} from "./reservation-presentation";
import { getAdministrationReservationProductTitle } from "./reservation-product";

/**
 * The reservation list as a spreadsheet: what the table shows, plus stable
 * IDs. A detail Dotypos didn't return stays empty.
 */
export const getAdministrationReservationExportColumns = (
  locale: Locale
): readonly CsvColumn<AdministrationReservationSummary>[] => [
  {
    header: m.administrationReservationExportColumnReservationId(
      {},
      { locale }
    ),
    value: (reservation) => reservation.id,
  },
  {
    header: m.administrationReservationExportColumnDotyposReservationId(
      {},
      { locale }
    ),
    value: (reservation) => reservation.dotyposReservationId,
  },
  {
    header: m.administrationReservationExportColumnStart({}, { locale }),
    value: (reservation) =>
      reservation.startsAt &&
      formatAdministrationExportDateTime(reservation.startsAt),
  },
  {
    header: m.administrationReservationExportColumnEnd({}, { locale }),
    value: (reservation) =>
      reservation.endsAt &&
      formatAdministrationExportDateTime(reservation.endsAt),
  },
  {
    header: m.administrationReservationExportColumnStatus({}, { locale }),
    value: (reservation) =>
      getAdministrationReservationStatusLabel(reservation.status.code, locale),
  },
  {
    header: m.administrationReservationExportColumnAttention({}, { locale }),
    value: (reservation) =>
      reservation.statusNoteCode &&
      getAdministrationReservationStatusNoteLabel(
        reservation.statusNoteCode,
        locale
      ),
  },
  {
    header: m.administrationReservationExportColumnCustomerId({}, { locale }),
    value: (reservation) => reservation.customerId,
  },
  {
    header: m.administrationReservationExportColumnCustomer({}, { locale }),
    value: (reservation) =>
      reservation.customer &&
      getAdministrationCustomerName(reservation.customer, locale),
  },
  {
    header: m.administrationReservationExportColumnEmail({}, { locale }),
    value: (reservation) => reservation.customer?.email,
  },
  {
    header: m.administrationReservationExportColumnPhone({}, { locale }),
    value: (reservation) => reservation.customer?.phone,
  },
  {
    header: m.administrationReservationExportColumnProduct({}, { locale }),
    value: (reservation) =>
      getAdministrationReservationProductTitle(reservation.product, locale),
  },
  {
    header: m.administrationReservationExportColumnCreated({}, { locale }),
    value: (reservation) =>
      formatAdministrationExportDateTime(reservation.createdAt),
  },
  {
    header: m.administrationReservationExportColumnPaymentStatus(
      {},
      { locale }
    ),
    value: (reservation) =>
      reservation.latestPayment &&
      getAdministrationPaymentStatus(reservation.latestPayment, locale).label,
  },
  {
    header: m.administrationReservationExportColumnPaymentAmount(
      {},
      { locale }
    ),
    value: (reservation) =>
      reservation.latestPayment &&
      getAdministrationMoneyAmount(reservation.latestPayment.amount),
  },
  {
    header: m.administrationReservationExportColumnPaymentCurrency(
      {},
      { locale }
    ),
    value: (reservation) => reservation.latestPayment?.amount.currency,
  },
];
