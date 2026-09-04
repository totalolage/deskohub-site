import {
  AdministrationStandaloneAccessCodeAttemptId,
  AdministrationStandaloneAccessCodeCreateInput,
  type AdministrationStandaloneAccessCodeCreationOutcome,
} from "@deskohub/workspace-admin-api";
import { WORKSPACE_SITE_TIME_ZONE } from "@deskohub/workspace-admin-api/site-time-zone";
import type { StandardSchemaV1 } from "@standard-schema/spec";
import { Schema } from "effect";
import type { StandaloneAccessCodeCreationOutcome } from "../standalone-access-code";

export const standaloneAccessCodeMinimumDurationHours = 1;
export const standaloneAccessCodeMaximumDurationHours = 672;

const elapsedHoursPerNanosecond = 1 / 3_600_000_000_000;

export const createStandaloneAccessCodeInputSchema = Schema.toStandardSchemaV1(
  Schema.Struct({
    attemptId: AdministrationStandaloneAccessCodeAttemptId,
    ...AdministrationStandaloneAccessCodeCreateInput.fields,
  }),
  { parseOptions: { errors: "all", onExcessProperty: "error" } }
);

export type CreateStandaloneAccessCodeInput = StandardSchemaV1.InferOutput<
  typeof createStandaloneAccessCodeInputSchema
>;

export type CreateStandaloneAccessCodeResult =
  | AdministrationStandaloneAccessCodeCreationOutcome
  | {
      readonly outcome: "failed";
      readonly kind: StandaloneAccessCodeCreationOutcome;
    };

export const createStandaloneAccessCodeAttemptId =
  (): AdministrationStandaloneAccessCodeAttemptId =>
    Schema.decodeSync(AdministrationStandaloneAccessCodeAttemptId)(
      globalThis.crypto.randomUUID()
    );

export interface StandaloneAccessCodeWindowValues {
  readonly name: string;
  readonly startsAt: string;
  readonly endsAt: string;
}

const toSiteInstant = (value: string) =>
  Temporal.PlainDateTime.from(value)
    .toZonedDateTime(WORKSPACE_SITE_TIME_ZONE)
    .toInstant();

const isWholeHourLocalTime = (dateTime: Temporal.PlainDateTime) =>
  dateTime.minute === 0 &&
  dateTime.second === 0 &&
  dateTime.millisecond === 0 &&
  dateTime.microsecond === 0 &&
  dateTime.nanosecond === 0;

export const isStandaloneAccessCodeLocalDateTime = (value: string) => {
  try {
    const dateTime = Temporal.PlainDateTime.from(value);
    if (dateTime.toString({ smallestUnit: "minute" }) !== value) return false;
    if (!isWholeHourLocalTime(dateTime)) return false;
    return dateTime
      .toZonedDateTime(WORKSPACE_SITE_TIME_ZONE)
      .toPlainDateTime()
      .equals(dateTime);
  } catch {
    return false;
  }
};

export const standaloneAccessCodeElapsedHours = ({
  startsAt,
  endsAt,
}: Pick<StandaloneAccessCodeWindowValues, "startsAt" | "endsAt">) => {
  if (
    !isStandaloneAccessCodeLocalDateTime(startsAt) ||
    !isStandaloneAccessCodeLocalDateTime(endsAt)
  ) {
    return null;
  }
  const elapsedHours =
    Number(
      toSiteInstant(endsAt).epochNanoseconds -
        toSiteInstant(startsAt).epochNanoseconds
    ) * elapsedHoursPerNanosecond;
  return Number.isInteger(elapsedHours) ? elapsedHours : null;
};

export const shiftStandaloneAccessCodeLocalEnd = ({
  startsAt,
  hours,
}: {
  readonly startsAt: string;
  readonly hours: number;
}) =>
  Temporal.PlainDateTime.from(startsAt)
    .toZonedDateTime(WORKSPACE_SITE_TIME_ZONE)
    .add({ hours })
    .toPlainDateTime()
    .toString({ smallestUnit: "minute" });

