import {
  type DotyposCustomerId,
  type DotyposReservation,
  type DotyposReservationId,
  DotyposService,
} from "@deskohub/dotypos";
import { Effect, Option } from "effect";
import { workspaceBookingSeatCount } from "@/features/checkout/backend/reservation/workspace-table-occupancy";
import type { OrderId } from "@/features/order";
import { decodeBookedReservation } from "@/features/reservation/backend/booked-reservation";
import { workspaceSiteConstants } from "@/shared/utils/site-constants";
import {
  getPlainDatesBetween,
  temporalInstantToDate,
} from "@/shared/utils/temporal";
import { formatPassDayMarker, readPassDayMarkers } from "../pass-day-marker";
import { unlimitedPassDays } from "../pass-offer";
import type { UnlimitedPassDay } from "./unlimited-pass-capacity";

type PassDayHold = {
  readonly passId: OrderId;
  readonly customerId: DotyposCustomerId;
  readonly day: UnlimitedPassDay;
  readonly generation: string | null;
};

/** Creates one NEW hold. The caller journals intent before sending it. */
export const createUnlimitedPassDayHold = Effect.fn(
  "createUnlimitedPassDayHold"
)(function* ({
  passId,
  customerId,
  day,
  generation,
  coffee,
  singleAttempt,
}: Omit<PassDayHold, "generation"> & {
  readonly generation: string;
  readonly coffee?: boolean;
  readonly singleAttempt?: true;
}) {
  const dotypos = yield* DotyposService;
  return yield* dotypos.createReservation({
    customerId,
    tableId: day.tableId,
    startDate: temporalInstantToDate(
      Temporal.Instant.from(day.interval.startsAt)
    ),
    endDate: temporalInstantToDate(Temporal.Instant.from(day.interval.endsAt)),
    seats: workspaceBookingSeatCount,
    status: "NEW",
    ...(singleAttempt && { singleAttempt }),
    note: [
      formatPassDayMarker(passId, day.serviceDate, generation),
      `Káva: ${coffee ? "ano" : "ne"}`,
    ].join("\n"),
  });
});

/** Changes status only while the provider version still names this exact pass-day booking. */
export const setUnlimitedPassDayHoldStatus = Effect.fn(
  "setUnlimitedPassDayHoldStatus"
)(function* (
  reservationId: DotyposReservationId,
  { customerId, day, generation, passId }: PassDayHold,
  status: "CONFIRMED" | "CANCELLED"
) {
  const dotypos = yield* DotyposService;
  return yield* dotypos.setReservationStatusIfMatches({
    reservationId,
    status,
    expectedBooking: {
      customerId,
      tableId: day.tableId,
      seats: workspaceBookingSeatCount,
      startDate: temporalInstantToDate(
        Temporal.Instant.from(day.interval.startsAt)
      ),
      endDate: temporalInstantToDate(
        Temporal.Instant.from(day.interval.endsAt)
      ),
    },
    expectedNoteLine: formatPassDayMarker(passId, day.serviceDate, generation),
  });
});

/** Lists the pass's marked records, including cancelled holds for settlement. */
export const listUnlimitedPassDayHolds = Effect.fn("listUnlimitedPassDayHolds")(
  function* (input: {
    readonly passId: OrderId;
    readonly customerId: DotyposCustomerId;
    readonly startDate: Temporal.PlainDate;
  }) {
    const dotypos = yield* DotyposService;
    const timeZone = workspaceSiteConstants.location.timeZone;
    const endsBefore = input.startDate.add({ days: unlimitedPassDays });
    const records = yield* dotypos.listReservations({
      customerId: input.customerId,
      startsAtOrAfter: input.startDate
        .toZonedDateTime(timeZone)
        .toInstant()
        .toString(),
      startsBefore: endsBefore.toZonedDateTime(timeZone).toInstant().toString(),
    });
    const markers = new Set(
      getPlainDatesBetween(
        input.startDate,
        endsBefore.subtract({ days: 1 })
      ).map((date) => formatPassDayMarker(input.passId, date, null))
    );
    return records.filter(
      (record) =>
        record._customerId === input.customerId &&
        readPassDayMarkers(record.note).some((marker) => {
          const [pass, date] = marker.split("/");
          return markers.has(`${pass}/${date}`);
        })
    );
  }
);

export const hasUnlimitedPassDayMarker = (
  record: Pick<DotyposReservation, "note">,
  passId: OrderId,
  serviceDate: Temporal.PlainDate,
  generation: string | null
) =>
  record.note
    ?.split("\n")
    .includes(formatPassDayMarker(passId, serviceDate, generation)) ?? false;

/** Matches the booking facts required when settling a marked attempt. */
export const matchesUnlimitedPassDayHold = (
  record: Pick<
    DotyposReservation,
    "_customerId" | "_tableId" | "note" | "startDate" | "endDate" | "seats"
  >,
  { passId, customerId, day, generation }: PassDayHold
) => {
  if (
    !hasUnlimitedPassDayMarker(record, passId, day.serviceDate, generation) ||
    record._customerId !== customerId ||
    record._tableId !== day.tableId
  ) {
    return false;
  }
  const booked = decodeBookedReservation(record);
  return (
    Option.exists(
      booked.seats,
      (seats) => seats === workspaceBookingSeatCount
    ) &&
    Option.exists(
      booked.interval,
      ({ startsAt, endsAt }) =>
        startsAt.equals(day.interval.startsAt) &&
        endsAt.equals(day.interval.endsAt)
    )
  );
};
