import {
  temporalInstantToDate,
  temporalPlainDateToDate,
  workspaceSiteConstants,
} from "@/shared/utils";
import type { AdministrationReservationSummary } from "./administration.service";

const dateTimeFormatter = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: workspaceSiteConstants.location.timeZone,
});

const dateFormatter = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeZone: workspaceSiteConstants.location.timeZone,
});

export const formatAdministrationDateTime = (value: string) =>
  dateTimeFormatter.format(temporalInstantToDate(Temporal.Instant.from(value)));

export const formatAdministrationPlainDate = (value: string) =>
  dateFormatter.format(
    temporalPlainDateToDate({
      date: Temporal.PlainDate.from(value),
      plainTime: Temporal.PlainTime.from("12:00"),
      timeZone: workspaceSiteConstants.location.timeZone,
    })
  );

export const formatAdministrationReservationDate = (
  reservation: Pick<
    AdministrationReservationSummary,
    "date" | "startsAt" | "type"
  >
) => {
  if (reservation.type === "cowork" && reservation.date) {
    return formatAdministrationPlainDate(reservation.date);
  }
  if (reservation.startsAt) {
    return formatAdministrationDateTime(reservation.startsAt);
  }
  return reservation.date
    ? formatAdministrationPlainDate(reservation.date)
    : null;
};

export const formatAdministrationMoney = ({
  currency,
  exponent,
  value,
}: {
  readonly currency: string;
  readonly exponent: number;
  readonly value: number;
}) =>
  new Intl.NumberFormat("en-GB", {
    currency,
    style: "currency",
  }).format(value / 10 ** exponent);
