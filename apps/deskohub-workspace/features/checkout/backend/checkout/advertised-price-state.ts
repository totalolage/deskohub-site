import { Data, Effect, Match, Schema } from "effect";
import {
  type CoworkReservationQuote,
  coworkReservationQuoteSchema,
} from "@/features/checkout/reservation-quote-cowork";
import {
  type MeetingRoomReservationQuote,
  meetingRoomReservationQuoteSchema,
} from "@/features/checkout/reservation-quote-meeting-room";
import {
  type OfficeReservationQuote,
  officeReservationQuoteSchema,
} from "@/features/checkout/reservation-quote-office";
import {
  type CanonicalPromotionCode,
  canonicalPromotionCodeSchema,
  discountIdSchema,
} from "@/features/discounts";
import type { Locale } from "@/features/i18n";
import {
  type CoworkAdvertisedPriceReservation,
  coworkAdvertisedPriceReservationSchema,
} from "@/features/reservation/cowork-reservation";
import {
  type MeetingRoomAdvertisedPriceReservation,
  meetingRoomAdvertisedPriceReservationSchema,
} from "@/features/reservation/meeting-room-reservation";
import {
  type OfficeAdvertisedPriceReservation,
  officeAdvertisedPriceReservationSchema,
} from "@/features/reservation/office-reservation";
import {
  makeLegacySealedState,
  type SealedStateIssueOptions,
  type SealedStateSealOptions,
  type SealedStateTokenError,
} from "@/shared/backend/sealed-state";
import {
  getSubmittedCodeMetadata,
  type PayStateSubmittedCodeMetadata,
} from "./pay-state-contract";
import { workspaceCheckoutPriceStateSchema } from "./workspace-checkout-price-state";

const advertisedPriceStateDefaultTtlMilliseconds = 10 * 60 * 1000;

const absentSubmittedCodeMetadataSchema = Schema.Struct({
  submittedCode: Schema.optionalKey(Schema.Never),
  submittedCodeDiscountId: Schema.optionalKey(Schema.Never),
});

const submittedCodeMetadataSchema = Schema.Struct({
  submittedCode: canonicalPromotionCodeSchema,
  submittedCodeDiscountId: discountIdSchema,
});

const requestedDiscountCodeSchemaField = {
  requestedDiscountCode: Schema.optional(canonicalPromotionCodeSchema),
};

const coworkAdvertisedPriceStateSchema = Schema.Struct({
  ...workspaceCheckoutPriceStateSchema.fields,
  kind: coworkAdvertisedPriceReservationSchema.fields.kind,
  reservation: coworkAdvertisedPriceReservationSchema,
  quote: coworkReservationQuoteSchema,
  ...requestedDiscountCodeSchemaField,
});

const meetingRoomAdvertisedPriceStateSchema = Schema.Struct({
  ...workspaceCheckoutPriceStateSchema.fields,
  kind: meetingRoomAdvertisedPriceReservationSchema.fields.kind,
  reservation: meetingRoomAdvertisedPriceReservationSchema,
  quote: meetingRoomReservationQuoteSchema,
  ...requestedDiscountCodeSchemaField,
});

const officeAdvertisedPriceStateSchema = Schema.Struct({
  ...workspaceCheckoutPriceStateSchema.fields,
  kind: officeAdvertisedPriceReservationSchema.fields.kind,
  reservation: officeAdvertisedPriceReservationSchema,
  quote: officeReservationQuoteSchema,
  ...requestedDiscountCodeSchemaField,
});

const advertisedPriceStateSchema = Schema.Union([
  Schema.Struct({
    ...coworkAdvertisedPriceStateSchema.fields,
    ...absentSubmittedCodeMetadataSchema.fields,
  }),
  Schema.Struct({
    ...coworkAdvertisedPriceStateSchema.fields,
    ...submittedCodeMetadataSchema.fields,
  }),
  Schema.Struct({
    ...meetingRoomAdvertisedPriceStateSchema.fields,
    ...absentSubmittedCodeMetadataSchema.fields,
  }),
  Schema.Struct({
    ...meetingRoomAdvertisedPriceStateSchema.fields,
    ...submittedCodeMetadataSchema.fields,
  }),
  Schema.Struct({
    ...officeAdvertisedPriceStateSchema.fields,
    ...absentSubmittedCodeMetadataSchema.fields,
  }),
  Schema.Struct({
    ...officeAdvertisedPriceStateSchema.fields,
    ...submittedCodeMetadataSchema.fields,
  }),
]).annotate({
  identifier: "AdvertisedPriceState",
  description:
    "PII-free Workspace price advertisement state protected for reservation submission.",
});

