export const reservationAccessCodeGraceMinutes = 30;

export type ReservationAccessCodeWindowState =
  | {
      readonly state: "before-window";
      readonly opensAt: Temporal.Instant;
      readonly closesAt: Temporal.Instant;
    }
  | {
      readonly state: "open";
      readonly opensAt: Temporal.Instant;
      readonly closesAt: Temporal.Instant;
    }
  | {
      readonly state: "after-window";
      readonly opensAt: Temporal.Instant;
      readonly closesAt: Temporal.Instant;
    };

/**
 * Controls when the current door PIN may be disclosed. It does not extend the
 * reservation or assert that today's static PIN is technically time-limited.
 */
export const getReservationAccessCodeWindowState = (input: {
  readonly reservedFrom: Temporal.Instant;
  readonly reservedUntil: Temporal.Instant;
  readonly now: Temporal.Instant;
}): ReservationAccessCodeWindowState => {
  const opensAt = input.reservedFrom.subtract({
    minutes: reservationAccessCodeGraceMinutes,
  });
  const closesAt = input.reservedUntil.add({
    minutes: reservationAccessCodeGraceMinutes,
  });

  if (Temporal.Instant.compare(input.now, opensAt) < 0) {
    return { state: "before-window", opensAt, closesAt };
  }
  if (Temporal.Instant.compare(input.now, closesAt) >= 0) {
    return { state: "after-window", opensAt, closesAt };
  }

  return { state: "open", opensAt, closesAt };
};
