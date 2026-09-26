import "server-only";

import { DotyposCustomerIdSchema } from "@deskohub/dotypos";
import { Option, Schema } from "effect";
import { serializeCsv } from "@/shared/utils";
import type {
  AdministrationReservationListInput,
  AdministrationReservationSummary,
} from "./administration.service";
import {
  formatAdministrationDateTime,
  formatAdministrationMoney,
  formatAdministrationReservationDate,
} from "./formatters";
import { getAdministrationReservationDateRangeStrict } from "./reservation-date-range";
import type { AdministrationReservationExportInput } from "./reservation-export";

const reservationStatusValues = ["in_progress", "complete", "cancelled"];
const reservationTypeValues = ["cowork", "meeting-room", "office"];

const decodeDotyposCustomerId = Schema.decodeUnknownOption(
  DotyposCustomerIdSchema
);

export type AdministrationReservationExportFilters =
  | { readonly ok: true; readonly input: AdministrationReservationExportInput }
  | { readonly ok: false; readonly reason: "invalid-filter" };

const parseReservationStatus = (value: string | undefined) =>
  reservationStatusValues.includes(value ?? "")
    ? (value as AdministrationReservationListInput["status"])
    : undefined;

const parseReservationType = (value: string | undefined) =>
  reservationTypeValues.includes(value ?? "")
    ? (value as AdministrationReservationListInput["type"])
    : undefined;

const parseReservationSort = (value: string | undefined) =>
  value === "date" || value === "reservation" || value === "status"
    ? value
    : "created";

const parseSortDirection = (value: string | undefined) =>
  value === "asc" ? "asc" : "desc";

const strictDecodeCustomerId = (value: string | undefined) =>
  value === undefined || value === ""
    ? Option.some(undefined)
    : decodeDotyposCustomerId(value);

/**
 * Parses the export narrowing filters, failing closed on any supplied but
 * malformed filter. Sort direction and sort field stay lenient like the
 * reservations page because they do not narrow the result, and the page
 * parameter is ignored entirely: the export always covers every match.
 */
export const loadAdministrationReservationExportFilters = (
  params: URLSearchParams
): AdministrationReservationExportFilters => {
  const dateRange = getAdministrationReservationDateRangeStrict({
    date: params.get("date") ?? undefined,
    from: params.get("from") ?? undefined,
    to: params.get("to") ?? undefined,
  });
  const customerId = strictDecodeCustomerId(
    params.get("customerId") ?? undefined
  );
  const status = parseReservationStatus(params.get("status") ?? undefined);
  const suppliedStatus = params.get("status");
  const suppliedType = params.get("type");
  const type = parseReservationType(suppliedType ?? undefined);

  if (
    !dateRange.ok ||
    Option.isNone(customerId) ||
    (suppliedStatus !== null && suppliedStatus !== "" && !status) ||
    (suppliedType !== null && suppliedType !== "" && !type)
  ) {
    return { ok: false, reason: "invalid-filter" };
  }

  return {
    ok: true,
    input: {
      customerId: Option.getOrUndefined(customerId),
      ...dateRange.range,
      direction: parseSortDirection(params.get("direction") ?? undefined),
      sort: parseReservationSort(params.get("sort") ?? undefined),
      status,
      type,
    },
  };
};

const reservationExportHeader = [
  "Reservation ID",
  "Booking date",
  "Status",
  "Customer",
  "Reservation type",
  "Created",
  "Payment",
] as const;

const toReservationExportRow = (
  reservation: AdministrationReservationSummary
): readonly string[] => [
  reservation.id,
  formatAdministrationReservationDate(reservation) ?? "",
  reservation.status.label,
  reservation.customer?.displayName ?? "",
  reservation.typeLabel,
  formatAdministrationDateTime(reservation.createdAt),
  reservation.latestPayment
    ? `${reservation.latestPayment.stateLabel} ${formatAdministrationMoney(reservation.latestPayment.amount)}`
    : "",
];

/**
 * Renders the safe reservation projection as CSV. Only fields already shown
 * in the reservations table are included; access codes, payment security
 * values, redirect addresses, and raw provider payloads never appear.
 */
export const getAdministrationReservationExportCsv = (
  reservations: readonly AdministrationReservationSummary[]
): string =>
  serializeCsv([
    reservationExportHeader,
    ...reservations.map(toReservationExportRow),
  ]);
