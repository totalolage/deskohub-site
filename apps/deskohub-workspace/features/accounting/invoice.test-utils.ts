import {
  DotyposCategoryIdSchema,
  DotyposCloudIdSchema,
  DotyposCustomerIdSchema,
  DotyposCustomerSchema,
  DotyposProductIdSchema,
  DotyposReservationIdSchema,
} from "@deskohub/dotypos";
import { Effect, Schema } from "effect";
import type { PreparedCustomerQuote } from "@/features/checkout/backend/checkout/checkout-pricing.service";
import {
  buildCoworkReservationQuote,
  type CoworkReservationQuoteOrder,
} from "@/features/checkout/checkout-quote.test-utils";
import { getReservationQuoteFingerprint } from "@/features/checkout/reservation-quote-fingerprint";
import { getMeetingRoomReservationQuote } from "@/features/checkout/reservation-quote-meeting-room";
import { buildOfficeReservationQuote } from "@/features/checkout/reservation-quote-office";
import { discountIdSchema } from "@/features/discounts/contracts";
import type { Locale } from "@/features/i18n";
import { orderIdSchema } from "@/features/order";
import { normalizedMeetingRoomReservationOrderSchema } from "@/features/reservation/meeting-room-reservation";
import { normalizedOfficeReservationOrderSchema } from "@/features/reservation/office-reservation";
import { workspaceReservationIdSchema } from "@/features/reservation/persistence-contracts";
import {
  instantStringSchema,
  plainDateStringSchema,
} from "@/shared/utils/temporal";
import {
  companyRegistrationIdSchema,
  makeGoodsAccountingDocumentSnapshot,
  makeReservationAccountingDocumentSnapshot,
  vatRegistrationIdSchema,
} from "./accounting-document-snapshot";
import {
  formatInvoiceNumber,
  type InvoiceBuyer,
  type InvoiceDocument,
  invoiceBuyerSchema,
  makeInvoiceDocument,
} from "./invoice";

const issuedAt = Temporal.Instant.from("2026-08-12T12:34:56.789Z");
const paidAt = Temporal.Instant.from("2026-08-10T12:30:00Z");
const fulfilledAt = Temporal.Instant.from("2026-08-11T08:00:00Z");

const businessBuyer = {
  kind: "business" as const,
  legalName: "Žluťoučký kůň s.r.o.",
  companyId: companyRegistrationIdSchema.make("12345678"),
  vatId: vatRegistrationIdSchema.make("CZ12345678"),
  address: {
    line1: "Příčná 12",
    line2: "Dům číslo 3",
    city: "Praha",
    postalCode: "110 00",
    country: "CZ",
  },
} satisfies InvoiceBuyer;

const personalAddress = {
  line1: "Synthetic 1",
  city: "Praha",
  postalCode: "100 00",
  country: "CZ",
};

export const makeCoworkInvoiceDocument = (
  locale: Locale,
  options: { readonly businessBuyer?: boolean } = {}
): InvoiceDocument => {
  const order = {
    entryTier: "basic",
    coffee: true,
  } satisfies CoworkReservationQuoteOrder;
  const prepared = {
    kind: "cowork",
    reservation: {
      kind: "cowork",
      ...order,
      date: "2099-01-01",
      name: "Ada Lovelace",
      email: "synthetic@example.test",
      phone: "+420 700 000 000",
      billing: options.businessBuyer
        ? { purpose: "business", invoice: "required", buyer: businessBuyer }
        : {
            purpose: "personal",
            invoice: "requested",
            address: personalAddress,
          },
    },
    quote: buildCoworkReservationQuote(order),
  } as PreparedCustomerQuote;

  return issueTestInvoice({
    locale,
    prepared,
    sequence: 1,
    buyer: options.businessBuyer ? businessBuyer : undefined,
  });
};

export const makeMeetingRoomInvoiceDocument = (
  locale: Locale
): InvoiceDocument => {
  const reservation = normalizedMeetingRoomReservationOrderSchema.make({
    kind: "meeting-room",
    duration: { unit: "hour", amount: 4 },
    reservationDate: plainDateStringSchema.make("2099-02-03"),
    startsAt: instantStringSchema.make("2099-02-03T08:00:00Z"),
    endsAt: instantStringSchema.make("2099-02-03T12:00:00Z"),
    name: "Grace Hopper",
    email: "synthetic@example.test",
    phone: "+420 700 000 000",
    billing: {
      purpose: "personal",
      invoice: "requested",
      address: personalAddress,
    },
  });
  const quoteWithoutFingerprint = Effect.runSync(
    getMeetingRoomReservationQuote(reservation)
  );
  const prepared: PreparedCustomerQuote = {
    kind: "meeting-room",
    reservation,
    quote: {
      ...quoteWithoutFingerprint,
      fingerprint: getReservationQuoteFingerprint(
        reservation,
        quoteWithoutFingerprint
      ),
    },
  };

  return issueTestInvoice({ locale, prepared, sequence: 2 });
};

export const makeOfficeInvoiceDocument = (locale: Locale): InvoiceDocument => {
  const reservation = normalizedOfficeReservationOrderSchema.make({
    kind: "office",
    startsOn: plainDateStringSchema.make("2099-06-20"),
    endsOn: plainDateStringSchema.make("2099-06-21"),
    seats: 3,
    name: "Katherine Johnson",
    email: "synthetic@example.test",
    phone: "+420 700 000 000",
    billing: {
      purpose: "personal",
      invoice: "requested",
      address: personalAddress,
    },
  });
  const prepared: PreparedCustomerQuote = {
    kind: "office",
    reservation,
    quote: Effect.runSync(buildOfficeReservationQuote(reservation)),
  };

  return issueTestInvoice({ locale, prepared, sequence: 3 });
};

