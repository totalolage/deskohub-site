import {
  Effect,
  Match,
  Option,
  Schema,
  SchemaGetter,
  SchemaIssue,
} from "effect";
import type { WorkspaceProductMonitorOption } from "@/features/checkout/product-catalog";
import {
  type CoworkReservationProductInput,
  coworkReservationOrderObjectEffectSchema,
  getCoworkReservationIssues,
  getCoworkReservationProductCoffee,
  getCoworkReservationProductMonitorOption,
  normalizeCoworkReservationOrder,
  normalizedCoworkReservationOrderEffectSchema,
} from "@/features/reservation/cowork-reservation";
import {
  getMeetingRoomReservationIssues,
  type MeetingRoomReservationOrderObject,
  meetingRoomReservationOrderObjectEffectSchema,
  normalizedMeetingRoomReservationOrderEffectSchema,
} from "@/features/reservation/meeting-room-reservation";
import {
  getReservationIntervalValidationIssue,
  normalizeReservationInterval,
} from "@/features/reservation/reservation-interval";

const reservationOrderObjectEffectSchema = Schema.Union([
  coworkReservationOrderObjectEffectSchema,
  meetingRoomReservationOrderObjectEffectSchema,
]);

type ReservationOrderObject = typeof reservationOrderObjectEffectSchema.Type;

const normalizedReservationOrderEffectSchema = Schema.Union([
  normalizedCoworkReservationOrderEffectSchema,
  normalizedMeetingRoomReservationOrderEffectSchema,
]);

const toReservationIssue = (
  path: readonly PropertyKey[],
  message: string
): Schema.FilterIssue => ({
  path,
  issue: message,
});

const getReservationIssues = (
  data: ReservationOrderObject
): readonly Schema.FilterIssue[] => {
  const intervalIssue = getReservationIntervalValidationIssue(data);
  if (intervalIssue) {
    return [toReservationIssue([intervalIssue.path], intervalIssue.message)];
  }

  return data.entryTier === "meeting-room"
    ? getMeetingRoomReservationIssues(data)
    : getCoworkReservationIssues(data);
};

const reservationOrderDraftEffectSchema =
  reservationOrderObjectEffectSchema.check(
    Schema.makeFilter(getReservationIssues)
  );

const normalizeMeetingRoomReservationOrder = (
  data: MeetingRoomReservationOrderObject
) => normalizeReservationInterval(data);

const normalizeReservationOrder = (data: ReservationOrderObject) =>
  Match.value(data).pipe(
    Match.when(
      { entryTier: "meeting-room" },
      normalizeMeetingRoomReservationOrder
    ),
    Match.orElse((coworkReservation) =>
      Effect.succeed(normalizeCoworkReservationOrder(coworkReservation))
    )
  );

export const reservationOrderEffectSchema =
  reservationOrderDraftEffectSchema.pipe(
    Schema.decodeTo(normalizedReservationOrderEffectSchema, {
      decode: SchemaGetter.transformOrFail((reservation) =>
        normalizeReservationOrder(reservation).pipe(
          Effect.mapError(
            (error) =>
              new SchemaIssue.InvalidValue(Option.some(reservation), {
                message: error.message,
              })
          )
        )
      ),
      encode: SchemaGetter.transform(
        (reservation): ReservationOrderObject => reservation
      ),
    })
  );

export type ReservationOrderInput = typeof reservationOrderEffectSchema.Encoded;
export type ReservationOrderData = typeof reservationOrderEffectSchema.Type;

export type ReservationProductProjectionInput =
  | CoworkReservationProductInput
  | {
      readonly entryTier: "meeting-room";
      readonly coffee?: boolean;
      readonly monitorOption?: WorkspaceProductMonitorOption | "";
    };

export const getReservationProductCoffee = (
  reservation: ReservationProductProjectionInput
) =>
  Match.value(reservation).pipe(
    Match.when({ entryTier: "meeting-room" }, () => false),
    Match.orElse(getCoworkReservationProductCoffee)
  );

export const getReservationProductMonitorOption = (
  reservation: ReservationProductProjectionInput
) =>
  Match.value(reservation).pipe(
    Match.when({ entryTier: "meeting-room" }, () => undefined),
    Match.orElse(getCoworkReservationProductMonitorOption)
  );
