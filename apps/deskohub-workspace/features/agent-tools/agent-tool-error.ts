import { Data, Match } from "effect";
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
