export const getUniqueReservationId = (
  matches: readonly (string | null | undefined)[]
) => {
  const reservationIds = new Set(
    matches.filter((id): id is string => Boolean(id))
  );
  return reservationIds.size === 1 ? ([...reservationIds][0] ?? null) : null;
};
