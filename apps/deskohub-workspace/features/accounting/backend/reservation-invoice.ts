import type {
  ExternalAPIError,
  NetworkError,
  ValidationError,
} from "@deskohub/dotypos";
import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import { Context, Data, type Effect } from "effect";
import type { InvoiceBuyerAddress } from "@/features/accounting/billing-identity";
import type { PaymentAttemptId } from "@/features/checkout/checkout-identifiers";
import type { Locale } from "@/features/i18n";
import type { WorkspaceReservationDetailsMalformedError } from "@/features/reservation/backend/workspace-reservation.repository";
import type { WorkspaceReservationId } from "@/features/reservation/persistence-contracts";
import type { ReservationAccessToken } from "@/features/reservation/reservation-access-token";
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
  | WorkspaceReservationDetailsMalformedError
  | ValidationError;

export class PostOrderInvoiceUnavailableError extends Data.TaggedError(
  "PostOrderInvoiceUnavailableError"
)<{ readonly message: string }> {}

export type PostOrderInvoiceState = "create" | "issued" | "unavailable";

export interface PostOrderInvoiceAccess {
  readonly orderId: WorkspaceReservationId;
  readonly locale: Locale;
  readonly accessToken?: ReservationAccessToken;
}

export interface ReservationInvoiceService {
  readonly processByPaymentAttemptId: (input: {
    readonly paymentAttemptId: PaymentAttemptId;
  }) => Effect.Effect<void, ReservationInvoiceProcessingError>;
  readonly getPostOrderState: (
    input: PostOrderInvoiceAccess
  ) => Effect.Effect<PostOrderInvoiceState, ReservationInvoiceProcessingError>;
  readonly createPostOrderInvoice: (
    input: PostOrderInvoiceAccess & { readonly address: InvoiceBuyerAddress }
  ) => Effect.Effect<
    {
      readonly status: "created" | "already-issued";
      readonly delivered: boolean;
    },
    ReservationInvoiceProcessingError | PostOrderInvoiceUnavailableError
  >;
  readonly resendPostOrderInvoice: (
    input: PostOrderInvoiceAccess
  ) => Effect.Effect<
    void,
    ReservationInvoiceProcessingError | PostOrderInvoiceUnavailableError
  >;
}

export const ReservationInvoiceService =
  Context.Service<ReservationInvoiceService>("ReservationInvoiceService");
