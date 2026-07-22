import { Effect, Option, Schema, SchemaGetter, SchemaIssue } from "effect";
import { workspaceMeetingRoomDurationOptions } from "@/features/checkout/product-catalog";
import { m } from "@/features/i18n";
import { getMeetingRoomReservationInterval } from "@/features/reservation/meeting-room-reservation-time";
import { reservationLegalConsentSchema } from "@/features/reservation/reservation-consent";
import {
  normalizedReservationCustomerSchema,
  reservationCustomerSchema,
} from "@/features/reservation/reservation-contact";
import {
  getMeetingRoomDurationValidationMessage,
  getReservationIntervalNormalization,
  meetingRoomReservationDurationMinutesSchema,
  reservationTimestampInputSchema,
  wholeHourReservationInstantSchema,
} from "@/features/reservation/reservation-interval";
import { getDurationMinutes } from "@/features/reservation/reservation-interval-normalization";
import { meetingRoomReservationKind } from "@/features/reservation/reservation-kind";
import {
  instantStringSchema,
  localDateTimeSchema,
} from "@/shared/utils/temporal";

export const workspaceMeetingRoomProductIdentitySchema = Schema.Struct({
  kind: Schema.Literal(meetingRoomReservationKind),
  durationMinutes: Schema.Literals(workspaceMeetingRoomDurationOptions),
});

export type WorkspaceMeetingRoomProductIdentity =
  typeof workspaceMeetingRoomProductIdentitySchema.Type;

export const workspaceMeetingRoomProductKeySchema = Schema.TemplateLiteral([
  workspaceMeetingRoomProductIdentitySchema.fields.kind,
  ":",
  workspaceMeetingRoomProductIdentitySchema.fields.durationMinutes,
]);

export type WorkspaceMeetingRoomProductKey =
  typeof workspaceMeetingRoomProductKeySchema.Type;

export const getWorkspaceMeetingRoomProductKey = ({
  durationMinutes,
  kind,
}: WorkspaceMeetingRoomProductIdentity): WorkspaceMeetingRoomProductKey =>
  `${kind}:${durationMinutes}`;

const meetingRoomReservationOrderBaseSchema = Schema.Struct({
  ...reservationCustomerSchema.fields,
  startsAt: reservationTimestampInputSchema,
  endsAt: reservationTimestampInputSchema,
});

export const meetingRoomReservationOrderInputSchema = Schema.Struct({
  kind: Schema.Literal(meetingRoomReservationKind),
  ...meetingRoomReservationOrderBaseSchema.fields,
});

export const normalizedMeetingRoomReservationOrderSchema = Schema.Struct({
  kind: Schema.Literal(meetingRoomReservationKind),
  ...normalizedReservationCustomerSchema.fields,
  startsAt: instantStringSchema,
  endsAt: instantStringSchema,
});

export type MeetingRoomReservationOrderInput =
  typeof meetingRoomReservationOrderInputSchema.Type;
export type NormalizedMeetingRoomReservationOrder =
  typeof normalizedMeetingRoomReservationOrderSchema.Type;

export const meetingRoomReservationDetailsSchema = Schema.Struct({
  kind: Schema.Literal(meetingRoomReservationKind),
  startsAt: instantStringSchema,
  endsAt: instantStringSchema,
}).annotate({
  identifier: "MeetingRoomReservationDetails",
  description:
    "PII-free meeting-room reservation projection for external consumers.",
});

export type MeetingRoomReservationDetails =
  typeof meetingRoomReservationDetailsSchema.Type;

export const getMeetingRoomReservationDetails = (
  reservation: NormalizedMeetingRoomReservationOrder
): MeetingRoomReservationDetails =>
  meetingRoomReservationDetailsSchema.make({
    kind: meetingRoomReservationKind,
    startsAt: reservation.startsAt,
    endsAt: reservation.endsAt,
  });

export type MeetingRoomCheckoutAttemptDetails = {
  readonly kind: NormalizedMeetingRoomReservationOrder["kind"];
  readonly startsAt: NormalizedMeetingRoomReservationOrder["startsAt"];
  readonly endsAt: NormalizedMeetingRoomReservationOrder["endsAt"];
};

export const getMeetingRoomCheckoutAttemptDetails = (
  reservation: NormalizedMeetingRoomReservationOrder
): MeetingRoomCheckoutAttemptDetails => ({
  kind: reservation.kind,
  startsAt: reservation.startsAt,
  endsAt: reservation.endsAt,
});

export type MeetingRoomReservationProductInput = Pick<
  MeetingRoomReservationOrderInput,
  "kind"
>;

export const storedMeetingRoomReservationDetailsSchema = Schema.Struct({
  kind: workspaceMeetingRoomProductIdentitySchema.fields.kind,
}).annotate({
  identifier: "StoredMeetingRoomReservationDetails",
  description:
    "App-owned meeting-room product intent persisted with a reservation.",
});

export type StoredMeetingRoomReservationDetails =
  typeof storedMeetingRoomReservationDetailsSchema.Type;

export const getStoredMeetingRoomReservationDetails = (
  _reservation: MeetingRoomReservationProductInput
): StoredMeetingRoomReservationDetails => ({
  kind: meetingRoomReservationKind,
});

