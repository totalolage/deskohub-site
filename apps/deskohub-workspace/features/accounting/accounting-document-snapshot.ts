import {
  type DotyposCustomer,
  type DotyposCustomerId,
  DotyposCustomerIdSchema,
  type DotyposReservationId,
  DotyposReservationIdSchema,
} from "@deskohub/dotypos";
import { Data, Effect, Match, Schema } from "effect";
import type { OrderLineRow, OrderRow } from "@/db/schema";
import type { PreparedCustomerQuote } from "@/features/checkout/backend/checkout/checkout-pricing.service";
import { coworkReservationQuoteSchema } from "@/features/checkout/reservation-quote-cowork";
import { meetingRoomReservationQuoteSchema } from "@/features/checkout/reservation-quote-meeting-room";
import { officeReservationQuoteSchema } from "@/features/checkout/reservation-quote-office";
import {
  nonNegativeWorkspaceMoneyCodec,
  type WorkspaceMoney,
  workspaceMoneyEquals,
} from "@/features/checkout/workspace-money";
import type { GoodsDiscountBasketQuote } from "@/features/discounts";
import { appliedDiscountCodec } from "@/features/discounts/contracts";
import { workspaceGoodsProductIdentitySchema } from "@/features/goods";
import type { Locale } from "@/features/i18n";
import { type OrderId, orderIdSchema } from "@/features/order";
import { officeReservationDetailsSchema } from "@/features/reservation/office-reservation";
import {
  type WorkspaceReservationId,
  workspaceReservationIdSchema,
} from "@/features/reservation/persistence-contracts";
import {
  defaultReservationBillingSelection,
  getReservationInvoiceBuyer,
  reservationBillingSelectionSchema,
} from "@/features/reservation/reservation-billing";
import { workspaceSiteConstants } from "@/shared/utils/site-constants";
import {
  instantStringSchema,
  plainDateStringSchema,
  temporalInstantToIsoString,
} from "@/shared/utils/temporal";
import {
  companyRegistrationIdSchema,
  invoiceBuyerSchema,
  vatRegistrationIdSchema,
} from "./billing-identity";

export {
  type CompanyRegistrationId,
  companyRegistrationIdSchema,
  type VatRegistrationId,
  vatRegistrationIdSchema,
} from "./billing-identity";

export const accountingSnapshotKeyIdSchema = Schema.NonEmptyString.check(
  Schema.isPattern(/^[A-Z][A-Z0-9_]{2,31}$/)
)
  .pipe(Schema.brand("AccountingSnapshotKeyId"))
  .annotate({
    identifier: "AccountingSnapshotKeyId",
    description: "Identifier selecting an accounting snapshot encryption key.",
  });

export type AccountingSnapshotKeyId = typeof accountingSnapshotKeyIdSchema.Type;

const accountingBuyerAddressSchema = Schema.Struct({
  line1: Schema.optionalKey(Schema.NonEmptyString),
  line2: Schema.optionalKey(Schema.NonEmptyString),
  city: Schema.optionalKey(Schema.NonEmptyString),
  postalCode: Schema.optionalKey(Schema.NonEmptyString),
  country: Schema.optionalKey(Schema.NonEmptyString),
});

const personalAccountingBuyerSchema = Schema.Struct({
  kind: Schema.Literal("person"),
  legalName: Schema.NonEmptyString,
  address: Schema.optionalKey(accountingBuyerAddressSchema),
});

const businessAccountingBuyerSchema = Schema.Struct({
  kind: Schema.Literal("business"),
  legalName: Schema.NonEmptyString,
  companyId: companyRegistrationIdSchema,
  vatId: Schema.optionalKey(vatRegistrationIdSchema),
  address: Schema.Struct({
    line1: Schema.NonEmptyString,
    line2: Schema.optionalKey(Schema.NonEmptyString),
    city: Schema.NonEmptyString,
    postalCode: Schema.NonEmptyString,
    country: Schema.NonEmptyString,
  }),
});

