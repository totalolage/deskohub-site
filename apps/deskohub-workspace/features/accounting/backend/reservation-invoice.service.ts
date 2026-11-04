import {
  type DotyposConditionalWriteFailure,
  type DotyposCustomerId,
  DotyposService,
} from "@deskohub/dotypos";
import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import { Context, Data, Effect, Layer, Result } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import type { AccountingDocumentSnapshot } from "@/features/accounting/accounting-document-snapshot";
import type { InvoiceBuyerAddress } from "@/features/accounting/billing-identity";
import type { InvoiceBuyer } from "@/features/accounting/invoice";
import type { PaymentAttemptId } from "@/features/checkout/checkout-identifiers";
import type { Locale } from "@/features/i18n";
import { openReservationAccessToken } from "@/features/reservation/backend/reservation-access-token";
import type { WorkspaceReservationDetailsMalformedError } from "@/features/reservation/backend/stored-reservation-details.server";
import {
  type WorkspaceReservation,
  WorkspaceReservationRepository,
} from "@/features/reservation/backend/workspace-reservation.repository";
import type { WorkspaceReservationId } from "@/features/reservation/persistence-contracts";
import type { ReservationAccessToken } from "@/features/reservation/reservation-access-token";
import {
  getDotyposCustomerBillingDetails,
  getReservationInvoiceBuyer,
} from "@/features/reservation/reservation-billing";
import { WorkspaceDotyposLayer } from "@/shared/backend/config/dotypos.config";
import {
  AccountingDocumentSnapshotRepository,
  type AccountingDocumentSnapshotStorageError,
} from "./accounting-document-snapshot.repository";
import { AccountingSnapshotKeyService } from "./accounting-snapshot-key.service";
import {
  InvoiceRepository,
  type InvoiceRepositoryError,
} from "./invoice.repository";
import { isFulfilledReservation } from "./invoice-eligibility";
import {
  type InvoiceEmailDeliveryError,
  InvoiceEmailDeliveryService,
} from "./invoice-email-delivery.service";

type ReservationInvoiceProcessingError =
  | AccountingDocumentSnapshotStorageError
  | EffectDrizzleQueryError
  | DotyposConditionalWriteFailure
  | InvoiceEmailDeliveryError
  | InvoiceRepositoryError
  | WorkspaceReservationDetailsMalformedError;

class PostOrderInvoiceUnavailableError extends Data.TaggedError(
  "PostOrderInvoiceUnavailableError"
)<{ readonly message: string }> {}

export type PostOrderInvoiceState = "create" | "issued" | "unavailable";

interface PostOrderInvoiceAccess {
  readonly orderId: WorkspaceReservationId;
  readonly locale: Locale;
  readonly accessToken?: ReservationAccessToken;
}

export interface IReservationInvoiceService {
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

export class ReservationInvoiceService extends Context.Service<
  ReservationInvoiceService,
  IReservationInvoiceService
>()("ReservationInvoiceService") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const accountingSnapshots = yield* AccountingDocumentSnapshotRepository;
      const dotypos = yield* DotyposService;
      const invoiceDeliveries = yield* InvoiceEmailDeliveryService;
      const invoices = yield* InvoiceRepository;
      const reservations = yield* WorkspaceReservationRepository;

      /**
       * A concurrent request may have issued the invoice first: Dotypos must
       * hold the buyer the issued invoice committed, not this request's.
       */
      const syncCommittedInvoiceBuyer = Effect.fnUntraced(function* (input: {
        readonly dotyposCustomerId: DotyposCustomerId;
        readonly buyer: InvoiceBuyer;
      }) {
        if (input.buyer.kind !== "person") {
          return yield* new PostOrderInvoiceUnavailableError({
            message: "The issued invoice buyer does not match the reservation.",
          });
        }
        const committedBillingDetails = getDotyposCustomerBillingDetails({
          purpose: "personal",
          invoice: "requested",
          address: input.buyer.address,
        });
        if (!committedBillingDetails) {
          return yield* new PostOrderInvoiceUnavailableError({
            message: "The issued invoice billing details are unavailable.",
          });
        }
        yield* dotypos.updateCustomerBillingDetails(
          input.dotyposCustomerId,
          committedBillingDetails
        );
      });

      const getPostOrderContext = Effect.fn(
        "ReservationInvoiceService.getPostOrderContext"
      )(function* (input: PostOrderInvoiceAccess) {
        if (!input.accessToken) return { state: "unavailable" as const };
        const authorized = yield* openReservationAccessToken({
          token: input.accessToken,
          orderId: input.orderId,
          locale: input.locale,
        }).pipe(Effect.result);
        if (Result.isFailure(authorized)) {
          return { state: "unavailable" as const };
        }

        const reservation = yield* reservations.findById(input.orderId);
        if (!isPostOrderInvoiceableReservation(reservation, input.locale)) {
          return { state: "unavailable" as const };
        }

        const paymentAttemptId = reservation.activePaymentAttemptId;
        const source =
          yield* accountingSnapshots.findByPaymentAttemptId(paymentAttemptId);
        if (!isDeliverableReservationSnapshot(source, reservation)) {
          return { state: "unavailable" as const };
        }

        const invoice =
          yield* invoices.findByPaymentAttemptId(paymentAttemptId);
        if (invoice) {
          return { state: "issued" as const, paymentAttemptId };
        }
        if (!isUnrequestedPersonalInvoice(reservation, source)) {
          return { state: "unavailable" as const };
        }

        return { state: "create" as const, paymentAttemptId, source };
      });

