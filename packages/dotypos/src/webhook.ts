import { Data, Effect } from "effect";

export class DotyposWebhookPayloadError extends Data.TaggedError(
  "DotyposWebhookPayloadError"
)<{
  readonly message: string;
  readonly issues?: unknown;
}> {}

export type DotyposWebhookRecord = Readonly<Record<string, unknown>>;

export interface DotyposReservationWebhookRecord extends DotyposWebhookRecord {
  readonly reservationid: number;
  readonly branchid?: number;
  readonly cloudid?: string;
  readonly created?: number;
  readonly customerid?: number;
  readonly deleted?: number;
  readonly employeeid?: number;
  readonly enddate?: number;
  readonly flags?: number;
  readonly note?: string | null;
  readonly seats?: number;
  readonly startdate?: number;
  readonly status?: number;
  readonly tableid?: number;
  readonly taglist?: string | null;
  readonly versiondate?: number;
}

export type DotyposWebhookPayload =
  | {
      readonly kind: "reservation";
      readonly records: readonly DotyposReservationWebhookRecord[];
    }
  | {
      readonly kind: "unknown";
      readonly records: readonly DotyposWebhookRecord[];
    };

const isRecord = (value: unknown): value is DotyposWebhookRecord =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const optionalNumberField = (
  record: DotyposWebhookRecord,
  key: keyof DotyposReservationWebhookRecord
) => {
  const value = record[key];
  return isFiniteNumber(value) ? value : undefined;
};

const optionalStringOrNullField = (
  record: DotyposWebhookRecord,
  key: keyof DotyposReservationWebhookRecord
) => {
  const value = record[key];
  return typeof value === "string" || value === null ? value : undefined;
};

const toReservationWebhookRecord = (
  record: DotyposWebhookRecord
): DotyposReservationWebhookRecord => ({
  ...record,
  reservationid: record.reservationid as number,
  branchid: optionalNumberField(record, "branchid"),
  cloudid: typeof record.cloudid === "string" ? record.cloudid : undefined,
  created: optionalNumberField(record, "created"),
  customerid: optionalNumberField(record, "customerid"),
  deleted: optionalNumberField(record, "deleted"),
  employeeid: optionalNumberField(record, "employeeid"),
  enddate: optionalNumberField(record, "enddate"),
  flags: optionalNumberField(record, "flags"),
  note: optionalStringOrNullField(record, "note"),
  seats: optionalNumberField(record, "seats"),
  startdate: optionalNumberField(record, "startdate"),
  status: optionalNumberField(record, "status"),
  tableid: optionalNumberField(record, "tableid"),
  taglist: optionalStringOrNullField(record, "taglist"),
  versiondate: optionalNumberField(record, "versiondate"),
});

export const parseDotyposWebhookPayload = (payload: unknown) =>
  Effect.gen(function* () {
    if (!Array.isArray(payload)) {
      return yield* new DotyposWebhookPayloadError({
        message: "Dotypos webhook payload must be an array",
      });
    }

    const records: DotyposWebhookRecord[] = [];
    for (const [index, item] of payload.entries()) {
      if (!isRecord(item)) {
        return yield* new DotyposWebhookPayloadError({
          message: "Dotypos webhook records must be objects",
          issues: { index },
        });
      }

      records.push(item);
    }

    if (
      records.length > 0 &&
      records.every((record) => isFiniteNumber(record.reservationid))
    ) {
      return {
        kind: "reservation",
        records: records.map(toReservationWebhookRecord),
      } as const;
    }

    return { kind: "unknown", records } as const;
  });
