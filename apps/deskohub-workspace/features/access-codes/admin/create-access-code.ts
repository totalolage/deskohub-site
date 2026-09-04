import {
  AdministrationStandaloneAccessCodeAttemptId,
  type AdministrationStandaloneAccessCodeCleanupTargetType,
  AdministrationStandaloneAccessCodeCreateInput,
  type AdministrationStandaloneAccessCodeCreationOutcome,
  type AdministrationWorkspaceSiteLocalWholeHourDateTime,
} from "@deskohub/workspace-admin-api";
import { WORKSPACE_SITE_TIME_ZONE } from "@deskohub/workspace-admin-api/site-time-zone";
import type { StandardSchemaV1 } from "@standard-schema/spec";
import { Match, Result, Schema } from "effect";
import type { StandaloneAccessCodeCreationOutcome } from "../standalone-access-code";

export const standaloneAccessCodeMinimumDurationHours = 1;
export const standaloneAccessCodeMaximumDurationHours = 672;

const elapsedHoursPerNanosecond = 1 / 3_600_000_000_000;

export const createStandaloneAccessCodeInputSchema = Schema.toStandardSchemaV1(
  Schema.Struct({
    attemptId: AdministrationStandaloneAccessCodeAttemptId,
    ...AdministrationStandaloneAccessCodeCreateInput.fields,
    providerCredentialRemovedAttemptId: Schema.optionalKey(
      AdministrationStandaloneAccessCodeAttemptId
    ),
  }).check(
    Schema.makeFilter<{
      readonly startsAt: AdministrationWorkspaceSiteLocalWholeHourDateTime;
      readonly endsAt: AdministrationWorkspaceSiteLocalWholeHourDateTime;
    }>(
      ({ startsAt, endsAt }) =>
        isStandaloneAccessCodeWindowValid({ startsAt, endsAt }) || {
          path: ["endsAt"],
          issue: "The end must be 1 to 672 hours after the start.",
        }
    )
  ),
  { parseOptions: { errors: "all", onExcessProperty: "error" } }
);

export type CreateStandaloneAccessCodeInput = StandardSchemaV1.InferOutput<
  typeof createStandaloneAccessCodeInputSchema
>;

/**
 * Plain-data failure of a standalone access-code creation attempt. Target
 * bearing outcomes must name the exact earlier attempt the operator has to
 * clean up at the lock; unrelated outcomes stay target-free.
 */
export type StandaloneAccessCodeCreationFailure =
  | {
      readonly outcome: "ambiguous";
      readonly cleanupTarget: AdministrationStandaloneAccessCodeCleanupTargetType;
    }
  | {
      readonly outcome: "cleanup-required";
      readonly cleanupTarget: AdministrationStandaloneAccessCodeCleanupTargetType;
    }
  | { readonly outcome: "rejected" }
  | { readonly outcome: "in-progress" }
  | { readonly outcome: "unavailable" }
  | { readonly outcome: "reconciled" };

/**
 * Maps a creation error into the transportable failure shape. A missing
 * cleanup target for a target-bearing outcome returns `null`, which the
 * action boundary must treat as a defect instead of inventing a target.
 */
export const toStandaloneAccessCodeCreationFailure = (error: {
  readonly outcome: StandaloneAccessCodeCreationOutcome;
  readonly cleanupTarget?: AdministrationStandaloneAccessCodeCleanupTargetType;
}): StandaloneAccessCodeCreationFailure | null => {
  const targetBearingFailure = (
    outcome: "ambiguous" | "cleanup-required"
  ): StandaloneAccessCodeCreationFailure | null =>
    error.cleanupTarget === undefined
      ? null
      : { outcome, cleanupTarget: error.cleanupTarget };

  return Match.value(error.outcome).pipe(
    Match.when("ambiguous", targetBearingFailure),
    Match.when("cleanup-required", targetBearingFailure),
    Match.when("rejected", (outcome) => ({ outcome })),
    Match.when("in-progress", (outcome) => ({ outcome })),
    Match.when("unavailable", (outcome) => ({ outcome })),
    Match.when("reconciled", (outcome) => ({ outcome })),
    Match.exhaustive
  );
};

export type CreateStandaloneAccessCodeResult = Result.Result<
  AdministrationStandaloneAccessCodeCreationOutcome,
  StandaloneAccessCodeCreationFailure
