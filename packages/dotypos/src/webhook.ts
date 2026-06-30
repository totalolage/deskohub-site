import { Data, Effect, Schema, SchemaGetter } from "effect";

export class DotyposWebhookPayloadError extends Data.TaggedError(
  "DotyposWebhookPayloadError"
)<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export class DotyposWebhookAuthError extends Data.TaggedError(
  "DotyposWebhookAuthError"
)<{
  readonly message: string;
}> {}

const DotyposWebhookRecordSchema = Schema.Record(Schema.String, Schema.Unknown);

const DotyposWebhookRecordArraySchema = Schema.Array(
  DotyposWebhookRecordSchema
);

const finiteNumber = Schema.Number.check(Schema.isFinite());
const stringOrNull = Schema.Union([Schema.String, Schema.Null]);
const optionalFiniteNumber = Schema.optional(
  Schema.Unknown.pipe(
    Schema.decodeTo(Schema.UndefinedOr(finiteNumber), {
      decode: SchemaGetter.transform((value) =>
        typeof value === "number" && Number.isFinite(value) ? value : undefined
      ),
      encode: SchemaGetter.transform((value) => value),
    })
  )
);
const optionalString = Schema.optional(
  Schema.Unknown.pipe(
    Schema.decodeTo(Schema.UndefinedOr(Schema.String), {
      decode: SchemaGetter.transform((value) =>
        typeof value === "string" ? value : undefined
      ),
      encode: SchemaGetter.transform((value) => value),
    })
  )
);
const optionalStringOrNull = Schema.optional(
  Schema.Unknown.pipe(
    Schema.decodeTo(Schema.UndefinedOr(stringOrNull), {
      decode: SchemaGetter.transform((value) =>
        typeof value === "string" || value === null ? value : undefined
      ),
      encode: SchemaGetter.transform((value) => value),
    })
  )
);

const DotyposReservationWebhookRecordSchema = Schema.Struct({
  reservationid: finiteNumber,
  branchid: optionalFiniteNumber,
  cloudid: optionalString,
  created: optionalFiniteNumber,
  customerid: optionalFiniteNumber,
  deleted: optionalFiniteNumber,
  employeeid: optionalFiniteNumber,
  enddate: optionalFiniteNumber,
  flags: optionalFiniteNumber,
  note: optionalStringOrNull,
  seats: optionalFiniteNumber,
  startdate: optionalFiniteNumber,
  status: optionalFiniteNumber,
  tableid: optionalFiniteNumber,
  taglist: optionalStringOrNull,
  versiondate: optionalFiniteNumber,
});

const DotyposReservationWebhookRecordArraySchema = Schema.Array(
  DotyposReservationWebhookRecordSchema
);

export type DotyposWebhookRecord = Schema.Schema.Type<
  typeof DotyposWebhookRecordSchema
>;

export type DotyposReservationWebhookRecord = Schema.Schema.Type<
  typeof DotyposReservationWebhookRecordSchema
>;

export type DotyposWebhookPayload =
  | {
      readonly kind: "reservation";
      readonly records: readonly DotyposReservationWebhookRecord[];
    }
  | {
      readonly kind: "unknown";
      readonly records: readonly DotyposWebhookRecord[];
    };

export interface DotyposWebhookRequestOptions {
  readonly requireSecret: boolean;
  readonly secret: string;
}

const mapPayloadParseError = () =>
  new DotyposWebhookPayloadError({
    message: "Invalid Dotypos webhook payload",
  });

const decodeDotyposWebhookRecords = Schema.decodeUnknownEffect(
  DotyposWebhookRecordArraySchema
);

const decodeDotyposReservationWebhookRecords = Schema.decodeUnknownEffect(
  DotyposReservationWebhookRecordArraySchema
);

export const parseDotyposWebhookPayload = (payload: unknown) =>
  Effect.gen(function* () {
    const records = yield* decodeDotyposWebhookRecords(payload).pipe(
      Effect.mapError(mapPayloadParseError)
    );
    const reservationRecords = yield* decodeDotyposReservationWebhookRecords(
      payload
    ).pipe(Effect.result);

    if (records.length > 0 && reservationRecords._tag === "Success") {
      return {
        kind: "reservation",
        records: reservationRecords.success,
      } as const;
    }

    return { kind: "unknown", records } as const;
  });

const validateDotyposWebhookSecret = (
  request: Request,
  options: DotyposWebhookRequestOptions
) =>
  Effect.gen(function* () {
    if (!options.requireSecret) return;

    const providedSecret = new URL(request.url).searchParams.get("secret");

    if (!providedSecret) {
      return yield* new DotyposWebhookAuthError({
        message: "Missing webhook secret",
      });
    }

    if (providedSecret !== options.secret) {
      return yield* new DotyposWebhookAuthError({
        message: "Invalid webhook secret",
      });
    }
  });

const readDotyposWebhookJson = (request: Request) =>
  Effect.tryPromise({
    try: () => request.json(),
    catch: (cause) =>
      new DotyposWebhookPayloadError({
        message: "Failed to parse request body",
        cause,
      }),
  });

export const verifyDotyposWebhookRequest = (
  request: Request,
  options: DotyposWebhookRequestOptions
) =>
  Effect.gen(function* () {
    yield* validateDotyposWebhookSecret(request, options);
    const payload = yield* readDotyposWebhookJson(request);
    return yield* parseDotyposWebhookPayload(payload);
  });