export const accountingBuyerSchema = Schema.Union([
  personalAccountingBuyerSchema,
  businessAccountingBuyerSchema,
]);

export type AccountingBuyer = typeof accountingBuyerSchema.Type;

const accountingSupplierSchema = Schema.Struct({
  legalName: Schema.NonEmptyString,
  companyId: companyRegistrationIdSchema,
  vatStatus: Schema.Literal("not-vat-payer"),
  address: Schema.Struct({
    street: Schema.NonEmptyString,
    cityDistrict: Schema.NonEmptyString,
    city: Schema.NonEmptyString,
    postalCode: Schema.NonEmptyString,
    country: Schema.NonEmptyString,
  }),
  contactEmail: Schema.NonEmptyString,
});

export const accountingDocumentIdentitySchema = Schema.Struct({
  workspaceReservationId: workspaceReservationIdSchema,
  dotyposReservationId: DotyposReservationIdSchema,
  dotyposCustomerId: DotyposCustomerIdSchema,
  locale: Schema.Literals(["cs-CZ", "en-US"]),
  supplier: accountingSupplierSchema,
  buyer: accountingBuyerSchema,
});

const accountingDocumentCommonIdentitySchema = Schema.Struct({
  dotyposCustomerId: DotyposCustomerIdSchema,
  locale: Schema.Literals(["cs-CZ", "en-US"]),
  supplier: accountingSupplierSchema,
  buyer: accountingBuyerSchema,
});

const accountingDocumentDeliverySchema = Schema.Struct({
  email: Schema.Trim.check(Schema.isNonEmpty()),
});

export const coworkAccountingDocumentSnapshotSchema = Schema.Struct({
  ...accountingDocumentIdentitySchema.fields,
  billing: Schema.optionalKey(reservationBillingSelectionSchema),
  delivery: Schema.optionalKey(accountingDocumentDeliverySchema),
  reservation: Schema.Struct({
    kind: Schema.Literal("cowork"),
    date: plainDateStringSchema,
  }),
  quote: coworkReservationQuoteSchema,
});

export const meetingRoomAccountingDocumentSnapshotSchema = Schema.Struct({
  ...accountingDocumentIdentitySchema.fields,
  billing: Schema.optionalKey(reservationBillingSelectionSchema),
  delivery: Schema.optionalKey(accountingDocumentDeliverySchema),
  reservation: Schema.Struct({
    kind: Schema.Literal("meeting-room"),
    startsAt: instantStringSchema,
    endsAt: instantStringSchema,
  }),
  quote: meetingRoomReservationQuoteSchema,
});

export const officeAccountingDocumentSnapshotSchema = Schema.Struct({
  ...accountingDocumentIdentitySchema.fields,
  billing: Schema.optionalKey(reservationBillingSelectionSchema),
  delivery: Schema.optionalKey(accountingDocumentDeliverySchema),
  reservation: officeReservationDetailsSchema,
  quote: officeReservationQuoteSchema,
});

export const goodsBillingIntentSchema = Schema.Union([
  Schema.Struct({
    purpose: Schema.Literal("personal"),
    invoice: Schema.Literal("none"),
  }),
  Schema.Struct({
    purpose: Schema.Literal("personal"),
    invoice: Schema.Literal("requested"),
  }),
  Schema.Struct({
    purpose: Schema.Literal("business"),
    invoice: Schema.Literal("required"),
  }),
]).annotate({
  identifier: "GoodsBillingIntent",
  description:
    "PII-free invoice instruction for a goods order whose identity comes from Dotypos.",
});

export type GoodsBillingIntent = typeof goodsBillingIntentSchema.Type;

