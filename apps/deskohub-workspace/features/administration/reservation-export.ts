import type { AdministrationReservationListInput } from "./administration.service";

export type AdministrationReservationExportInput = Omit<
  AdministrationReservationListInput,
  "page"
>;

/**
 * Builds the CSV download href for the currently applied reservation filters.
 * Pagination is intentionally omitted: the export always covers every
 * matching reservation.
 */
export const getAdministrationReservationExportHref = (
  input: AdministrationReservationExportInput
): string => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries({
    customerId: input.customerId,
    date: input.date,
    direction: input.direction,
    from: input.from,
    sort: input.sort,
    status: input.status,
    to: input.to,
    type: input.type,
  })) {
    if (value) search.set(key, String(value));
  }
  const query = search.toString();
  return query
    ? `/admin/reservations/export.csv?${query}`
    : "/admin/reservations/export.csv";
};
