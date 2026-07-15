import {
  Effect,
  Match,
  Option,
  Schema,
  SchemaGetter,
  SchemaIssue,
} from "effect";
import {
  type CoworkReservationOrderObject,
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
  getMeetingRoomReservationProductCoffee,
  getMeetingRoomReservationProductMonitorOption,
  type MeetingRoomReservationOrderObject,
  type MeetingRoomReservationProductInput,
  meetingRoomReservationOrderObjectEffectSchema,
  normalizedMeetingRoomReservationOrderEffectSchema,
} from "@/features/reservation/meeting-room-reservation";
import { getReservationIntervalNormalization } from "@/features/reservation/reservation-interval";

const reservationOrderObjectEffectSchema = Schema.Union([
  coworkReservationOrderObjectEffectSchema,
  meetingRoomReservationOrderObjectEffectSchema,
]);

type ReservationOrderObject = typeof reservationOrderObjectEffectSchema.Type;
const decodeReservationOrderObject = Schema.decodeUnknownSync(
  reservationOrderObjectEffectSchema
);

const normalizedReservationOrderEffectSchema = Schema.Union([
  normalizedCoworkReservationOrderEffectSchema,
  normalizedMeetingRoomReservationOrderEffectSchema,
]);

const toReservationSchemaIssue = (
  input: ReservationOrderObject,
  path: readonly PropertyKey[],
  message: string
) =>
  new SchemaIssue.Pointer(
    path,
    new SchemaIssue.InvalidValue(Option.some(input), { message })
  );

const toReservationFilterSchemaIssue = (
  input: ReservationOrderObject,
  issue: Schema.FilterIssue
): SchemaIssue.Issue => {
  if (typeof issue === "string") {
    return toReservationSchemaIssue(input, [], issue);
  }
  if (SchemaIssue.isIssue(issue)) {
    return issue;
  }

  return new SchemaIssue.Pointer(
    issue.path,
    typeof issue.issue === "string"
      ? new SchemaIssue.InvalidValue(Option.some(input), {
          message: issue.issue,
        })
      : issue.issue
  );
};

const validateReservationOrder = Effect.fn("validateReservationOrder")(
  function* (data: ReservationOrderObject) {
    const getCoworkIssues = (reservation: CoworkReservationOrderObject) =>
      Effect.succeed(getCoworkReservationIssues(reservation));
    const issues = yield* Match.value(data).pipe(
      Match.when({ entryTier: "meeting-room" }, (meetingRoomReservation) =>
        getMeetingRoomReservationIssues(meetingRoomReservation).pipe(
          Effect.mapError((error) =>
            toReservationSchemaIssue(data, [error.path], error.message)
          )
        )
      ),
      Match.when({ entryTier: "basic" }, getCoworkIssues),
      Match.when({ entryTier: "plus" }, getCoworkIssues),
      Match.when({ entryTier: "profi" }, getCoworkIssues),
      Match.exhaustive
    );
    const issue = issues[0];

    if (issue) {
      return yield* Effect.fail(toReservationFilterSchemaIssue(data, issue));
    }
  }
);

const normalizeMeetingRoomReservationOrder = (
  data: MeetingRoomReservationOrderObject
) =>
  getReservationIntervalNormalization(data).pipe(
    Effect.map((interval) => ({
      name: data.name,
      email: data.email,
      phone: data.phone,
      ...(data.message !== undefined && { message: data.message }),
      entryTier: "meeting-room" as const,
      ...interval,
    }))
  );

const normalizeReservationOrder = (data: ReservationOrderObject) =>
  Match.value(data).pipe(
    Match.when(
      { entryTier: "meeting-room" },
      normalizeMeetingRoomReservationOrder
    ),
    Match.when({ entryTier: "basic" }, (coworkReservation) =>
      Effect.succeed(normalizeCoworkReservationOrder(coworkReservation))
    ),
    Match.when({ entryTier: "plus" }, (coworkReservation) =>
      Effect.succeed(normalizeCoworkReservationOrder(coworkReservation))
    ),
    Match.when({ entryTier: "profi" }, (coworkReservation) =>
      Effect.succeed(normalizeCoworkReservationOrder(coworkReservation))
    ),
    Match.exhaustive
  );

const decodeReservationOrder = Effect.fn("decodeReservationOrder")(function* (
  reservation: ReservationOrderObject
) {
  yield* validateReservationOrder(reservation);
  return yield* normalizeReservationOrder(reservation).pipe(
    Effect.mapError((error) =>
      toReservationSchemaIssue(reservation, [error.path], error.message)
    )
  );
});

export const reservationOrderEffectSchema =
  reservationOrderObjectEffectSchema.pipe(
    Schema.decodeTo(normalizedReservationOrderEffectSchema, {
      decode: SchemaGetter.transformOrFail(decodeReservationOrder),
      encode: SchemaGetter.transform(decodeReservationOrderObject),
    })
  );

export type ReservationOrderInput = typeof reservationOrderEffectSchema.Encoded;
export type ReservationOrderData = typeof reservationOrderEffectSchema.Type;

export type ReservationProductProjectionInput =
  | CoworkReservationProductInput
  | MeetingRoomReservationProductInput;

export const getReservationProductCoffee = (
  reservation: ReservationProductProjectionInput
) =>
  Match.value(reservation).pipe(
    Match.when(
      { entryTier: "meeting-room" },
      getMeetingRoomReservationProductCoffee
    ),
    Match.when({ entryTier: "basic" }, getCoworkReservationProductCoffee),
    Match.when({ entryTier: "plus" }, getCoworkReservationProductCoffee),
    Match.when({ entryTier: "profi" }, getCoworkReservationProductCoffee),
    Match.exhaustive
  );

export const getReservationProductMonitorOption = (
  reservation: ReservationProductProjectionInput
) =>
  Match.value(reservation).pipe(
    Match.when(
      { entryTier: "meeting-room" },
      getMeetingRoomReservationProductMonitorOption
    ),
    Match.when(
      { entryTier: "basic" },
      getCoworkReservationProductMonitorOption
    ),
    Match.when({ entryTier: "plus" }, getCoworkReservationProductMonitorOption),
    Match.when(
      { entryTier: "profi" },
      getCoworkReservationProductMonitorOption
    ),
    Match.exhaustive
  );