export const goodsAccountingDocumentLineSchema = Schema.Struct({
  product: workspaceGoodsProductIdentitySchema,
  description: Schema.String.check(
    Schema.makeFilter((description) => description.trim().length > 0, {
      message: "Goods line descriptions must contain non-whitespace text.",
    })
  ),
  quantity: Schema.Int.check(Schema.isGreaterThan(0)),
  undiscountedTotal: nonNegativeWorkspaceMoneyCodec,
  discounts: Schema.Array(appliedDiscountCodec),
  payableTotal: nonNegativeWorkspaceMoneyCodec,
}).check(
  Schema.makeFilter(
    (line) =>
      discountsReconcile({
        discounts: line.discounts,
        undiscountedTotal: line.undiscountedTotal,
        totalDiscount: {
          ...line.undiscountedTotal,
          value: line.undiscountedTotal.value - line.payableTotal.value,
        },
        payableTotal: line.payableTotal,
      }),
    { message: "Stored goods line discounts must reconcile exactly." }
  )
);

export const goodsAccountingDocumentSnapshotSchema = Schema.Struct({
  ...accountingDocumentCommonIdentitySchema.fields,
  orderId: orderIdSchema,
  billing: goodsBillingIntentSchema,
  delivery: accountingDocumentDeliverySchema,
  fulfilledAt: instantStringSchema,
  lines: Schema.NonEmptyArray(goodsAccountingDocumentLineSchema),
  totals: Schema.Struct({
    undiscounted: nonNegativeWorkspaceMoneyCodec,
    discount: nonNegativeWorkspaceMoneyCodec,
    payable: nonNegativeWorkspaceMoneyCodec,
  }),
}).check(
  Schema.makeFilter(
    (snapshot) => {
      const totals = getGoodsAccountingTotals(snapshot.lines);
      return (
        totals !== undefined &&
        workspaceMoneyEquals(
          totals.undiscounted,
          snapshot.totals.undiscounted
        ) &&
        workspaceMoneyEquals(totals.discount, snapshot.totals.discount) &&
        workspaceMoneyEquals(totals.payable, snapshot.totals.payable)
      );
    },
    { message: "Stored goods accounting totals must reconcile exactly." }
  )
);

export const accountingDocumentSnapshotSchema = Schema.Union([
  coworkAccountingDocumentSnapshotSchema,
  meetingRoomAccountingDocumentSnapshotSchema,
  officeAccountingDocumentSnapshotSchema,
  goodsAccountingDocumentSnapshotSchema,
]).annotate({
  identifier: "AccountingDocumentSnapshot",
  description:
    "Immutable billing and accepted-price facts used to issue an accounting document.",
});

export type AccountingDocumentSnapshot =
  typeof accountingDocumentSnapshotSchema.Type;
export type ReservationAccountingDocumentSnapshot =
  | typeof coworkAccountingDocumentSnapshotSchema.Type
  | typeof meetingRoomAccountingDocumentSnapshotSchema.Type
  | typeof officeAccountingDocumentSnapshotSchema.Type;
export type GoodsAccountingDocumentSnapshot =
  typeof goodsAccountingDocumentSnapshotSchema.Type;

export const getAccountingDocumentOrderId = (
  snapshot: AccountingDocumentSnapshot
): OrderId =>
  "orderId" in snapshot
    ? snapshot.orderId
    : orderIdSchema.make(snapshot.workspaceReservationId);

export const encodeStoredAccountingDocumentSnapshot = Schema.encodeSync(
  accountingDocumentSnapshotSchema
);

export const decodeStoredAccountingDocumentSnapshot =
  Schema.decodeUnknownEffect(accountingDocumentSnapshotSchema, {
    onExcessProperty: "error",
  });

export const workspaceAccountingSupplier: typeof accountingSupplierSchema.Type =
  {
    legalName: workspaceSiteConstants.brand.legalName,
    companyId: companyRegistrationIdSchema.make(
      workspaceSiteConstants.company.identificationNumber
    ),
    vatStatus: workspaceSiteConstants.company.vatStatus,
    address: {
      ...workspaceSiteConstants.location.address,
      country: "CZ",
    },
    contactEmail: workspaceSiteConstants.contact.infoEmail,
  };

