import {
  ADMINISTRATION_STANDALONE_ACCESS_CODE_MAXIMUM_DURATION_HOURS,
  ADMINISTRATION_STANDALONE_ACCESS_CODE_MINIMUM_DURATION_HOURS,
  AdministrationStandaloneAccessCodeAttemptId,
  type AdministrationStandaloneAccessCodeCleanupTargetType,
  AdministrationStandaloneAccessCodeCreateInput,
  type AdministrationStandaloneAccessCodeCreationOutcome,
  type AdministrationWorkspaceSiteLocalWholeHourDateTime,
  isStandaloneAccessCodeWindowWithinContractDuration,
} from "@deskohub/workspace-admin-api";
import { WORKSPACE_SITE_TIME_ZONE } from "@deskohub/workspace-admin-api/site-time-zone";
import type { StandardSchemaV1 } from "@standard-schema/spec";
import { Match, Option, Result, Schema } from "effect";
import { formatAdministrationDateTime } from "@/features/administration/formatters";
import { m } from "@/features/administration/i18n";
import type { Locale } from "@/features/i18n";
import { formatDuration } from "@/shared/utils/format-duration";
import {
  isWholeHour,
  localDateTimeToInstant,
  localDateTimeToTemporalInstantString,
} from "@/shared/utils/temporal";
import type { StandaloneAccessCodeCreationOutcome } from "../standalone-access-code";

// The action contract's own validation copy: the form validates the same
// window first with localized copy, and the client never renders action
// validation errors.
const standaloneAccessCodeWindowDurationIssue = `The end must be ${ADMINISTRATION_STANDALONE_ACCESS_CODE_MINIMUM_DURATION_HOURS} to ${ADMINISTRATION_STANDALONE_ACCESS_CODE_MAXIMUM_DURATION_HOURS} hours after the start.`;

