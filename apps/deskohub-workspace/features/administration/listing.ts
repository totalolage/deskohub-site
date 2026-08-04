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

export const getReservationSearchPattern = (query: string) =>
  `%${query
    .replaceAll("\\", "\\\\")
    .replaceAll("%", "\\%")
    .replaceAll("_", "\\_")}%`;