export const makeReservationAccountingDocumentSnapshot = (input: {
  readonly workspaceReservationId: WorkspaceReservationId;
  readonly dotyposReservationId: DotyposReservationId;
  readonly dotyposCustomerId: DotyposCustomerId;
  readonly locale: Locale;
  readonly prepared: PreparedCustomerQuote;
}): ReservationAccountingDocumentSnapshot => {
  const billing =
    input.prepared.reservation.billing ?? defaultReservationBillingSelection;
  const buyer = getReservationInvoiceBuyer({
    billing,
    customerName: input.prepared.reservation.name,
  });
  const identity = {
    workspaceReservationId: input.workspaceReservationId,
    dotyposReservationId: input.dotyposReservationId,
    dotyposCustomerId: input.dotyposCustomerId,
    locale: input.locale,
    supplier: workspaceAccountingSupplier,
    buyer: buyer ?? {
      kind: "person" as const,
      legalName: input.prepared.reservation.name,
    },
    billing,
    delivery: { email: input.prepared.reservation.email },
  };

  return Match.value(input.prepared).pipe(
    Match.discriminatorsExhaustive("kind")({
      cowork: ({ quote, reservation }) => ({
        ...identity,
        reservation: {
          kind: "cowork" as const,
          date: reservation.date,
        },
        quote,
      }),
      "meeting-room": ({ quote, reservation }) => ({
        ...identity,
        reservation: {
          kind: "meeting-room" as const,
          startsAt: reservation.startsAt,
          endsAt: reservation.endsAt,
        },
        quote,
      }),
      office: ({ quote, reservation }) => ({
        ...identity,
        reservation: {
          kind: "office" as const,
          startsOn: reservation.startsOn,
          endsOn: reservation.endsOn,
          seats: reservation.seats,
        },
        quote,
      }),
    })
  );
};

export class GoodsAccountingDocumentSnapshotInputError extends Data.TaggedError(
  "GoodsAccountingDocumentSnapshotInputError"
)<{ readonly message: string }> {}

