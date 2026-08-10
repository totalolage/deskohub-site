import {
  type AdministrationStatusGroup,
  getAdministrationReservationStatus,
  type ReservationStatusInput,
} from "./reservation-status";

type FilterableReservation = Omit<ReservationStatusInput, "dotyposStatus"> & {
  readonly dotyposReservationId: string | null;
};

export const filterAdministrationReservationsByStatus = <
  Reservation extends FilterableReservation,
>(
  reservations: readonly Reservation[],
  status: Exclude<AdministrationStatusGroup, "attention">,
  liveStatuses: ReadonlyMap<
    string,
    NonNullable<ReservationStatusInput["dotyposStatus"]>
  >
) =>
  reservations.filter(
    (reservation) =>
      getAdministrationReservationStatus({
        ...reservation,
        dotyposStatus: reservation.dotyposReservationId
          ? liveStatuses.get(reservation.dotyposReservationId)
          : undefined,
      }).group === status
  );

export const getAdministrationPagination = ({
  pageSize,
  requestedPage,
  total,
}: {
  readonly pageSize: number;
  readonly requestedPage?: number;
  readonly total: number;
}) => {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(Math.max(1, requestedPage ?? 1), pageCount);
  return {
    offset: (page - 1) * pageSize,
    page,
    pageCount,
  };
};
