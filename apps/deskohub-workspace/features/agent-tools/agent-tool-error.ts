import { Data, Match, Schema } from "effect";
import { type Locale, m } from "@/features/i18n";

/** The failures an agent tool reports, as stable codes agents can branch on. */
export type AgentToolErrorCode =
  | "invalid_input"
  | "unsupported_family"
  | "date_out_of_range"
  | "availability_unavailable"
  | "quote_unavailable"
  | "offerings_unavailable"
  | "rate_limited"
  | "service_unavailable"
  | "profile_incomplete"
  | "selection_unavailable"
  | "reservation_conflict"
  | "payment_in_progress"
  | "reservation_unavailable"
  | "account_unavailable"
  | "reservation_not_found"
  | "reservations_unavailable"
  | "administration_failed"
  | "administration_unavailable";

export type AgentToolUnavailableCode =
  | "availability_unavailable"
  | "quote_unavailable"
  | "offerings_unavailable"
  | "reservation_unavailable"
  | "reservations_unavailable"
  | "administration_unavailable";

/** A typed administration API error, as the API encodes it. */
const administrationErrorSchema = Schema.StructWithRest(
  Schema.Struct({
    _tag: Schema.String.annotate({
      description: "The administration API error, such as CliMutationRejected.",
    }),
    message: Schema.String,
  }),
  [Schema.Record(Schema.String, Schema.Json)]
);

type AdministrationError = typeof administrationErrorSchema.Type;

/** An administration API error, if the JSON is one. */
export const decodeAdministrationError = Schema.decodeUnknownOption(
  administrationErrorSchema
);

type AgentToolErrorDetails =
  | { readonly code: "invalid_input"; readonly field?: string }
  | {
      readonly code: "administration_failed";
      readonly error: AdministrationError;
    }
  | {
      readonly code: "date_out_of_range";
      readonly earliest: string;
      readonly latest: string;
    }
  | {
      readonly code: Exclude<
        AgentToolErrorCode,
        "invalid_input" | "date_out_of_range" | "administration_failed"
      >;
    };

const agentToolErrorMessageField = Schema.String.annotate({
  description: "What went wrong, in the requested locale, for the customer.",
});

/** The codes, beyond the ones with details, that any tool may fail with. */
const publicErrorCodes = [
  "unsupported_family",
  "availability_unavailable",
  "quote_unavailable",
  "offerings_unavailable",
  "rate_limited",
  "service_unavailable",
] as const;

/** The codes only signed-in tools fail with: account and booking failures. */
const signedInErrorCodes = [
  "profile_incomplete",
  "selection_unavailable",
  "reservation_conflict",
  "payment_in_progress",
  "reservation_unavailable",
  "account_unavailable",
  "reservation_not_found",
  "reservations_unavailable",
] as const;

/**
 * The structured result of a failed call: the error code agents branch on,
 * its details, and the localized message.
 */
const makeAgentToolErrorResultSchema = <
  const Codes extends ReadonlyArray<
    Exclude<AgentToolErrorCode, "invalid_input" | "date_out_of_range">
  >,
>(
  codes: Codes
) =>
  Schema.Struct({
    error: Schema.Union([
      Schema.Struct({
        code: Schema.Literal("invalid_input"),
        field: Schema.optionalKey(
          Schema.String.annotate({
            description: "The dotted path of the first invalid argument.",
          })
        ),
        message: agentToolErrorMessageField,
      }),
      Schema.Struct({
        code: Schema.Literal("date_out_of_range"),
        earliest: Schema.String.annotate({
          description: "The first bookable date, YYYY-MM-DD.",
        }),
        latest: Schema.String.annotate({
          description: "The last bookable date, YYYY-MM-DD.",
        }),
        message: agentToolErrorMessageField,
      }),
      Schema.Struct({
        code: Schema.Literals(codes),
        message: agentToolErrorMessageField,
      }),
    ]),
  });

/** The failed-call result of any tool. */
export const agentToolErrorResultSchema = makeAgentToolErrorResultSchema([
  ...publicErrorCodes,
  ...signedInErrorCodes,
]);

/**
 * The failed-call result a public tool publishes: it never reports account
 * or booking failures, so its schema names none of their codes.
 */
export const publicAgentToolErrorResultSchema =
  makeAgentToolErrorResultSchema(publicErrorCodes);

/**
 * The structured result of a failed administration tool call: any error a
 * customer tool reports, an administration API error the API's message
 * explains, or an unexpected failure.
 */
export const administrationAgentToolErrorResultSchema = Schema.Struct({
  error: Schema.Union([
    ...agentToolErrorResultSchema.fields.error.members,
    Schema.Struct({
      code: Schema.Literal("administration_failed"),
      error: administrationErrorSchema,
      message: Schema.String.annotate({
        description: "The administration API's message for the administrator.",
      }),
    }),
    Schema.Struct({
      code: Schema.Literal("administration_unavailable"),
      message: agentToolErrorMessageField,
    }),
  ]),
});

