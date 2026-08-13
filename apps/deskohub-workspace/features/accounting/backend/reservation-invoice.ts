import type {
  ExternalAPIError,
  NetworkError,
  ValidationError,
} from "@deskohub/dotypos";
import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import { Context, type Effect } from "effect";
import type { PaymentAttemptId } from "@/features/checkout/checkout-identifiers";
import type { AccountingDocumentSnapshotStorageError } from "./accounting-document-snapshot.repository";
import type { InvoiceRepositoryError } from "./invoice.repository";
import type { InvoiceEmailDeliveryError } from "./invoice-email-delivery.service";

export type ReservationInvoiceProcessingError =
  | AccountingDocumentSnapshotStorageError
  | EffectDrizzleQueryError
  | ExternalAPIError
  | InvoiceEmailDeliveryError
  | InvoiceRepositoryError
  | NetworkError
  | ValidationError;

export interface ReservationInvoiceService {
  readonly processByPaymentAttemptId: (input: {
    readonly paymentAttemptId: PaymentAttemptId;
  }) => Effect.Effect<void, ReservationInvoiceProcessingError>;
}

export const ReservationInvoiceService =
  Context.Service<ReservationInvoiceService>("ReservationInvoiceService");
