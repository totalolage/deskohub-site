import { Match } from "effect";
import type { ReservationOrderData } from "@/features/reservation/reservation-order";
import { workspaceSiteConstants } from "@/shared/utils/site-constants";

export const consumerWithdrawalPeriodDays = 14;

const getWorkspaceDateStart = (date: string) =>
  Temporal.PlainDate.from(date)
    .toZonedDateTime(workspaceSiteConstants.location.timeZone)
    .toInstant();

export const getReservationServiceStart = (
  reservation: ReservationOrderData
): Temporal.Instant =>
  Match.value(reservation).pipe(
    Match.discriminatorsExhaustive("kind")({
      cowork: ({ date }) => getWorkspaceDateStart(date),
      "meeting-room": ({ startsAt }) => Temporal.Instant.from(startsAt),
      office: ({ startsOn }) => getWorkspaceDateStart(startsOn),
    })
  );

export const getEarlyPerformanceRequestRequiredAt = (
  reservation: ReservationOrderData
): Temporal.Instant =>
  getReservationServiceStart(reservation)
    .toZonedDateTimeISO(workspaceSiteConstants.location.timeZone)
    .toPlainDate()
    .subtract({ days: consumerWithdrawalPeriodDays })
    .toZonedDateTime(workspaceSiteConstants.location.timeZone)
    .toInstant();

/**
 * The contract day is not counted. The 14-day period therefore runs through
 * the end of the fourteenth following Workspace-local calendar day.
 */
export const getConsumerWithdrawalPeriodCutoff = (
  contractAt: Temporal.Instant
): Temporal.Instant =>
  contractAt
    .toZonedDateTimeISO(workspaceSiteConstants.location.timeZone)
    .toPlainDate()
    .add({ days: consumerWithdrawalPeriodDays + 1 })
    .toZonedDateTime(workspaceSiteConstants.location.timeZone)
    .toInstant();

export const isEarlyPerformanceRequestRequired = (input: {
  readonly reservation: ReservationOrderData;
  readonly contractAt: Temporal.Instant;
}) =>
  Temporal.Instant.compare(
    getReservationServiceStart(input.reservation),
    getConsumerWithdrawalPeriodCutoff(input.contractAt)
  ) < 0;