export type AdvertisedPriceState = typeof advertisedPriceStateSchema.Type;

/**
 * Advertised-price tokens ride on reservation pages into the submission, so
 * they keep the sealed state format that predates purposes.
 */
const advertisedPriceStateCodec = makeLegacySealedState({
  schema: advertisedPriceStateSchema,
  ttlMilliseconds: advertisedPriceStateDefaultTtlMilliseconds,
});

type AdvertisedPriceStateInput = (
  | {
      readonly kind: "cowork";
      readonly locale: Locale;
      readonly reservation: CoworkAdvertisedPriceReservation;
      readonly quote: CoworkReservationQuote;
      readonly requestedDiscountCode?: CanonicalPromotionCode;
      readonly ttlMilliseconds?: number;
    }
  | {
      readonly kind: "meeting-room";
      readonly locale: Locale;
      readonly reservation: MeetingRoomAdvertisedPriceReservation;
      readonly quote: MeetingRoomReservationQuote;
      readonly requestedDiscountCode?: CanonicalPromotionCode;
      readonly ttlMilliseconds?: number;
    }
  | {
      readonly kind: "office";
      readonly locale: Locale;
      readonly reservation: OfficeAdvertisedPriceReservation;
      readonly quote: OfficeReservationQuote;
      readonly requestedDiscountCode?: CanonicalPromotionCode;
      readonly ttlMilliseconds?: number;
    }
) &
  PayStateSubmittedCodeMetadata;

class AdvertisedPriceStateTokenError extends Data.TaggedError(
  "AdvertisedPriceStateTokenError"
)<{
  readonly code: SealedStateTokenError["code"];
  readonly message: string;
  readonly cause?: unknown;
}> {
  static fromStateFailure = (
    cause: SealedStateTokenError | Schema.SchemaError
  ) =>
    Match.value(cause).pipe(
      Match.tag(
        "SealedStateTokenError",
        (failure) =>
          new AdvertisedPriceStateTokenError({
            code: failure.code,
            message: failure.message,
            cause: failure,
          })
      ),
      Match.tag(
        "SchemaError",
        (failure) =>
          new AdvertisedPriceStateTokenError({
            code: "invalid-token",
            message: "Invalid advertised price state.",
            cause: failure,
          })
      ),
      Match.exhaustive
    );
}

export class AdvertisedPriceMismatchError extends Data.TaggedError(
  "AdvertisedPriceMismatchError"
)<{
  readonly reason: "invalid_token" | "input_mismatch";
  readonly message: string;
  readonly cause?: unknown;
}> {}

export const buildAdvertisedPriceState = Effect.fn(
  "advertisedPriceState.build"
)(function* (
  input: AdvertisedPriceStateInput,
  options: SealedStateIssueOptions = {}
) {
  const claims = yield* advertisedPriceStateCodec.issueClaims({
    issuedAt: options.issuedAt,
    ttlMilliseconds: input.ttlMilliseconds,
  });

  return yield* Schema.decodeUnknownEffect(advertisedPriceStateSchema, {
    onExcessProperty: "error",
  })({
    ...claims,
    kind: input.kind,
    locale: input.locale,
    reservation: input.reservation,
    quote: input.quote,
    ...(input.requestedDiscountCode !== undefined && {
      requestedDiscountCode: input.requestedDiscountCode,
    }),
    ...getSubmittedCodeMetadata(input),
  });
}, Effect.mapError(AdvertisedPriceStateTokenError.fromStateFailure));

export const sealAdvertisedPriceState = Effect.fn("advertisedPriceState.seal")(
  (state: AdvertisedPriceState, options: SealedStateSealOptions = {}) =>
    advertisedPriceStateCodec
      .seal(state, options)
      .pipe(Effect.mapError(AdvertisedPriceStateTokenError.fromStateFailure))
);

export const openAdvertisedPriceState = Effect.fn("advertisedPriceState.open")(
  (token: string) =>
    advertisedPriceStateCodec
      .open(token)
      .pipe(Effect.mapError(AdvertisedPriceStateTokenError.fromStateFailure))
);

export const openSubmittedAdvertisedPriceState = Effect.fn(
  "advertisedPriceState.openSubmitted"
)((token: string) =>
  openAdvertisedPriceState(token).pipe(
    Effect.mapError(
      (cause) =>
        new AdvertisedPriceMismatchError({
          reason: "invalid_token",
          message: "Advertised price snapshot is invalid or expired.",
          cause,
        })
    )
  )
);