export const makeGoodsAccountingDocumentSnapshot = Effect.fn(
  "AccountingDocumentSnapshot.makeGoods"
)(function* (input: {
  readonly order: Pick<
    OrderRow,
    "id" | "kind" | "dotyposCustomerId" | "fulfillmentState" | "fulfilledAt"
  >;
  readonly lines: readonly Pick<
    OrderLineRow,
    | "orderId"
    | "sequence"
    | "productIdentity"
    | "description"
    | "quantity"
    | "undiscountedTotalValue"
    | "payableTotalValue"
    | "amountExponent"
    | "currency"
  >[];
  readonly displayedQuote: GoodsDiscountBasketQuote;
  readonly customer: DotyposCustomer;
  readonly locale: Locale;
  readonly billing: GoodsBillingIntent;
}) {
  if (
    input.order.kind !== "goods" ||
    input.order.fulfillmentState !== "fulfilled" ||
    input.order.fulfilledAt === null
  ) {
    return yield* goodsSnapshotInputError(
      "A fulfilled goods order is required for an accounting snapshot."
    );
  }
  if (
    input.customer.id !== input.order.dotyposCustomerId ||
    input.lines.length === 0 ||
    input.lines.length !== input.displayedQuote.lines.length
  ) {
    return yield* goodsSnapshotInputError(
      "The goods order, customer, lines, and displayed quote do not match."
    );
  }

  const billing = yield* Schema.decodeUnknownEffect(goodsBillingIntentSchema, {
    onExcessProperty: "error",
  })(input.billing).pipe(
    Effect.mapError(() =>
      goodsSnapshotInputError("The goods billing intent is invalid.")
    )
  );
  const buyer = yield* getGoodsAccountingBuyer(input.customer, billing);
  const deliveryEmail = input.customer.email?.trim();
  if (!deliveryEmail) {
    return yield* goodsSnapshotInputError(
      "The Dotypos customer has no invoice delivery email."
    );
  }

  const sortedLines = input.lines.toSorted(
    (left, right) => left.sequence - right.sequence
  );
  const lines = yield* Effect.forEach(
    sortedLines,
    (line, sequence) =>
      Effect.gen(function* () {
        const displayed = input.displayedQuote.lines[sequence];
        if (
          !displayed ||
          line.orderId !== input.order.id ||
          line.sequence !== sequence
        ) {
          return yield* goodsSnapshotInputError(
            "Goods order lines are incomplete or out of sequence."
          );
        }
        const product = yield* Schema.decodeUnknownEffect(
          workspaceGoodsProductIdentitySchema,
          { onExcessProperty: "error" }
        )(line.productIdentity).pipe(
          Effect.mapError(() =>
            goodsSnapshotInputError(
              "A stored goods product identity is invalid."
            )
          )
        );
        const undiscountedTotal = moneyFromOrderLine(
          line.undiscountedTotalValue,
          line
        );
        const payableTotal = moneyFromOrderLine(line.payableTotalValue, line);
        if (
          !goodsProductsEqual(product, displayed.product) ||
          !workspaceMoneyEquals(
            displayed.discountableSubtotal,
            undiscountedTotal
          ) ||
          !workspaceMoneyEquals(displayed.discountedSubtotal, payableTotal) ||
          !discountsReconcile({
            discounts: displayed.discounts,
            undiscountedTotal,
            payableTotal,
            totalDiscount: displayed.totalDiscount,
          })
        ) {
          return yield* goodsSnapshotInputError(
            "Displayed goods pricing does not match the immutable order lines."
          );
        }
        return {
          product,
          description: line.description,
          quantity: line.quantity,
          undiscountedTotal,
          discounts: displayed.discounts,
          payableTotal,
        };
      }),
    { concurrency: "inherit" }
  );
  const totals = getGoodsAccountingTotals(lines);
  if (
    !totals ||
    !workspaceMoneyEquals(
      input.displayedQuote.discountableSubtotal,
      totals.undiscounted
    ) ||
    !workspaceMoneyEquals(
      input.displayedQuote.totalDiscount,
      totals.discount
    ) ||
    !workspaceMoneyEquals(
      input.displayedQuote.discountedSubtotal,
      totals.payable
    )
  ) {
    return yield* goodsSnapshotInputError(
      "Displayed goods totals do not match the immutable order."
    );
  }

  return yield* Schema.decodeUnknownEffect(
    goodsAccountingDocumentSnapshotSchema,
    {
      onExcessProperty: "error",
    }
  )({
    orderId: input.order.id,
    dotyposCustomerId: input.order.dotyposCustomerId,
    locale: input.locale,
    supplier: workspaceAccountingSupplier,
    buyer,
    billing,
    delivery: { email: deliveryEmail },
    fulfilledAt: temporalInstantToIsoString(input.order.fulfilledAt),
    lines,
    totals,
  }).pipe(
    Effect.mapError(() =>
      goodsSnapshotInputError("The goods accounting snapshot is invalid.")
    )
  );
});

const goodsSnapshotInputError = (message: string) =>
  new GoodsAccountingDocumentSnapshotInputError({ message });