export type AgentToolErrorResult =
  | typeof agentToolErrorResultSchema.Type
  | typeof administrationAgentToolErrorResultSchema.Type;

export class AgentToolError extends Data.TaggedError("AgentToolError")<{
  readonly details: AgentToolErrorDetails;
  readonly cause?: unknown;
}> {
  static invalidInput = (field?: string) =>
    new AgentToolError({
      details: { code: "invalid_input", ...(field && { field }) },
    });

  static dateOutOfRange = (range: {
    readonly earliest: string;
    readonly latest: string;
  }) =>
    new AgentToolError({ details: { code: "date_out_of_range", ...range } });

  static unsupportedFamily = () =>
    new AgentToolError({ details: { code: "unsupported_family" } });

  static rateLimited = () =>
    new AgentToolError({ details: { code: "rate_limited" } });

  /** Calls can't be admitted, such as while the rate limit can't be checked. */
  static serviceUnavailable = () =>
    new AgentToolError({ details: { code: "service_unavailable" } });

  /** Calls can't be admitted because a safeguard failed with this cause. */
  static unavailableService = (cause: unknown) =>
    new AgentToolError({ details: { code: "service_unavailable" }, cause });

  /**
   * A refusal the customer resolves on the website, such as completing the
   * profile; `cause` keeps the domain error it maps.
   */
  static refused =
    (
      code: Extract<
        AgentToolErrorCode,
        | "profile_incomplete"
        | "selection_unavailable"
        | "reservation_conflict"
        | "payment_in_progress"
        | "account_unavailable"
        | "reservation_not_found"
      >
    ) =>
    (cause?: unknown) =>
      new AgentToolError({ details: { code }, cause });

  /**
   * The administration API refused or failed the operation with a typed
   * error; its message is written for the administrator.
   */
  static administrationFailed = (error: AdministrationError) =>
    new AgentToolError({ details: { code: "administration_failed", error } });

  /** Wraps an unexpected failure as the tool's unavailable code. */
  static unavailable = (code: AgentToolUnavailableCode) => (cause: unknown) =>
    new AgentToolError({ details: { code }, cause });

  get code(): AgentToolErrorCode {
    return this.details.code;
  }
}

/** The customer-safe message for a tool failure in the caller's locale. */
export const getAgentToolErrorMessage = (
  details: AgentToolErrorDetails,
  locale: Locale
) =>
  Match.value(details).pipe(
    Match.discriminatorsExhaustive("code")({
      invalid_input: ({ field }) =>
        field
          ? m.agentToolErrorInvalidField({ field }, { locale })
          : m.agentToolErrorInvalidInput({}, { locale }),
      unsupported_family: () =>
        m.agentToolErrorUnsupportedFamily({}, { locale }),
      date_out_of_range: ({ earliest, latest }) =>
        m.agentToolErrorDateOutOfRange({ earliest, latest }, { locale }),
      availability_unavailable: () =>
        m.agentToolErrorAvailabilityUnavailable({}, { locale }),
      quote_unavailable: () => m.agentToolErrorQuoteUnavailable({}, { locale }),
      offerings_unavailable: () =>
        m.agentToolErrorOfferingsUnavailable({}, { locale }),
      rate_limited: () => m.agentToolErrorRateLimited({}, { locale }),
      service_unavailable: () =>
        m.agentToolErrorServiceUnavailable({}, { locale }),
      profile_incomplete: () =>
        m.agentToolErrorProfileIncomplete({}, { locale }),
      selection_unavailable: () =>
        m.agentToolErrorSelectionUnavailable({}, { locale }),
      reservation_conflict: () =>
        m.agentToolErrorReservationConflict({}, { locale }),
      payment_in_progress: () =>
        m.agentToolErrorPaymentInProgress({}, { locale }),
      reservation_unavailable: () =>
        m.agentToolErrorReservationUnavailable({}, { locale }),
      account_unavailable: () =>
        m.agentToolErrorAccountUnavailable({}, { locale }),
      reservation_not_found: () =>
        m.agentToolErrorReservationNotFound({}, { locale }),
      reservations_unavailable: () =>
        m.agentToolErrorReservationsUnavailable({}, { locale }),
      administration_failed: ({ error }) => error.message,
      administration_unavailable: () =>
        m.agentToolErrorAdministrationUnavailable({}, { locale }),
    })
  );

/** The structured result a failed call answers with, in the caller's locale. */
export const toAgentToolErrorResult = (
  details: AgentToolErrorDetails,
  locale: Locale
): AgentToolErrorResult => ({
  error: { ...details, message: getAgentToolErrorMessage(details, locale) },
});
