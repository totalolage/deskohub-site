import { Schema } from "effect";
import {
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiSchema,
} from "effect/unstable/httpapi";
import { CustomerAccountLinkRequired, Money } from "./customer-account-api";
import { CustomerServiceUnavailable } from "./customer-session";
import { responseHeaders } from "./openapi-response-headers";

// Errors

/**
 * No order with this ID that the signed-in account may see: it doesn't
 * exist, or it belongs to someone else.
 */
export class CustomerReservationNotFound extends Schema.TaggedErrorClass<CustomerReservationNotFound>()(
  "CustomerReservationNotFound",
  {}
) {
  static schema = this.pipe(HttpApiSchema.status("NotFound"));
}

/**
 * The order has no door code to show: it isn't paid and confirmed yet, or
 * it has ended. Asking again later can succeed only once its status changes.
 */
export class CustomerAccessCodeUnavailable extends Schema.TaggedErrorClass<CustomerAccessCodeUnavailable>()(
  "CustomerAccessCodeUnavailable",
  {}
) {
  static schema = this.pipe(HttpApiSchema.status("Conflict"));
}

/**
 * The order has no issued invoice: it isn't paid and confirmed yet, or it
 * needs none. Asking again can succeed only once its status changes.
 */
export class CustomerInvoiceNotIssued extends Schema.TaggedErrorClass<CustomerInvoiceNotIssued>()(
  "CustomerInvoiceNotIssued",
  {}
) {
  static schema = this.pipe(HttpApiSchema.status("Conflict"));
}

// Reservations

const isoInstant = Schema.String.annotate({
  description: "ISO 8601 instant.",
});

/** An order the website booked: the ID its status and door code go by. */
export const CustomerReservationOrderId = Schema.NonEmptyString.pipe(
  Schema.brand("WorkspaceReservationId")
).annotate({
  identifier: "CustomerReservationOrderId",
  description: "Opaque identifier of an order booked on the website.",
});
export type CustomerReservationOrderId = typeof CustomerReservationOrderId.Type;

/** The kinds of space an order books. */
export const CustomerReservationKind = Schema.Literals([
  "cowork",
  "meeting-room",
  "office",
]).annotate({ identifier: "CustomerReservationKind" });
export type CustomerReservationKind = typeof CustomerReservationKind.Type;

/** The cowork tiers a reservation can have, current and historical. */
export const CustomerCoworkTier = Schema.Literals([
  "basic",
  "plus",
  "profi",
  "open-space",
  "reserved-desk",
]).annotate({ identifier: "CustomerCoworkTier" });
export type CustomerCoworkTier = typeof CustomerCoworkTier.Type;

/** What a reservation in the history books; `other` for any other product. */
export const CustomerReservationProduct = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("cowork"), tier: CustomerCoworkTier }),
  Schema.Struct({ kind: Schema.Literal("meeting-room") }),
  Schema.Struct({ kind: Schema.Literal("office") }),
  Schema.Struct({ kind: Schema.Literal("other") }),
]).annotate({ identifier: "CustomerReservationProduct" });
export type CustomerReservationProduct = typeof CustomerReservationProduct.Type;

/**
 * The other party of a reservation in the history: the customer the account
 * booked it for, or the account that booked it for the account's own
 * customer. A name that couldn't be read is null; a deleted author is never
 * named.
 */
export const CustomerReservationParty = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("booked-for"),
    customerName: Schema.NullOr(Schema.String),
  }),
  Schema.Struct({
    kind: Schema.Literal("booked-by"),
    authorName: Schema.NullOr(Schema.String),
  }),
  Schema.Struct({ kind: Schema.Literal("booked-by-deleted-account") }),
]).annotate({ identifier: "CustomerReservationParty" });
export type CustomerReservationParty = typeof CustomerReservationParty.Type;

export const CustomerReservationStatus = Schema.Literals([
  "cancelled",
  "confirmed",
  "pending",
  "requires-attention",
]).annotate({ identifier: "CustomerReservationStatus" });
export type CustomerReservationStatus = typeof CustomerReservationStatus.Type;

/** A reservation as the account page's history lists it. */
export const CustomerReservationSummary = Schema.Struct({
  /** Unique within the history; only for telling entries apart. */
  id: Schema.String,
  /** Absent for a reservation not booked on the website. */
  orderId: Schema.optional(CustomerReservationOrderId),
  /**
   * Marks a review account's sample or simulated hold: it has a status but
   * never a door code.
   */
  reviewSandbox: Schema.optional(Schema.Literal(true)),
  /** Absent when the account's own customer booked it for itself. */
  party: Schema.optional(CustomerReservationParty),
  product: CustomerReservationProduct,
  /** Null when the provider's time can't be read. */
  startsAt: Schema.NullOr(isoInstant),
  endsAt: Schema.NullOr(isoInstant),
  /**
   * When the customer of a meeting room booked with early setup may arrive,
   * before `startsAt`.
   */
  setupStartsAt: Schema.optional(isoInstant),
  /** Null when the provider's seat count can't be read. */
  seats: Schema.NullOr(Schema.Int),
  status: CustomerReservationStatus,
}).annotate({ identifier: "CustomerReservationSummary" });
export type CustomerReservationSummary = typeof CustomerReservationSummary.Type;

/**
 * The signed-in account's reservations, grouped as the account page groups
 * them: current until their end, past once ended or cancelled, and
 * `unavailable` when their time can't be read.
 */