const getGoodsAccountingBuyer = Effect.fn(
  "AccountingDocumentSnapshot.getGoodsBuyer"
)(function* (customer: DotyposCustomer, billing: GoodsBillingIntent) {
  const personalName = [customer.firstName, customer.lastName]
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part))
    .join(" ");
  if (billing.purpose === "personal" && billing.invoice === "none") {
    if (!personalName) {
      return yield* goodsSnapshotInputError(
        "The Dotypos customer has no personal legal name."
      );
    }
    return { kind: "person" as const, legalName: personalName };
  }

  const address = {
    line1: customer.addressLine1?.trim(),
    ...(customer.addressLine2?.trim() && {
      line2: customer.addressLine2.trim(),
    }),
    city: customer.city?.trim(),
    postalCode: customer.zip?.trim(),
    country: customer.country?.trim().toUpperCase(),
  };
  const candidate =
    billing.purpose === "business"
      ? {
          kind: "business" as const,
          legalName: customer.companyName?.trim(),
          companyId: customer.companyId?.trim(),
          ...(customer.vatId?.trim() && { vatId: customer.vatId.trim() }),
          address,
        }
      : { kind: "person" as const, legalName: personalName, address };

  return yield* Schema.decodeUnknownEffect(invoiceBuyerSchema, {
    onExcessProperty: "error",
  })(candidate).pipe(
    Effect.mapError(() =>
      goodsSnapshotInputError(
        "The Dotypos customer has incomplete invoice billing details."
      )
    )
  );
});

const moneyFromOrderLine = (
  value: number,
  line: Pick<OrderLineRow, "amountExponent" | "currency">
): WorkspaceMoney => ({
  value,
  exponent: line.amountExponent,
  currency: line.currency,
});

const goodsProductsEqual = (
  left: typeof workspaceGoodsProductIdentitySchema.Type,
  right: GoodsDiscountBasketQuote["lines"][number]["product"]
) =>
  right.kind === "goods" &&
  left.categoryId === right.categoryId &&
  left.productId === right.productId;

const discountsReconcile = (input: {
  readonly discounts: GoodsDiscountBasketQuote["lines"][number]["discounts"];
  readonly undiscountedTotal: WorkspaceMoney;
  readonly totalDiscount: WorkspaceMoney;
  readonly payableTotal: WorkspaceMoney;
}) => {
  let subtotal = input.undiscountedTotal;
  let discountValue = 0;
  for (const application of input.discounts) {
    if (
      !workspaceMoneyEquals(application.subtotalBefore, subtotal) ||
      application.amount.currency !== subtotal.currency ||
      application.amount.exponent !== subtotal.exponent ||
      application.subtotalAfter.currency !== subtotal.currency ||
      application.subtotalAfter.exponent !== subtotal.exponent ||
      application.subtotalAfter.value !==
        subtotal.value - application.amount.value
    ) {
      return false;
    }
    discountValue += application.amount.value;
    subtotal = application.subtotalAfter;
  }
  return (
    workspaceMoneyEquals(subtotal, input.payableTotal) &&
    workspaceMoneyEquals(input.totalDiscount, {
      ...subtotal,
      value: discountValue,
    })
  );
};

const getGoodsAccountingTotals = (
  lines: readonly (typeof goodsAccountingDocumentLineSchema.Type)[]
) => {
  const first = lines[0];
  if (!first) return undefined;
  const sameUnit = (money: WorkspaceMoney) =>
    money.currency === first.undiscountedTotal.currency &&
    money.exponent === first.undiscountedTotal.exponent;
  if (
    lines.some(
      ({ undiscountedTotal, payableTotal }) =>
        !sameUnit(undiscountedTotal) || !sameUnit(payableTotal)
    )
  ) {
    return undefined;
  }
  const undiscounted = lines.reduce(
    (sum, line) => sum + line.undiscountedTotal.value,
    0
  );
  const payable = lines.reduce((sum, line) => sum + line.payableTotal.value, 0);
  if (!Number.isSafeInteger(undiscounted) || !Number.isSafeInteger(payable)) {
    return undefined;
  }
  return {
    undiscounted: { ...first.undiscountedTotal, value: undiscounted },
    discount: {
      ...first.undiscountedTotal,
      value: undiscounted - payable,
    },
    payable: { ...first.payableTotal, value: payable },
  };
};
