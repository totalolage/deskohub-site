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
  | "rate_limited";

export type AgentToolUnavailableCode =
  | "availability_unavailable"
  | "quote_unavailable"
  | "offerings_unavailable";

type AgentToolErrorDetails =
  | { readonly code: "invalid_input"; readonly field?: string }
  | {
      readonly code: "date_out_of_range";
      readonly earliest: string;
      readonly latest: string;
    }
  | {
      readonly code: Exclude<
        AgentToolErrorCode,
        "invalid_input" | "date_out_of_range"
      >;
    };

const agentToolErrorMessageField = Schema.String.annotate({
  description: "What went wrong, in the requested locale, for the customer.",
});

/**
 * The structured result of a failed call: the error code agents branch on,
 * its details, and the localized message.
 */
export const agentToolErrorResultSchema = Schema.Struct({
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
      code: Schema.Literals([
        "unsupported_family",
        "availability_unavailable",
        "quote_unavailable",
        "offerings_unavailable",
        "rate_limited",
      ]),
      message: agentToolErrorMessageField,
    }),
  ]),
});

export type AgentToolErrorResult = typeof agentToolErrorResultSchema.Type;

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
    })
  );

/** The structured result a failed call answers with, in the caller's locale. */
export const toAgentToolErrorResult = (
  details: AgentToolErrorDetails,
  locale: Locale
): AgentToolErrorResult => ({
  error: { ...details, message: getAgentToolErrorMessage(details, locale) },
});