export const makeGoodsAccountingDocumentSnapshotInputForTest = () => {
  const dotyposCustomerId = DotyposCustomerIdSchema.make("goods-customer-1");
  const firstProduct = {
    kind: "goods" as const,
    categoryId: DotyposCategoryIdSchema.make("drinks"),
    productId: DotyposProductIdSchema.make("water"),
  };
  const secondProduct = {
    kind: "goods" as const,
    categoryId: DotyposCategoryIdSchema.make("food"),
    productId: DotyposProductIdSchema.make("sandwich"),
  };
  const money = (value: number) => ({ value, exponent: 2, currency: "CZK" });
  const discount = {
    discount: {
      id: Schema.decodeUnknownSync(discountIdSchema)("member-price"),
      label: "Member price",
      adjustment: { kind: "percentage" as const, basisPoints: 2500 },
    },
    subtotalBefore: money(10_000),
    amount: money(2500),
    subtotalAfter: money(7500),
  };
  const orderId = orderIdSchema.make("goods-order-1");
  return {
    order: {
      id: orderId,
      kind: "goods" as const,
      dotyposCustomerId,
      fulfillmentState: "fulfilled" as const,
      fulfilledAt: Temporal.Instant.from("2026-08-11T23:30:00Z"),
    },
    lines: [
      {
        orderId,
        sequence: 0,
        productIdentity: firstProduct,
        description: "Sparkling water",
        quantity: 2,
        undiscountedTotalValue: 10_000,
        payableTotalValue: 7500,
        amountExponent: 2,
        currency: "CZK",
      },
      {
        orderId,
        sequence: 1,
        productIdentity: secondProduct,
        description: "Sandwich",
        quantity: 1,
        undiscountedTotalValue: 5000,
        payableTotalValue: 5000,
        amountExponent: 2,
        currency: "CZK",
      },
    ],
    displayedQuote: {
      lines: [
        {
          product: firstProduct,
          discountableSubtotal: money(10_000),
          discounts: [discount],
          totalDiscount: money(2500),
          discountedSubtotal: money(7500),
        },
        {
          product: secondProduct,
          discountableSubtotal: money(5000),
          discounts: [],
          totalDiscount: money(0),
          discountedSubtotal: money(5000),
        },
      ],
      discountIds: [discount.discount.id],
      discountableSubtotal: money(15_000),
      totalDiscount: money(2500),
      discountedSubtotal: money(12_500),
    },
    customer: DotyposCustomerSchema.make({
      id: dotyposCustomerId,
      _cloudId: DotyposCloudIdSchema.make("cloud-1"),
      firstName: "Synthetic",
      lastName: "Customer",
      email: "goods-invoice@example.test",
      phone: "+420 700 000 000",
      addressLine1: "Synthetic 1",
      city: "Praha",
      zip: "100 00",
      country: "CZ",
      points: null,
      flags: "0",
      display: true,
      deleted: false,
    }),
    locale: "en-US" as const,
    billing: { purpose: "personal", invoice: "requested" } as const,
  };
};

export const makeGoodsAccountingDocumentSnapshotForTest = () =>
  Effect.runSync(
    makeGoodsAccountingDocumentSnapshot(
      makeGoodsAccountingDocumentSnapshotInputForTest()
    )
  );

export const makeGoodsInvoiceDocument = () => {
  const source = makeGoodsAccountingDocumentSnapshotForTest();
  const document = makeInvoiceDocument({
    source,
    buyer: Schema.decodeUnknownSync(invoiceBuyerSchema)(source.buyer),
    paymentAttemptId: "goods-payment-attempt-1",
    invoiceNumber: formatInvoiceNumber({ year: 2026, sequence: 4 }),
    issuedAt,
    fulfilledAt: Temporal.Instant.from("2099-01-01T00:00:00Z"),
    paidAt,
  });
  if (!("orderId" in document)) throw new Error("Expected a goods invoice.");
  return document;
};

const issueTestInvoice = (input: {
  readonly locale: Locale;
  readonly prepared: PreparedCustomerQuote;
  readonly sequence: number;
  readonly buyer?: InvoiceBuyer;
}): InvoiceDocument => {
  const source = makeReservationAccountingDocumentSnapshot({
    workspaceReservationId: workspaceReservationIdSchema.make(
      `reservation-${input.sequence}`
    ),
    dotyposReservationId: DotyposReservationIdSchema.make(
      `dotypos-reservation-${input.sequence}`
    ),
    dotyposCustomerId: DotyposCustomerIdSchema.make(
      `dotypos-customer-${input.sequence}`
    ),
    locale: input.locale,
    prepared: input.prepared,
  });
  const buyer =
    input.buyer ??
    ({
      kind: "person",
      legalName: input.prepared.reservation.name,
      address: personalAddress,
    } satisfies InvoiceBuyer);

  return makeInvoiceDocument({
    source,
    buyer,
    paymentAttemptId: `payment-attempt-${input.sequence}`,
    invoiceNumber: formatInvoiceNumber({
      year: 2026,
      sequence: input.sequence,
    }),
    issuedAt,
    fulfilledAt,
    paidAt,
  });
};
