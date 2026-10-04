import {
  DotyposReservationIdSchema,
  DotyposTableIdSchema,
} from "@deskohub/dotypos";
import type {
  Reservation as DotyposReservation,
  Table as DotyposTable,
} from "@deskohub/dotypos/generated";
import { Data, Effect, Schema } from "effect";
import { getDurationMinutes } from "@/features/reservation/reservation-interval-normalization";
import { workspaceSiteConstants } from "@/shared/utils/site-constants";
import { instantStringSchema } from "@/shared/utils/temporal";

const coworkTableTagPrefix = "cowork:";

const positiveIntegerSeatCountSchema = Schema.FiniteFromString.pipe(
  Schema.check(Schema.isInt(), Schema.isGreaterThan(0))
);

const decodeReservationId = Schema.decodeUnknownEffect(
  DotyposReservationIdSchema
);
const decodeTableId = Schema.decodeUnknownEffect(DotyposTableIdSchema);
const decodeInstant = Schema.decodeUnknownEffect(instantStringSchema);
const decodeSeatCount = Schema.decodeUnknownEffect(
  positiveIntegerSeatCountSchema
);

interface PreviousCompleteMonth {
  readonly startsAt: Temporal.Instant;
  readonly endsAt: Temporal.Instant;
  readonly days: number;
}

interface FaqOccupancyStatsInput {
  readonly reservations: readonly DotyposReservation[];
  readonly tables: readonly DotyposTable[];
  readonly now?: Temporal.Instant;
}

export interface FaqOccupancyStats {
  readonly averageReservationsPerDay: number;
  readonly coworkSeatCapacity: number;
}

export class FaqOccupancyError extends Data.TaggedError("FaqOccupancyError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export const getFaqOccupancyStats = Effect.fn("getFaqOccupancyStats")(
  function* ({
    reservations,
    tables,
    now = Temporal.Now.instant(),
  }: FaqOccupancyStatsInput) {
    const month = getPreviousCompleteMonth(now);
    const coworkTableIds = yield* getCoworkTableIds(tables);
    const coworkSeatCapacity = yield* getCoworkSeatCapacity(tables);
    const reservationIds = new Set<string>();

    for (const reservation of reservations) {
      if (reservation.status !== "CONFIRMED") continue;

      const tableId = reservation._tableId?.trim();
      if (!tableId || !coworkTableIds.has(tableId)) continue;

      const startsAt = yield* getConfirmedCoworkReservationStart(reservation);
      if (
        Temporal.Instant.compare(startsAt, month.startsAt) < 0 ||
        Temporal.Instant.compare(startsAt, month.endsAt) >= 0
      ) {
        continue;
      }

      const reservationId = yield* decodeRelevantReservationId(reservation);
      reservationIds.add(reservationId);
    }

    return {
      averageReservationsPerDay:
        Math.round((reservationIds.size / month.days) * 10) / 10,
      coworkSeatCapacity,
    };
  }
);

const getPreviousCompleteMonth = (
  now: Temporal.Instant
): PreviousCompleteMonth => {
  const timeZone = workspaceSiteConstants.location.timeZone;
  const localNow = now.toZonedDateTimeISO(timeZone);
  const currentMonthStart = Temporal.PlainDate.from({
    year: localNow.year,
    month: localNow.month,
    day: 1,
  });
  const previousMonthStart = currentMonthStart.subtract({ months: 1 });

  return {
    startsAt: previousMonthStart.toZonedDateTime({ timeZone }).toInstant(),
    endsAt: currentMonthStart.toZonedDateTime({ timeZone }).toInstant(),
    days: previousMonthStart.daysInMonth,
  };
};

const getCoworkTableIds = (tables: readonly DotyposTable[]) => {
  return Effect.forEach(
    tables.filter(hasCoworkTableTag),
    decodeRelevantTableId
  ).pipe(Effect.map((tableIds) => new Set(tableIds)));
};

const getCoworkSeatCapacity = Effect.fn("getCoworkSeatCapacity")(function* (
  tables: readonly DotyposTable[]
) {
  const seatsByTableId = new Map<string, number>();
  let capacity = 0;

  for (const table of tables) {
    if (!hasCoworkTableTag(table)) continue;

    const tableId = yield* decodeRelevantTableId(table);
    const seats = yield* decodeRelevantTableSeats(table);
    const existingSeats = seatsByTableId.get(tableId);

    if (existingSeats !== undefined) {
      if (existingSeats !== seats) {
        return yield* new FaqOccupancyError({
          message:
            "Cowork-tagged Dotypos tables with the same ID have conflicting seat capacities.",
        });
      }
      continue;
    }

    const nextCapacity = capacity + seats;
    if (!Number.isSafeInteger(nextCapacity)) {
      return yield* new FaqOccupancyError({
        message: "Cowork-tagged Dotypos table capacity is too large.",
      });
    }

    seatsByTableId.set(tableId, seats);
    capacity = nextCapacity;
  }

  return capacity;
});

const hasCoworkTableTag = (table: DotyposTable) =>
  table.tags?.some((tag) => tag.startsWith(coworkTableTagPrefix)) ?? false;

const decodeRelevantTableId = (table: DotyposTable) =>
  decodeTableId(table.id?.trim()).pipe(
    Effect.mapError(
      (cause) =>
        new FaqOccupancyError({
          message: "Cowork-tagged Dotypos table has an invalid ID.",
          cause,
        })
    )
  );

const decodeRelevantTableSeats = (table: DotyposTable) =>
  decodeSeatCount(table.seats).pipe(
    Effect.mapError(
      (cause) =>
        new FaqOccupancyError({
          message: "Cowork-tagged Dotypos table has an invalid seat capacity.",
          cause,
        })
    ),
    Effect.flatMap((seats) =>
      Number.isSafeInteger(seats)
        ? Effect.succeed(seats)
        : Effect.fail(
            new FaqOccupancyError({
              message:
                "Cowork-tagged Dotypos table has an invalid seat capacity.",
            })
          )
    )
  );

const getConfirmedCoworkReservationStart = Effect.fn(
  "getConfirmedCoworkReservationStart"
)(function* (reservation: DotyposReservation) {
  const startsAt = yield* decodeInstant(reservation.startDate).pipe(
    Effect.mapError(
      (cause) =>
        new FaqOccupancyError({
          message:
            "Confirmed cowork Dotypos reservation has an invalid interval.",
          cause,
        })
    )
  );
  const endsAt = yield* decodeInstant(reservation.endDate).pipe(
    Effect.mapError(
      (cause) =>
        new FaqOccupancyError({
          message:
            "Confirmed cowork Dotypos reservation has an invalid interval.",
          cause,
        })
    )
  );

  if (getDurationMinutes({ startsAt, endsAt }) <= 0) {
    return yield* new FaqOccupancyError({
      message: "Confirmed cowork Dotypos reservation has an invalid interval.",
    });
  }

  return Temporal.Instant.from(startsAt);
});

const decodeRelevantReservationId = (reservation: DotyposReservation) =>
  decodeReservationId(reservation.id?.trim()).pipe(
    Effect.mapError(
      (cause) =>
        new FaqOccupancyError({
          message: "Confirmed cowork Dotypos reservation has an invalid ID.",
          cause,
        })
    )
  );
