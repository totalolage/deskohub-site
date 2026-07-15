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
    const issues = yield* Match.value(data).pipe(
      Match.when({ entryTier: "meeting-room" }, (meetingRoomReservation) =>
        getMeetingRoomReservationIssues(meetingRoomReservation).pipe(
          Effect.mapError((error) =>
            toReservationSchemaIssue(data, [error.path], error.message)
          )
        )
      ),
      Match.orElse((coworkReservation) =>
        Effect.succeed(getCoworkReservationIssues(coworkReservation))
      )
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
    Match.orElse((coworkReservation) =>
      Effect.succeed(normalizeCoworkReservationOrder(coworkReservation))
    )
  );

export const reservationOrderEffectSchema =
  reservationOrderObjectEffectSchema.pipe(
    Schema.decodeTo(normalizedReservationOrderEffectSchema, {
      decode: SchemaGetter.transformOrFail((reservation) =>
        validateReservationOrder(reservation).pipe(
          Effect.andThen(
            normalizeReservationOrder(reservation).pipe(
              Effect.mapError((error) =>
                toReservationSchemaIssue(
                  reservation,
                  [error.path],
                  error.message
                )
              )
            )
          )
        )
      ),
      encode: SchemaGetter.transform(decodeReservationOrderObject),
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
