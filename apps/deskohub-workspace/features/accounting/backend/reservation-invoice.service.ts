import { DotyposService } from "@deskohub/dotypos";
import { Effect, Layer, Result } from "effect";
import { openReservationAccessToken } from "@/features/reservation/backend/reservation-access-token";
import { WorkspaceReservationRepository } from "@/features/reservation/backend/workspace-reservation.repository";
import {
  getDotyposCustomerBillingDetails,
  getReservationInvoiceBuyer,
} from "@/features/reservation/reservation-billing";
import { AccountingDocumentSnapshotRepository } from "./accounting-document-snapshot.repository";
import { InvoiceRepository } from "./invoice.repository";
import { InvoiceEmailDeliveryService } from "./invoice-email-delivery.service";
import {
  type PostOrderInvoiceAccess,
  PostOrderInvoiceUnavailableError,
  ReservationInvoiceService,
} from "./reservation-invoice";

export const ReservationInvoiceServiceLive = Layer.effect(
  ReservationInvoiceService,
  Effect.gen(function* () {
    const accountingSnapshots = yield* AccountingDocumentSnapshotRepository;
    const dotypos = yield* DotyposService;
    const invoiceDeliveries = yield* InvoiceEmailDeliveryService;
    const invoices = yield* InvoiceRepository;
    const reservations = yield* WorkspaceReservationRepository;

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
      if (
        !reservation ||
        reservation.locale !== input.locale ||
        reservation.paymentState !== "paid" ||
        reservation.reservationState !== "confirmed" ||
        reservation.fulfillmentState !== "fulfilled" ||
        !reservation.fulfilledAt ||
        !reservation.activePaymentAttemptId
      ) {
        return { state: "unavailable" as const };
      }

      const paymentAttemptId = reservation.activePaymentAttemptId;
      const source =
        yield* accountingSnapshots.findByPaymentAttemptId(paymentAttemptId);
      if (
        !source?.delivery ||
        source.workspaceReservationId !== reservation.id ||
        source.dotyposCustomerId !== reservation.dotyposCustomerId
      ) {
        return { state: "unavailable" as const };
      }

      const invoice = yield* invoices.findByPaymentAttemptId(paymentAttemptId);
      if (invoice) {
        return { state: "issued" as const, paymentAttemptId };
      }
      if (
        reservation.reservationPurpose !== "personal" ||
        source.billing?.purpose !== "personal" ||
        source.billing.invoice !== "none" ||
        source.buyer.kind !== "person"
      ) {
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

        const billingDetails = getDotyposCustomerBillingDetails(source.billing);
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
        });
        const delivered = yield* invoiceDeliveries
          .deliverByPaymentAttemptId({
            paymentAttemptId: context.paymentAttemptId,
          })
          .pipe(
            Effect.as(true),
            Effect.catchTag("InvoiceEmailDeliveryError", () =>
              Effect.succeed(false)
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