export const CustomerReservationHistory = Schema.Struct({
  current: Schema.Array(CustomerReservationSummary),
  past: Schema.Array(CustomerReservationSummary),
  unavailable: Schema.Array(CustomerReservationSummary),
}).annotate({ identifier: "CustomerReservationHistory" });
export type CustomerReservationHistory = typeof CustomerReservationHistory.Type;

/**
 * Where an order is between checkout and the booked reservation. `created`:
 * held, not paid yet; `pending`: payment in progress; `paid_*`: paid and
 * being confirmed; `fulfilled`: confirmed; `payment_failed`, `cancelled`,
 * `expired`: not booked; `late_payment_*`: a payment after the hold expired
 * is being checked or refunded. `*_delayed` asks the customer to wait longer
 * than usual.
 */
export const CustomerOrderStatus = Schema.Literals([
  "created",
  "pending",
  "payment_pending_delayed",
  "paid_waiting_fulfillment",
  "paid_fulfillment_delayed",
  "paid_awaiting_delivery",
  "paid_delivery_delayed",
  "fulfilled",
  "fulfillment_failed",
  "payment_failed",
  "cancelled",
  "expired",
  "late_payment_checking",
  "late_payment_refund",
  "late_payment_review",
]).annotate({ identifier: "CustomerOrderStatus" });
export type CustomerOrderStatus = typeof CustomerOrderStatus.Type;

export const CustomerOrderPaymentStatus = Schema.Literals([
  "not_started",
  "pending",
  "paid",
  "failed",
  "cancelled",
  "expired",
]).annotate({ identifier: "CustomerOrderPaymentStatus" });
export type CustomerOrderPaymentStatus = typeof CustomerOrderPaymentStatus.Type;

export const CustomerOrderFulfillmentStatus = Schema.Literals([
  "not_started",
  "processing",
  "awaiting_delivery",
  "fulfilled",
  "failed",
]).annotate({ identifier: "CustomerOrderFulfillmentStatus" });
export type CustomerOrderFulfillmentStatus =
  typeof CustomerOrderFulfillmentStatus.Type;

/**
 * An order's status as its status page shows it, after the page's refresh
 * with the payment provider. The time and total are absent while the order
 * doesn't have them.
 */
export const CustomerOrderState = Schema.Struct({
  orderId: CustomerReservationOrderId,
  kind: CustomerReservationKind,
  status: CustomerOrderStatus,
  paymentStatus: CustomerOrderPaymentStatus,
  fulfillmentStatus: CustomerOrderFulfillmentStatus,
  /** Marks a review account's sample or simulated hold. */
  reviewSandbox: Schema.optional(Schema.Literal(true)),
  startsAt: Schema.optional(isoInstant),
  endsAt: Schema.optional(isoInstant),
  /**
   * When the customer of a meeting room booked with early setup may arrive,
   * before `startsAt`.
   */
  setupStartsAt: Schema.optional(isoInstant),
  total: Schema.optional(Money),
}).annotate({ identifier: "CustomerOrderState" });
export type CustomerOrderState = typeof CustomerOrderState.Type;

/**
 * The door code of a paid, confirmed order, and when the lock accepts it.
 */
export const CustomerReservationAccess = Schema.Struct({
  code: Schema.NonEmptyString,
  accessStartsAt: isoInstant,
  accessEndsAt: isoInstant,
}).annotate({ identifier: "CustomerReservationAccess" });
export type CustomerReservationAccess = typeof CustomerReservationAccess.Type;

/**
 * An order's issued invoice as a PDF document, served as an attachment
 * named by the invoice number.
 */
export const CustomerInvoicePdf = Schema.Uint8Array.pipe(
  HttpApiSchema.asUint8Array({ contentType: "application/pdf" })
).annotate({
  identifier: "CustomerInvoicePdf",
  description: "The issued invoice as a PDF document.",
});

// Endpoints

const OrderParams = { orderId: CustomerReservationOrderId } as const;

/**
 * The signed-in customer's reservations: the history, and the status, door
 * code and invoice of an order the account booked or whose customer it is.
 * The status and door code reads refresh the order, as the website's pages
 * do, and the door code and invoice only the order's customer sees.
 */
export const CustomerReservationsApi = HttpApiGroup.make("reservations")
  .add(
    HttpApiEndpoint.get("listReservations", "/", {
      success: CustomerReservationHistory,
      error: [
        CustomerAccountLinkRequired.schema,
        CustomerServiceUnavailable.schema,
      ],
    })
  )
  .add(
    HttpApiEndpoint.get("getReservationStatus", "/:orderId/status", {
      params: OrderParams,
      success: CustomerOrderState,
      error: [
        CustomerReservationNotFound.schema,
        CustomerServiceUnavailable.schema,
      ],
    })
  )
  .add(
    HttpApiEndpoint.get("getReservationAccess", "/:orderId/access", {
      params: OrderParams,
      success: CustomerReservationAccess,
      error: [
        CustomerReservationNotFound.schema,
        CustomerAccessCodeUnavailable.schema,
        CustomerServiceUnavailable.schema,
      ],
    })
  )
  .add(
    HttpApiEndpoint.get("getReservationInvoice", "/:orderId/invoice", {
      params: OrderParams,
      success: CustomerInvoicePdf,
      error: [
        CustomerReservationNotFound.schema,
        CustomerInvoiceNotIssued.schema,
        CustomerServiceUnavailable.schema,
      ],
    }).annotateMerge(
      responseHeaders(200, {
        "Content-Disposition": {
          description:
            'Serves the PDF as an attachment named by the invoice number, as `attachment; filename="<invoice number>.pdf"`.',
        },
      })
    )
  )
  .prefix("/reservations");
