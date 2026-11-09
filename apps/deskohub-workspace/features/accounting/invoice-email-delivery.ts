export type InvoiceEmailDeliveryAudience = "customer" | "internal";

export type InvoiceEmailDeliveryState = "processing" | "accepted" | "failed";

/** An audience's delivery state, or `missing` before its first claim. */
export type InvoiceDeliveryStatus = "missing" | InvoiceEmailDeliveryState;

export type InvoiceEmailDeliveryFailureCode =
  | "email_send_failed"
  | "pdf_render_failed";