const nanosecondsPerHour = 3_600_000_000_000n;

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
        isStandaloneAccessCodeWindowWithinContractDuration({
          startsAt,
          endsAt,
        }) || {
          path: ["endsAt"],
          issue: standaloneAccessCodeWindowDurationIssue,
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
 * A raw Result does not survive: JSON keeps `_tag` but moves the payload to
 * `value`, and structured clone keeps `.success` but drops `_tag`.
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

const checkStandaloneAccessCodeLocalDateTime = Option.liftThrowable(
  (value: string) => {
    const dateTime = Temporal.PlainDateTime.from(value);
    if (dateTime.toString({ smallestUnit: "minute" }) !== value) return false;
    if (!isWholeHour(dateTime)) return false;
    return dateTime
      .toZonedDateTime(WORKSPACE_SITE_TIME_ZONE)
      .toPlainDateTime()
      .equals(dateTime);
  }
);

/** Whether a value is a canonical whole-hour local time that exists on site. */
export const isStandaloneAccessCodeLocalDateTime = (value: string) =>
  checkStandaloneAccessCodeLocalDateTime(value).pipe(
    Option.getOrElse(() => false)
  );

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
  // Exact integer arithmetic: multiplying by a floating-point reciprocal
  // made valid whole-hour durations such as 15 or 60 hours non-integer.
  const elapsedNanoseconds =
    localDateTimeToInstant({
      dateTime: endsAt,
      timeZone: WORKSPACE_SITE_TIME_ZONE,
    }).epochNanoseconds -
    localDateTimeToInstant({
      dateTime: startsAt,
      timeZone: WORKSPACE_SITE_TIME_ZONE,
    }).epochNanoseconds;
  return elapsedNanoseconds % nanosecondsPerHour === 0n
    ? Number(elapsedNanoseconds / nanosecondsPerHour)
    : null;
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
    hours: ADMINISTRATION_STANDALONE_ACCESS_CODE_MINIMUM_DURATION_HOURS,
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
    elapsedHours >=
      ADMINISTRATION_STANDALONE_ACCESS_CODE_MINIMUM_DURATION_HOURS &&
    elapsedHours <= ADMINISTRATION_STANDALONE_ACCESS_CODE_MAXIMUM_DURATION_HOURS
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

const standaloneAccessCodeNameMaximumLength = 60;

export const createStandaloneAccessCodeFormSchema = (locale: Locale) =>
  Schema.Struct({
    name: Schema.Trim.check(
      Schema.isNonEmpty({
        message: m.accessCodesNameRequired({}, { locale }),
      }),
      Schema.isMaxLength(standaloneAccessCodeNameMaximumLength, {
        message: m.accessCodesNameTooLong(
          { maximum: standaloneAccessCodeNameMaximumLength },
          { locale }
        ),
      })
    ),
    startsAt: standaloneAccessCodeFormWholeHourDateTime(
      m.accessCodesStartRequired({}, { locale }),
      m.accessCodesStartInvalid({}, { locale })
    ),
    endsAt: standaloneAccessCodeFormWholeHourDateTime(
      m.accessCodesEndRequired({}, { locale }),
      m.accessCodesEndInvalid({}, { locale })
    ),
  }).check(
    Schema.makeFilter<{
      readonly startsAt: string;
      readonly endsAt: string;
    }>(
      ({ startsAt, endsAt }) =>
        isStandaloneAccessCodeWindowValid({ startsAt, endsAt }) || {
          path: ["endsAt"],
          issue: m.accessCodesWindowDurationInvalid(
            {
              minimum:
                ADMINISTRATION_STANDALONE_ACCESS_CODE_MINIMUM_DURATION_HOURS,
              maximum:
                ADMINISTRATION_STANDALONE_ACCESS_CODE_MAXIMUM_DURATION_HOURS,
            },
            { locale }
          ),
        }
    )
  );

type StandaloneAccessCodeFormSchema = ReturnType<
  typeof createStandaloneAccessCodeFormSchema
>;

export type CreateStandaloneAccessCodeFormInput =
  StandaloneAccessCodeFormSchema["Encoded"];

export type CreateStandaloneAccessCodeFormValues =
  StandaloneAccessCodeFormSchema["Type"];

export const createStandaloneAccessCodeFormDefaults = {
  name: "",
  startsAt: "",
  endsAt: "",
} satisfies CreateStandaloneAccessCodeFormInput;

/** Formats a whole-hour site-local date-time of an access window. */
export const formatStandaloneAccessCodeLocalDateTime = (
  value: string,
  locale: Locale
) =>
  formatAdministrationDateTime(
    localDateTimeToTemporalInstantString({
      dateTime: value,
      timeZone: WORKSPACE_SITE_TIME_ZONE,
    }),
    locale
  );

export const formatStandaloneAccessCodeDuration = (
  hours: number,
  locale: Locale
) => formatDuration([{ value: hours, unit: "hour" }], locale);

const standaloneAccessCodeFailureNotices = {
  rejected: m.accessCodesFailureRejected,
  "in-progress": m.accessCodesFailureInProgress,
  unavailable: m.accessCodesFailureUnavailable,
  reconciled: m.accessCodesFailureReconciled,
} satisfies Record<
  Exclude<
    StandaloneAccessCodeCreationOutcome,
    "ambiguous" | "cleanup-required"
  >,
  typeof m.accessCodesFailureRejected
>;

/** The operator notice for a creation failure that needs no lock cleanup. */
export const standaloneAccessCodeFailureNotice = (
  outcome: keyof typeof standaloneAccessCodeFailureNotices,
  locale: Locale
) => standaloneAccessCodeFailureNotices[outcome]({}, { locale });

export const isSameStandaloneAccessCodeWindow = (
  left: StandaloneAccessCodeWindowValues,
  right: StandaloneAccessCodeWindowValues
) =>
  left.name === right.name &&
  left.startsAt === right.startsAt &&
  left.endsAt === right.endsAt;
