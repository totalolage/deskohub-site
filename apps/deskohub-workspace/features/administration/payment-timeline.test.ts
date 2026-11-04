import { describe, expect, test } from "bun:test";
import { NexiOperationIdSchema, NexiOrderIdSchema } from "@deskohub/nexi";
import { paymentAttemptIdSchema } from "@/features/checkout/checkout-identifiers";
import type { AdministrationPaymentAttempt } from "./administration.service";
import { loadFixtureReservation } from "./fixtures";
import { m } from "./i18n";
import type { AdministrationOrder } from "./payment-administration.service";
import { getProviderValueLabel } from "./payment-presentation";
import {
  type AdministrationPaymentTimelineEvent,
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

  test("ends an attempt only once it stops without a payment", () => {
    const attempt = (
      state: AdministrationPaymentAttempt["state"],
      failureCode: string | null = null
    ): AdministrationPaymentAttempt => ({
      ...refundedAttempt,
      id: paymentAttemptIdSchema.make(`synthetic-${state}`),
      state,
      failureCode,
      refundedAt: null,
    });
    const items = buildPaymentAttemptTimeline(
      [
        attempt("created"),
        attempt("pending"),
        attempt("paid"),
        attempt("failed"),
        attempt("expired"),
        attempt("cancelled"),
        attempt("expired", "payment_abandoned_after_provider_cutoff"),
      ],
      []
    );

    expect(
      items.map(({ id, event, occurredAt, tone }) => ({
        id,
        event,
        occurredAt,
        tone,
      }))
    ).toEqual([
      ...["created", "pending", "paid"].map((state) => ({
        id: `payment-attempt-synthetic-${state}-started`,
        event: {
          source: "payment",
          kind: "attemptStarted",
          attemptId: `synthetic-${state}`,
          provider: "nexi",
        },
        occurredAt: refundedAttempt.createdAt,
        tone: "neutral",
      })),
      ...(
        [
          ["failed", "failed"],
          ["expired", "unsuccessful"],
          ["cancelled", "unsuccessful"],
        ] as const
      ).flatMap(([state, outcome]) => [
        expect.objectContaining({
          id: `payment-attempt-synthetic-${state}-started`,
        }),
        {
          id: `payment-attempt-synthetic-${state}-${state}`,
          event: { source: "payment", kind: "attemptEnded", outcome },
          occurredAt: refundedAttempt.updatedAt,
          tone: "warning",
        },
      ]),
      expect.objectContaining({
        id: "payment-attempt-synthetic-expired-started",
      }),
      {
        id: "payment-attempt-synthetic-expired-expired",
        event: {
          source: "payment",
          kind: "attemptEnded",
          outcome: "abandoned",
        },
        occurredAt: refundedAttempt.updatedAt,
        tone: "warning",
      },
    ]);
    const [failed, unsuccessful, , abandoned] = items
      .filter(({ event }) => event.kind === "attemptEnded")
      .map(({ description }) => description);
    expect(failed).toBe(unsuccessful);
    expect(abandoned).not.toBe(failed);
  });

  test("records when Nexi created each order, marking estimated times", () => {
    const fixtureLink = loadFixtureReservation("0198-admin-fixture-attention")
      ?.orders[0]?.link;
    if (!fixtureLink) throw new Error("Expected a linked fixture order");
    const link = {
      ...fixtureLink,
      providerOrderCreatedAt: "2026-10-01T10:00:01Z",
      providerOrderCreatedAtEstimated: false,
    };
    const items = getOrderTimeline([
      { ...orderUnavailable, link },
      {
        ...orderUnavailable,
        orderId: NexiOrderIdSchema.make("synthetic-estimated"),
        link: { ...link, providerOrderCreatedAtEstimated: true },
      },
      {
        ...orderUnavailable,
        orderId: NexiOrderIdSchema.make("synthetic-untracked"),
        link: { ...link, providerOrderCreatedAt: null },
      },
    ]);

    expect(
      items.map(({ id, event, href, occurredAt }) => ({
        id,
        event,
        href,
        occurredAt,
      }))
    ).toEqual([
      {
        id: "order-synthetic-order-created",
        event: { source: "payment", kind: "orderCreated", estimated: false },
        href: "#order-synthetic-order",
        occurredAt: link.providerOrderCreatedAt,
      },
      {
        id: "order-synthetic-estimated-created",
        event: { source: "payment", kind: "orderCreated", estimated: true },
        href: "#order-synthetic-estimated",
        occurredAt: link.providerOrderCreatedAt,
      },
    ]);
    expect(
      items.map(({ event }) =>
        getAdministrationPaymentTimelineCopy(event, "cs-CZ")
      )
    ).toEqual([
      {
        title: m.administrationPaymentTimelineOrderCreatedTitle(
          {},
          { locale: "cs-CZ" }
        ),
        description: m.administrationPaymentTimelineOrderCreatedDescription(
          {},
          { locale: "cs-CZ" }
        ),
      },
      {
        title: m.administrationPaymentTimelineOrderCreatedEstimatedTitle(
          {},
          { locale: "cs-CZ" }
        ),
        description:
          m.administrationPaymentTimelineOrderCreatedEstimatedDescription(
            {},
            { locale: "cs-CZ" }
          ),
      },
    ]);
  });

  test("classifies each Nexi operation by its type and result, in any case", () => {
    const operation = (
      operationType: string | undefined,
      operationResult: string | undefined
    ) => ({
      operationType,
      operationResult,
      operationTime: "2026-10-01T10:02:00Z",
    });
    const items = getOrderTimeline([
      {
        ...orderWithBackOfficeRefund,
        provider: {
          orderId: providerOrderId,
          operations: [
            operation("AUTHORIZATION", "AUTHORIZED"),
            operation("authorization", "executed"),
            operation("CAPTURE", "EXECUTED"),
            operation("CAPTURE", "PENDING"),
            operation("AUTHORIZATION", undefined),
            operation("REFUND", undefined),
            operation("CANCEL", "EXECUTED"),
            operation("VOID", "VOIDED"),
            operation(undefined, "EXECUTED"),
            { ...operation("CAPTURE", "EXECUTED"), operationTime: undefined },
          ],
        },
      },
    ]);

    expect(items.map(({ event }) => event)).toEqual([
      {
        source: "payment",
        kind: "operationReported",
        outcome: "authorized",
        operationType: "AUTHORIZATION",
        operationResult: "AUTHORIZED",
      },
      {
        source: "payment",
        kind: "operationReported",
        outcome: "executed",
        operationType: "AUTHORIZATION",
        operationResult: "EXECUTED",
      },
      {
        source: "payment",
        kind: "operationReported",
        outcome: "executed",
        operationType: "CAPTURE",
        operationResult: "EXECUTED",
      },
      {
        source: "payment",
        kind: "operationReported",
        outcome: "other",
        operationType: "CAPTURE",
        operationResult: "PENDING",
      },
      {
        source: "payment",
        kind: "operationReported",
        outcome: "other",
        operationType: "AUTHORIZATION",
      },
      {
        source: "payment",
        kind: "operationReported",
        outcome: "refund",
        operationType: "REFUND",
      },
      {
        source: "payment",
        kind: "operationReported",
        outcome: "reversal",
        operationType: "CANCEL",
        operationResult: "EXECUTED",
      },
      {
        source: "payment",
        kind: "operationReported",
        outcome: "reversal",
        operationType: "VOID",
        operationResult: "VOIDED",
      },
      {
        source: "payment",
        kind: "operationReported",
        outcome: "other",
        operationResult: "EXECUTED",
      },
    ]);
    expect(items.map(({ id, href }) => ({ id, href }))).toEqual(
      items.map((_, index) => ({
        id: `nexi-operation-${providerOrderId}-${index}`,
        href: undefined,
      }))
    );
  });

  test("names each classified Nexi operation in the route locale", () => {
    const copy = (event: AdministrationPaymentTimelineEvent) =>
      getAdministrationPaymentTimelineCopy(event, "cs-CZ");
    const reported = (
      outcome: Extract<
        AdministrationPaymentTimelineEvent,
        { readonly kind: "operationReported" }
      >["outcome"],
      details: { operationType?: string; operationResult?: string } = {}
    ) =>
      copy({
        source: "payment",
        kind: "operationReported",
        outcome,
        ...details,
      });
    const locale = { locale: "cs-CZ" } as const;
    const description = m.administrationPaymentTimelineOperationDescription(
      {},
      locale
    );

    expect([
      reported("authorized"),
      reported("executed"),
      reported("refund"),
      reported("reversal"),
      reported("other"),
      reported("other", { operationType: "CAPTURE" }),
    ]).toEqual([
      {
        title: m.administrationPaymentTimelineAuthorizedTitle({}, locale),
        description,
      },
      {
        title: m.administrationPaymentTimelineExecutedTitle({}, locale),
        description,
      },
      {
        title: m.administrationPaymentTimelineRefundReportedTitle({}, locale),
        description,
      },
      {
        title: m.administrationPaymentTimelineReversalTitle({}, locale),
        description,
      },
      {
        title: m.administrationPaymentOperationFallback({}, locale),
        description,
      },
      { title: getProviderValueLabel("CAPTURE", "cs-CZ"), description },
    ]);
    expect([
      copy({ source: "payment", kind: "refundRecorded" }),
      copy({ source: "payment", kind: "attemptEnded", outcome: "failed" }),
      copy({
        source: "payment",
        kind: "attemptEnded",
        outcome: "unsuccessful",
      }),
    ]).toEqual([
      {
        title: m.administrationPaymentTimelineRefundRecordedTitle({}, locale),
        description: m.administrationPaymentTimelineRefundRecordedDescription(
          {},
          locale
        ),
      },
      {
        title: m.administrationPaymentTimelineFailedTitle({}, locale),
        description: m.administrationPaymentTimelineEndedDescription(
          {},
          locale
        ),
      },
      {
        title: m.administrationPaymentTimelineUnsuccessfulTitle({}, locale),
        description: m.administrationPaymentTimelineEndedDescription(
          {},
          locale
        ),
      },
    ]);
  });
});
