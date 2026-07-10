import { Option, Schema } from "effect";

const localTimeEffectSchema = Schema.String.check(
  Schema.makeFilter((value) => {
    if (value === "24:00") return true;

    try {
      return (
        Temporal.PlainTime.from(value).toString({ smallestUnit: "minute" }) ===
        value
      );
    } catch {
      return false;
    }
  })
);

const localDateTimeEffectSchema = Schema.String.check(
  Schema.makeFilter((value) => {
    try {
      const dateTime = Temporal.PlainDateTime.from(value);
      return (
        dateTime.toString({
          smallestUnit: dateTime.second === 0 ? "minute" : "second",
        }) === value
      );
    } catch {
      return false;
    }
  })
);

const instantEffectSchema = Schema.String.check(
  Schema.makeFilter((value) => {
    try {
      Temporal.Instant.from(value);
      return true;
    } catch {
      return false;
    }
  })
);

const decodeLocalTime = Schema.decodeUnknownOption(localTimeEffectSchema);
const decodeLocalDateTime = Schema.decodeUnknownOption(
  localDateTimeEffectSchema
);
const decodeInstant = Schema.decodeUnknownOption(instantEffectSchema);

export const normalizeReservationTimestamp = ({
  date,
  startsAt,
  timeZone,
  value,
}: {
  readonly date?: string;
  readonly startsAt?: string;
  readonly timeZone: string;
  readonly value: string;
}) => {
  const localTime = decodeLocalTime(value);
  if (Option.isSome(localTime)) {
    if (!date) {
      throw new Error("Reservation date is required for local time inputs.");
    }

    return localTimeToInstant({
      date,
      startsAt,
      time: localTime.value,
      timeZone,
    });
  }

  const localDateTime = decodeLocalDateTime(value);
  if (Option.isSome(localDateTime)) {
    return Temporal.PlainDateTime.from(localDateTime.value)
      .toZonedDateTime(timeZone)
      .toInstant()
      .toString();
  }

  const instant = decodeInstant(value);
  if (Option.isSome(instant)) {
    return Temporal.Instant.from(instant.value).toString();
  }

  throw new Error("Reservation start and end must be valid timestamps.");
};

const localTimeToInstant = ({
  date,
  startsAt,
  time,
  timeZone,
}: {
  readonly date: string;
  readonly startsAt?: string;
  readonly time: string;
  readonly timeZone: string;
}) => {
  const reservationDate = Temporal.PlainDate.from(date);
  const minutes = localTimeToMinutes(time);
  const decodedStartTime = startsAt ? decodeLocalTime(startsAt) : Option.none();
  const startMinutes = Option.isSome(decodedStartTime)
    ? localTimeToMinutes(decodedStartTime.value)
    : undefined;
  const localDate = reservationDate.add({
    days:
      time !== "24:00" && startMinutes !== undefined && minutes <= startMinutes
        ? 1
        : Math.floor(minutes / (24 * 60)),
  });
  const localMinutes = minutes % (24 * 60);
  const plainTime = new Temporal.PlainTime(
    Math.floor(localMinutes / 60),
    localMinutes % 60
  );

  return localDate
    .toPlainDateTime(plainTime)
    .toZonedDateTime(timeZone)
    .toInstant()
    .toString();
};

const localTimeToMinutes = (time: string) => {
  if (time === "24:00") return 24 * 60;

  const parsed = Temporal.PlainTime.from(time);
  return parsed.hour * 60 + parsed.minute;
};