>;

/**
 * Plain-data shape of the action result that survives Server Action
 * transport; the domain Result is rebuilt client-side by its decode helper.
 */
export type CreateStandaloneAccessCodeTransport =
  | {
      readonly status: "succeeded";
      readonly outcome: AdministrationStandaloneAccessCodeCreationOutcome;
    }
  | {
      readonly status: "failed";
      readonly outcome: StandaloneAccessCodeCreationFailure;
    };

export const encodeCreateStandaloneAccessCodeResult = (
  result: CreateStandaloneAccessCodeResult
): CreateStandaloneAccessCodeTransport =>
  Result.match(result, {
    onSuccess: (outcome) => ({ status: "succeeded", outcome }),
    onFailure: (outcome) => ({ status: "failed", outcome }),
  });

export const decodeCreateStandaloneAccessCodeResult = (
  transport: CreateStandaloneAccessCodeTransport
): CreateStandaloneAccessCodeResult =>
  transport.status === "succeeded"
    ? Result.succeed(transport.outcome)
    : Result.fail(transport.outcome);

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

const standaloneAccessCodeFormWholeHourDateTime = (
  emptyMessage: string,
  invalidMessage: string
) =>
  Schema.String.check(
    Schema.isNonEmpty({ message: emptyMessage }),
    Schema.makeFilter(
      (value) => value === "" || isStandaloneAccessCodeLocalDateTime(value),
      { message: invalidMessage }
    )
  );

export const createStandaloneAccessCodeFormSchema = Schema.toStandardSchemaV1(
  Schema.Struct({
    name: Schema.Trim.check(
      Schema.isNonEmpty({
        message: "Enter a name for this access code.",
      }),
      Schema.isMaxLength(60, { message: "Use at most 60 characters." })
    ),
    startsAt: standaloneAccessCodeFormWholeHourDateTime(
      "Choose a start time.",
      "Choose a valid start time on the whole hour."
    ),
    endsAt: standaloneAccessCodeFormWholeHourDateTime(
      "Choose an end time.",
      "Choose a valid end time on the whole hour."
    ),
  }).check(
    Schema.makeFilter<{
      readonly startsAt: string;
      readonly endsAt: string;
    }>(
      ({ startsAt, endsAt }) =>
        isStandaloneAccessCodeWindowValid({ startsAt, endsAt }) || {
          path: ["endsAt"],
          issue: "The end must be 1 to 672 hours after the start.",
        }
    )
  ),
  { parseOptions: { errors: "all" } }
);

export type CreateStandaloneAccessCodeFormInput = StandardSchemaV1.InferInput<
  typeof createStandaloneAccessCodeFormSchema
>;

export type CreateStandaloneAccessCodeFormValues = StandardSchemaV1.InferOutput<
  typeof createStandaloneAccessCodeFormSchema
>;

export const createStandaloneAccessCodeFormDefaults = {
  name: "",
  startsAt: "",
  endsAt: "",
} satisfies CreateStandaloneAccessCodeFormInput;

export const formatStandaloneAccessCodeLocalDateTime = (value: string) =>
  Temporal.PlainDateTime.from(value).toLocaleString("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  });

export const formatStandaloneAccessCodeDuration = (hours: number) =>
  `${hours} ${hours === 1 ? "hour" : "hours"}`;

export const standaloneAccessCodeCleanupConfirmationLabel =
  "I removed the named access code at the lock, or verified that it is absent.";

export const standaloneAccessCodeFailureNotices = {
  rejected:
    "The provider rejected this access code. Adjust the details and try again.",
  "in-progress":
    "This access code is already being created. Wait a moment and try again.",
  unavailable:
    "Access-code creation is temporarily unavailable. Try again in a few minutes.",
  reconciled:
    "Your confirmed cleanup was recorded for the earlier ambiguous attempt, which created no access code. Submit again to create the access code.",
} satisfies Record<
  Exclude<
    StandaloneAccessCodeCreationOutcome,
    "ambiguous" | "cleanup-required"
  >,
  string
>;

export const isSameStandaloneAccessCodeWindow = (
  left: StandaloneAccessCodeWindowValues,
  right: StandaloneAccessCodeWindowValues
) =>
  left.name === right.name &&
  left.startsAt === right.startsAt &&
  left.endsAt === right.endsAt;
