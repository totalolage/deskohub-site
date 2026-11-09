// seam: replaced at integration — this whole module stands in for the
// per-message batch results and message fields that "@deskohub/email" (S1)
// and the recipients' `failure_code` column (S4) bring. At integration:
// import `EmailBatchResult` and `EmailSendFailure` from "@deskohub/email",
// replace `CampaignEmailMessage` with `EmailMessage`, drop
// `emailBatchResults` (the service already returns them), pass
// `batchRequestOptions`' argument as the `EmailBatchOptions` it is, make
// `recipientFailureCode` return `{ failureCode: code ?? null }`, and delete
// this file.
import {
  type EmailBatchOptions,
  type EmailMessage,
  type EmailSendError,
  type EmailSendResult,
  EmailServiceError,
  NetworkError,
} from "@deskohub/email";

/** An email no provider in its chain accepted, with the last one's error. */
export interface EmailSendFailure {
  readonly status: "failed";
  readonly provider: string;
  readonly timestamp: Date;
  readonly error: EmailSendError & { readonly code?: string };
}

/** One email's result within an answered batch, in the batch's order. */
export type EmailBatchResult =
  | (EmailSendResult & { readonly status: "sent" | "queued" })
  | EmailSendFailure;

/** An email that may name the PostHog person its engagement is about. */
export type CampaignEmailMessage = EmailMessage & {
  readonly recipientIdentity?: string;
};

/**
 * Reads the service's results as per-message results. A failed result
 * that already carries a typed error keeps it.
 */
export const emailBatchResults = (
  results: readonly EmailSendResult[]
): readonly EmailBatchResult[] =>
  results.map((result): EmailBatchResult => {
    if (result.status !== "failed") return { ...result, status: result.status };
    const answered: { readonly error?: unknown } = result;
    return {
      status: "failed",
      provider: result.provider,
      timestamp: result.timestamp,
      error:
        answered.error instanceof EmailServiceError ||
        answered.error instanceof NetworkError
          ? answered.error
          : new EmailServiceError(
              result.error ?? "Email refused",
              undefined,
              result.provider
            ),
    };
  });

/**
 * A batch request's options. `replay` marks a repeat of a request whose
 * outcome is unknown: each email stays with the first provider of its
 * chain, which may have taken the earlier request.
 */
export const batchRequestOptions = (
  options: EmailBatchOptions & { readonly replay?: boolean }
): EmailBatchOptions => options;

/** The recipient columns that record why its email failed, if it did. */
export const recipientFailureCode = (_code: string | undefined) => ({});
