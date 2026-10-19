import { Schema } from "effect";

export const IgloohomeDeviceIdSchema = Schema.NonEmptyString.pipe(
  Schema.brand("IgloohomeDeviceId")
).annotate({
  identifier: "IgloohomeDeviceId",
  description:
    "Bluetooth ID of the algoPIN target; use the EK1 Keypad ID for an OE1 + EK1 setup.",
});
export type IgloohomeDeviceId = typeof IgloohomeDeviceIdSchema.Type;

export const IgloohomePinIdSchema = Schema.NonEmptyString.pipe(
  Schema.brand("IgloohomePinId")
).annotate({
  identifier: "IgloohomePinId",
  description: "Provider identifier for an issued AlgoPIN.",
});
export type IgloohomePinId = typeof IgloohomePinIdSchema.Type;

/** How many digits an igloohome AlgoPIN has. */
export const algoPinLength = { minimum: 7, maximum: 9 } as const;

export const AlgoPinSchema = Schema.String.check(
  Schema.isPattern(
    new RegExp(`^[0-9]{${algoPinLength.minimum},${algoPinLength.maximum}}$`)
  )
)
  .pipe(Schema.brand("AlgoPin"))
  .annotate({
    identifier: "AlgoPin",
    description: "Seven-to-nine-digit igloohome AlgoPIN access credential.",
  });
export type AlgoPin = typeof AlgoPinSchema.Type;

export type AlgoPinVariance = 1 | 2 | 3;

export interface IssueHourlyAlgoPinInput {
  readonly deviceId: IgloohomeDeviceId;
  readonly variance: AlgoPinVariance;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly accessName: string;
}

export interface IssuedHourlyAlgoPin {
  readonly pin: AlgoPin;
  readonly pinId: IgloohomePinId;
}