      return ReservationInvoiceService.of({
        processByPaymentAttemptId: Effect.fn(
          "ReservationInvoiceService.processByPaymentAttemptId"
        )(function* ({ paymentAttemptId }) {
          const source =
            yield* accountingSnapshots.findByPaymentAttemptId(paymentAttemptId);
          if (!source?.billing) return;

          const billingDetails = getDotyposCustomerBillingDetails(
            source.billing
          );
          if (!billingDetails) return;

          const buyer = getReservationInvoiceBuyer({
            billing: source.billing,
            customerName: source.buyer.legalName,
          });
          if (!buyer) return;

          const existing =
            yield* invoices.findByPaymentAttemptId(paymentAttemptId);
          if (!existing) {
            yield* dotypos.updateCustomerBillingDetails(
              source.dotyposCustomerId,
              billingDetails
            );
          }

          yield* invoices.issue({ paymentAttemptId, buyer });
          yield* invoiceDeliveries.deliverByPaymentAttemptId({
            paymentAttemptId,
          });
        }),
        getPostOrderState: Effect.fn(
          "ReservationInvoiceService.getPostOrderState"
        )(function* (input) {
          return (yield* getPostOrderContext(input)).state;
        }),
        createPostOrderInvoice: Effect.fn(
          "ReservationInvoiceService.createPostOrderInvoice"
        )(function* (input) {
          const context = yield* getPostOrderContext(input);
          if (context.state === "issued") {
            return { status: "already-issued", delivered: true } as const;
          }
          if (context.state !== "create") {
            return yield* new PostOrderInvoiceUnavailableError({
              message: "Post-order invoice creation is unavailable.",
            });
          }

          const billing = {
            purpose: "personal" as const,
            invoice: "requested" as const,
            address: input.address,
          };
          const billingDetails = getDotyposCustomerBillingDetails(billing);
          const buyer = getReservationInvoiceBuyer({
            billing,
            customerName: context.source.buyer.legalName,
          });
          if (!billingDetails || !buyer) {
            return yield* new PostOrderInvoiceUnavailableError({
              message: "Complete billing details are required.",
            });
          }

          yield* dotypos.updateCustomerBillingDetails(
            context.source.dotyposCustomerId,
            billingDetails
          );
          const issuance = yield* invoices.issue({
            paymentAttemptId: context.paymentAttemptId,
            buyer,
            provenance: { source: "post-order-link" },
          });
          if (!issuance.changed) {
            yield* syncCommittedInvoiceBuyer({
              dotyposCustomerId: context.source.dotyposCustomerId,
              buyer: issuance.invoice.document.buyer,
            });
          }
          const delivered = yield* invoiceDeliveries
            .deliverByPaymentAttemptId({
              paymentAttemptId: context.paymentAttemptId,
            })
            .pipe(
              Effect.as(true),
              Effect.catchTag("InvoiceEmailDeliveryError", (error) =>
                Effect.succeed(error.customerDelivered === true)
              )
            );
          return {
            status: issuance.changed ? "created" : "already-issued",
            delivered,
          } as const;
        }),
        resendPostOrderInvoice: Effect.fn(
          "ReservationInvoiceService.resendPostOrderInvoice"
        )(function* (input) {
          const context = yield* getPostOrderContext(input);
          if (context.state !== "issued") {
            return yield* new PostOrderInvoiceUnavailableError({
              message: "Post-order invoice resend is unavailable.",
            });
          }
          yield* invoiceDeliveries.resendCustomerByPaymentAttemptId({
            paymentAttemptId: context.paymentAttemptId,
          });
        }),
      });
    })
  );

  static Live = this.Default.pipe(
    Layer.provide(getReservationInvoiceDependencies()),
    Layer.orDie
  );
}

type PostOrderInvoiceableReservation = WorkspaceReservation & {
  readonly fulfilledAt: Temporal.Instant;
  readonly activePaymentAttemptId: PaymentAttemptId;
};

/** A paid, confirmed reservation in the page's locale whose access code was delivered. */
const isPostOrderInvoiceableReservation = (
  reservation: WorkspaceReservation | null,
  locale: Locale
): reservation is PostOrderInvoiceableReservation =>
  reservation !== null &&
  reservation.locale === locale &&
  reservation.paymentState === "paid" &&
  reservation.reservationState === "confirmed" &&
  isFulfilledReservation(reservation) &&
  Boolean(reservation.activePaymentAttemptId);

/** The reservation's own snapshot, with a frozen recipient to deliver to. */
const isDeliverableReservationSnapshot = (
  source: AccountingDocumentSnapshot | null,
  reservation: WorkspaceReservation
): source is AccountingDocumentSnapshot =>
  source !== null &&
  Boolean(source.delivery) &&
  source.workspaceReservationId === reservation.id &&
  source.dotyposCustomerId === reservation.dotyposCustomerId;

/** A personal reservation that asked for no invoice when it was paid. */
const isUnrequestedPersonalInvoice = (
  reservation: WorkspaceReservation,
  source: AccountingDocumentSnapshot
) =>
  reservation.reservationPurpose === "personal" &&
  source.billing?.purpose === "personal" &&
  source.billing.invoice === "none" &&
  source.buyer.kind === "person";

function getReservationInvoiceDependencies() {
  const accountingStorage = Layer.merge(
    WorkspaceDatabase.Default,
    AccountingSnapshotKeyService.Default
  );
  const accountingSnapshots = AccountingDocumentSnapshotRepository.Default.pipe(
    Layer.provide(accountingStorage)
  );
  const invoices = InvoiceRepository.Default.pipe(
    Layer.provide(Layer.merge(accountingStorage, accountingSnapshots))
  );

  return Layer.mergeAll(
    accountingSnapshots,
    WorkspaceDotyposLayer,
    invoices,
    WorkspaceReservationRepository.Live,
    InvoiceEmailDeliveryService.Live
  );
}