export const standaloneAccessCodeEarliestLocalEnd = (startsAt: string) => {
  let candidate = shiftStandaloneAccessCodeLocalEnd({
    startsAt,
    hours: standaloneAccessCodeMinimumDurationHours,
  });
  while (!isStandaloneAccessCodeWindowValid({ startsAt, endsAt: candidate })) {
    candidate = Temporal.PlainDateTime.from(candidate)
      .add({ hours: 1 })
      .toString({ smallestUnit: "minute" });
  }
  return candidate;
};

export const isStandaloneAccessCodeWindowValid = (
  values: Pick<StandaloneAccessCodeWindowValues, "startsAt" | "endsAt">
) => {
  const elapsedHours = standaloneAccessCodeElapsedHours(values);
  return (
    elapsedHours !== null &&
    elapsedHours >= standaloneAccessCodeMinimumDurationHours &&
    elapsedHours <= standaloneAccessCodeMaximumDurationHours
  );
};

export interface StandaloneAccessCodeFormFieldErrors {
  readonly name?: string;
  readonly startsAt?: string;
  readonly endsAt?: string;
}

const standaloneAccessCodeNameError = (name: string) => {
  const trimmedName = name.trim();
  if (trimmedName.length === 0) return "Enter a name for this access code.";
  if (trimmedName.length > 60) return "Use at most 60 characters.";
  return undefined;
};

const standaloneAccessCodeStartError = (startsAt: string) => {
  if (startsAt === "") return "Choose a start time.";
  if (!isStandaloneAccessCodeLocalDateTime(startsAt)) {
    return "Choose a valid start time on the whole hour.";
  }
  return undefined;
};

const standaloneAccessCodeEndError = (
  {
    startsAt,
    endsAt,
  }: Pick<StandaloneAccessCodeWindowValues, "startsAt" | "endsAt">,
  startsAtError: string | undefined
) => {
  if (endsAt === "") return "Choose an end time.";
  if (!isStandaloneAccessCodeLocalDateTime(endsAt)) {
    return "Choose a valid end time on the whole hour.";
  }
  if (
    startsAtError === undefined &&
    !isStandaloneAccessCodeWindowValid({ startsAt, endsAt })
  ) {
    return "The end must be 1 to 672 hours after the start.";
  }
  return undefined;
};

export const validateStandaloneAccessCodeForm = ({
  name,
  startsAt,
  endsAt,
}: StandaloneAccessCodeWindowValues): StandaloneAccessCodeFormFieldErrors => {
  const nameError = standaloneAccessCodeNameError(name);
  const startsAtError = standaloneAccessCodeStartError(startsAt);
  const endsAtError = standaloneAccessCodeEndError(
    { startsAt, endsAt },
    startsAtError
  );

  return {
    ...(nameError !== undefined && { name: nameError }),
    ...(startsAtError !== undefined && { startsAt: startsAtError }),
    ...(endsAtError !== undefined && { endsAt: endsAtError }),
  };
};

export const formatStandaloneAccessCodeLocalDateTime = (value: string) =>
  Temporal.PlainDateTime.from(value).toLocaleString("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  });

export const formatStandaloneAccessCodeDuration = (hours: number) =>
  `${hours} ${hours === 1 ? "hour" : "hours"}`;

export const standaloneAccessCodeFailureNotices = {
  rejected:
    "The provider rejected this access code. Adjust the details and try again.",
  "in-progress":
    "This access code is already being created. Wait a moment and try again.",
  unavailable:
    "Access-code creation is temporarily unavailable. Try again in a few minutes.",
} satisfies Record<
  Exclude<StandaloneAccessCodeCreationOutcome, "ambiguous">,
  string
>;

export const isSameStandaloneAccessCodeWindow = (
  left: StandaloneAccessCodeWindowValues,
  right: StandaloneAccessCodeWindowValues
) =>
  left.name === right.name &&
  left.startsAt === right.startsAt &&
  left.endsAt === right.endsAt;
