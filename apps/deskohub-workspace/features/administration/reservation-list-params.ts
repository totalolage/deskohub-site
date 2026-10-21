import type { AdministrationReservationExportInput } from "./administration.service";
import type { AdministrationListParams } from "./list-href";

/**
 * The URL params of the reservation list's filters and order, which its sort
 * links, pagination, and export share. The page number is left to pagination.
 */
export const getAdministrationReservationListParams = (
  input: AdministrationReservationExportInput
): AdministrationListParams => ({
  customerId: input.customerId,
  direction: input.direction,
  from: input.from,
  sort: input.sort,
  status: input.status,
  to: input.to,
  type: input.type,
});
