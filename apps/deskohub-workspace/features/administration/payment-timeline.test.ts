import { describe, expect, test } from "bun:test";
import { NexiOperationIdSchema, NexiOrderIdSchema } from "@deskohub/nexi";
import { paymentAttemptIdSchema } from "@/features/checkout/checkout-identifiers";
import type { AdministrationPaymentAttempt } from "./administration.service";
import type { AdministrationOrder } from "./payment-administration.service";
import {
  buildPaymentAttemptTimeline,
  getAdministrationPaymentTimelineCopy,
  getOrderTimeline,
} from "./payment-timeline";

const providerOrderId = NexiOrderIdSchema.make("synthetic-order");

const refundedAttempt: AdministrationPaymentAttempt = {
  id: paymentAttemptIdSchema.make("synthetic-payment"),
  state: "paid",
  refundState: "refunded",
  providerOrderId,
  provider: "nexi",
  providerLabel: "Online payment",
  stateLabel: "Paid",
  failureCode: null,
  amount: { value: 35_000, exponent: 2, currency: "CZK" },
  refundedAmount: { value: 35_000, exponent: 2, currency: "CZK" },
  refundedAt: "2026-10-05T08:30:00Z",
  createdAt: "2026-10-01T10:00:00Z",
  providerOrderCreatedAt: "2026-10-01T10:00:01Z",
  updatedAt: "2026-10-05T08:30:00Z",
};

const orderWithBackOfficeRefund: AdministrationOrder = {
  orderId: providerOrderId,
  provider: {
    orderId: providerOrderId,
    operations: [
      {
        operationId: NexiOperationIdSchema.make("synthetic-capture"),
        operationType: "CAPTURE",
        operationResult: "EXECUTED",
        operationTime: "2026-10-01T10:02:00Z",
        amount: "35000",
      },
      {
        operationId: NexiOperationIdSchema.make("synthetic-refund"),
        operationType: "REFUND",
        operationResult: "VOIDED",
        operationTime: "2026-10-05T08:30:00Z",
        amount: "35000",
      },
    ],
  },
  providerAvailable: true,
  providerStatus: "available",
  link: null,
};

const orderUnavailable: AdministrationOrder = {
  orderId: providerOrderId,
  provider: null,
  providerAvailable: false,
  providerStatus: "unavailable",
  link: null,
};

const titles = (items: readonly { readonly title: string }[]) =>
  items.map(({ title }) => title);

describe("payment timeline", () => {
  test("shows a back-office refund once, as the Nexi refund operation", () => {
    const orders = [orderWithBackOfficeRefund];

    expect(
      titles([
        ...buildPaymentAttemptTimeline([refundedAttempt], orders),
        ...getOrderTimeline(orders),
      ])
    ).toEqual([
      "Payment started",
      "Payment executed by Nexi",
      "Refund reported by Nexi",
    ]);
  });

  test("falls back to the recorded refund when the Nexi refund time is unreadable", () => {
    const provider = orderWithBackOfficeRefund.provider;
    if (!provider) throw new Error("fixture order has provider details");
    const orders: AdministrationOrder[] = [
      {
        ...orderWithBackOfficeRefund,
        provider: {
          ...provider,
          operations: provider.operations.map((operation) =>
            operation.operationType === "REFUND"
              ? { ...operation, operationTime: "not a timestamp" }
              : operation
          ),
        },
      },
    ];

    expect(
      titles([
        ...buildPaymentAttemptTimeline([refundedAttempt], orders),
        ...getOrderTimeline(orders),
      ])
    ).toEqual([
      "Payment started",
      "Refund recorded",
      "Payment executed by Nexi",
    ]);
  });

  test("falls back to the recorded refund when Nexi order details are unavailable", () => {
    const orders = [orderUnavailable];

    expect(
      titles([
        ...buildPaymentAttemptTimeline([refundedAttempt], orders),
        ...getOrderTimeline(orders),
      ])
    ).toEqual(["Payment started", "Refund recorded"]);
  });

  test("words each payment event in the route locale", () => {
    const orders = [orderWithBackOfficeRefund];
    const items = [
      ...buildPaymentAttemptTimeline([refundedAttempt], orders),
      ...getOrderTimeline(orders),
    ];

    expect(
      items.map(({ event }) =>
        getAdministrationPaymentTimelineCopy(event, "cs-CZ")
      )
    ).toEqual([
      {
        title: "Platba zahájena",
        description: "Pokus o platbu synthetic-payment (Online platba).",
      },
      {
        title: "Nexi platbu provedlo",
        description: "Nexi hlásí tuto platební operaci.",
      },
      {
        title: "Nexi hlásí vrácení peněz",
        description: "Nexi hlásí tuto platební operaci.",
      },
    ]);
  });

  test("keeps the English API wording beside the localized event", () => {
    const [started, ended] = buildPaymentAttemptTimeline(
      [
        {
          ...refundedAttempt,
          state: "cancelled",
          failureCode: "payment_abandoned_after_provider_cutoff",
          refundedAt: null,
        },
      ],
      []
    );

    expect(started).toMatchObject({
      title: "Payment started",
      description: "Online payment attempt synthetic-payment.",
    });
    expect(ended).toMatchObject({
      title: "Payment abandoned",
      event: { source: "payment", kind: "attemptEnded", outcome: "abandoned" },
    });
    expect(
      ended && getAdministrationPaymentTimelineCopy(ended.event, "en-US")
    ).toEqual({
      title: "Payment abandoned",
      description:
        "Workspace released the reservation after the local payment window elapsed and Nexi still reported no payment activity.",
    });
  });

  test("names an unclassified Nexi operation by its type, result and channel", () => {
    expect(
      getAdministrationPaymentTimelineCopy(
        {
          source: "payment",
          kind: "operationReported",
          outcome: "other",
          operationType: "INCREMENTAL_AUTHORIZATION",
          operationResult: "PENDING",
          channel: "BACK_OFFICE",
        },
        "cs-CZ"
      )
    ).toEqual({
      title: "Incremental Authorization: Čeká na zpracování",
      description: "Nexi hlásí tuto operaci z kanálu Back Office.",
    });
  });

  test("names known Nexi codes in the route locale", () => {
    const event = {
      source: "payment",
      kind: "operationReported",
      outcome: "other",
      operationType: "CAPTURE",
      operationResult: "DENIED_BY_RISK",
      channel: "BACKOFFICE",
    } as const;

    expect(getAdministrationPaymentTimelineCopy(event, "cs-CZ")).toEqual({
      title: "Stržení platby: Odmítnuto kontrolou rizik",
      description: "Nexi hlásí tuto operaci z kanálu Back office Nexi.",
    });
    expect(getAdministrationPaymentTimelineCopy(event, "en-US")).toEqual({
      title: "Capture: Denied by risk check",
      description: "Nexi reported this Back office operation.",
    });
  });
});
