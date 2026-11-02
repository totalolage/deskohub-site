import { m } from "@/features/i18n";

export interface ContactFormFailure {
  /** The error reported to analytics. */
  trackedError: string;
  /** The message shown to the visitor. */
  message: string;
}

/**
 * Describes a failed contact form submission. The server's error wins; without
 * one, analytics records an unknown error and the visitor sees the generic
 * submission error.
 */
export function describeContactFormFailure(
  serverError: string | undefined
): ContactFormFailure {
  return {
    trackedError: serverError || "Unknown error",
    message: serverError || m["errors.submissionError"](),
  };
}