export const getMeetingRoomReservationProductCoffee = (
  _reservation: MeetingRoomReservationProductInput
) => false;

export const getMeetingRoomReservationProductMonitorOption = (
  _reservation: MeetingRoomReservationProductInput
) => undefined;

export const getMeetingRoomReservationIssues = Effect.fn(
  "getMeetingRoomReservationIssues"
)(function* (reservation: MeetingRoomReservationOrderInput) {
  const interval = yield* getReservationIntervalNormalization(reservation);
  if (!Schema.is(wholeHourReservationInstantSchema)(interval.startsAt)) {
    return [
      {
        path: ["startsAt"],
        issue: m.reservationValidationMeetingRoomStartWholeHour(),
      },
    ];
  }

  if (
    !Schema.is(meetingRoomReservationDurationMinutesSchema)(
      getDurationMinutes(interval)
    )
  ) {
    return [
      {
        path: ["endsAt"],
        issue: getMeetingRoomDurationValidationMessage(),
      },
    ];
  }

  if (
    Temporal.Instant.compare(
      Temporal.Instant.from(interval.endsAt),
      Temporal.Now.instant()
    ) < 0
  ) {
    return [
      {
        path: ["endsAt"],
        issue: m.reservationValidationMeetingRoomEnded(),
      },
    ];
  }

  return [];
});

const toMeetingRoomReservationSchemaIssue = (
  input: MeetingRoomReservationOrderInput,
  path: readonly PropertyKey[],
  message: string
) =>
  new SchemaIssue.Pointer(
    path,
    new SchemaIssue.InvalidValue(Option.some(input), { message })
  );

const validateMeetingRoomReservationOrder = Effect.fn(
  "validateMeetingRoomReservationOrder"
)(function* (reservation: MeetingRoomReservationOrderInput) {
  const issues = yield* getMeetingRoomReservationIssues(reservation).pipe(
    Effect.mapError((error) =>
      toMeetingRoomReservationSchemaIssue(
        reservation,
        [error.path],
        error.message
      )
    )
  );
  const issue = issues[0];

  if (issue) {
    return yield* Effect.fail(
      toMeetingRoomReservationSchemaIssue(reservation, issue.path, issue.issue)
    );
  }
});

export const normalizeMeetingRoomReservationOrder = (
  reservation: MeetingRoomReservationOrderInput
) =>
  getReservationIntervalNormalization(reservation).pipe(
    Effect.map((interval) =>
      normalizedMeetingRoomReservationOrderSchema.make({
        kind: meetingRoomReservationKind,
        name: reservation.name,
        email: reservation.email,
        phone: reservation.phone,
        ...(reservation.message !== undefined && {
          message: reservation.message,
        }),
        ...interval,
      })
    )
  );

const decodeMeetingRoomReservationOrder = Effect.fn(
  "decodeMeetingRoomReservationOrder"
)(function* (reservation: MeetingRoomReservationOrderInput) {
  yield* validateMeetingRoomReservationOrder(reservation);
  return yield* normalizeMeetingRoomReservationOrder(reservation).pipe(
    Effect.mapError((error) =>
      toMeetingRoomReservationSchemaIssue(
        reservation,
        [error.path],
        error.message
      )
    )
  );
});

const decodeMeetingRoomReservationOrderInput = Schema.decodeUnknownSync(
  meetingRoomReservationOrderInputSchema
);

export const meetingRoomReservationOrderSchema =
  meetingRoomReservationOrderInputSchema.pipe(
    Schema.decodeTo(normalizedMeetingRoomReservationOrderSchema, {
      decode: SchemaGetter.transformOrFail(decodeMeetingRoomReservationOrder),
      encode: SchemaGetter.transform(decodeMeetingRoomReservationOrderInput),
    })
  );

const meetingRoomStartDateTimeSchema = Schema.String.check(
  Schema.isNonEmpty({
    message: m.reservationValidationMeetingRoomStartRequired(),
  }),
  Schema.makeFilter((value) => value.endsWith(":00"), {
    message: m.reservationValidationMeetingRoomStartWholeHour(),
  }),
  Schema.makeFilter(
    (value) => value === "" || Schema.is(localDateTimeSchema)(value),
    { message: m.reservationValidationMeetingRoomStartRequired() }
  )
);

const meetingRoomReservationBaseSchema = Schema.Struct({
  ...reservationCustomerSchema.fields,
  startDateTime: meetingRoomStartDateTimeSchema,
  durationMinutes: Schema.Literals(workspaceMeetingRoomDurationOptions),
  legalConsent: reservationLegalConsentSchema,
});

export const meetingRoomReservationSchema =
  meetingRoomReservationBaseSchema.check(
    Schema.makeFilter((reservation) => {
      const interval = getMeetingRoomReservationInterval(
        reservation.startDateTime,
        reservation.durationMinutes
      );

      return (
        interval === null ||
        Temporal.Instant.compare(
          Temporal.Instant.from(interval.endsAt),
          Temporal.Now.instant()
        ) >= 0 || {
          path: ["startDateTime"],
          issue: m.reservationValidationMeetingRoomEnded(),
        }
      );
    })
  );

export type MeetingRoomReservationInput =
  typeof meetingRoomReservationSchema.Encoded;
export type MeetingRoomReservationData =
  typeof meetingRoomReservationSchema.Type;
