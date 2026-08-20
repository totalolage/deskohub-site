export const getUniqueReservationId = <Id extends string>(
  matches: readonly (Id | null | undefined)[]
) => {
  const reservationIds = new Set(matches.filter((id): id is Id => Boolean(id)));
  return reservationIds.size === 1 ? ([...reservationIds][0] ?? null) : null;
};
