import {
  DotyposCustomerIdSchema,
  DotyposReservationIdSchema,
  DotyposTableIdSchema,
} from "@deskohub/dotypos";
import { NexiOperationIdSchema, NexiOrderIdSchema } from "@deskohub/nexi";
import { testEmailAddress } from "@deskohub/test-email";
import { paymentAttemptIdSchema } from "@/features/checkout/checkout-identifiers";
import { discountApplicationIdSchema } from "@/features/discounts/persistence-contracts";
import { workspaceReservationIdSchema } from "@/features/reservation/persistence-contracts";
import type {
  AdministrationBookingSummary,
  AdministrationPaymentAttempt,
  AdministrationReservationDetail,
  AdministrationReservationListInput,
  AdministrationReservationSummary,
} from "./administration.service";
import { getAdministrationReservationDateRange } from "./reservation-date-range";
import { getAdministrationReservationLifecycle } from "./reservation-status";

const alexMorganEmail = testEmailAddress("alex.morgan");
const jordanLeeEmail = testEmailAddress("jordan.lee");
const samTaylorEmail = testEmailAddress("sam.taylor");

const timeZone = "Europe/Prague";

const fixtureCustomerId = (id: string) => DotyposCustomerIdSchema.make(id);
const fixtureBookingId = (id: string) => DotyposReservationIdSchema.make(id);
const fixtureTableId = (id: string) => DotyposTableIdSchema.make(id);
const fixtureReservationId = (id: string) =>
  workspaceReservationIdSchema.make(id);
const fixturePaymentAttemptId = (id: string) => paymentAttemptIdSchema.make(id);
const fixtureDiscountApplicationId = (id: string) =>
  discountApplicationIdSchema.make(id);
const fixtureNexiOrderId = (id: string) => NexiOrderIdSchema.make(id);
const fixtureNexiOperationId = (id: string) => NexiOperationIdSchema.make(id);

const atTime = (date: Temporal.PlainDate, hour: number) =>
  date
    .toZonedDateTime({
      plainTime: Temporal.PlainTime.from(`${String(hour).padStart(2, "0")}:00`),
      timeZone,
    })
    .toInstant()
    .toString();

const today = () =>
  Temporal.Now.instant().toZonedDateTimeISO(timeZone).toPlainDate();

const fixtureCustomers = {
  "customer-alex": {
    id: fixtureCustomerId("customer-alex"),
    displayName: "Alex Morgan",
    hasName: true,
    email: alexMorganEmail,
    phone: "+420 700 000 101",
  },
  "customer-jordan": {
    id: fixtureCustomerId("customer-jordan"),
    displayName: "Jordan Lee",
    hasName: true,
    email: jordanLeeEmail,
    phone: "+420 700 000 202",
  },
  "customer-sam": {
    id: fixtureCustomerId("customer-sam"),
    displayName: "Sam Taylor",
    hasName: true,
    email: samTaylorEmail,
    phone: null,
  },
} as const;

const makeFixturePayment = (
  id: string,
  updatedAt: string
): AdministrationPaymentAttempt => ({
  id: fixturePaymentAttemptId(`payment-${id}`),
  state: "paid",
  refundState: "not_required",
  providerOrderId: fixtureNexiOrderId(`ORDER-${id}`),
  provider: "nexi",
  providerLabel: "Online payment",
  stateLabel: "Paid",
  failureCode: null,
  amount: { value: 27_500, exponent: 2, currency: "CZK" },
  refundedAmount: null,
  refundedAt: null,
  createdAt: Temporal.Instant.from(updatedAt)
    .subtract({ minutes: 5 })
    .toString(),
  providerOrderCreatedAt: Temporal.Instant.from(updatedAt)
    .subtract({ minutes: 4 })
    .toString(),
  updatedAt,
});

const makeReservations = (): readonly AdministrationReservationSummary[] => {
  const currentDate = today();
  const yesterday = currentDate.subtract({ days: 1 });
  const tomorrow = currentDate.add({ days: 1 });
  const lastWeek = currentDate.subtract({ days: 7 });
  return [
    {
      id: fixtureReservationId("0198-admin-fixture-attention"),
      dotyposReservationId: fixtureBookingId(
        "live-0198-admin-fixture-attention"
      ),
      customerId: fixtureCustomers["customer-alex"].id,
      customer: fixtureCustomers["customer-alex"],
      liveDetailsAvailable: true,
      startsAt: atTime(currentDate, 14),
      endsAt: atTime(currentDate, 16),
      date: currentDate.toString(),
      type: "meeting-room",
      product: { kind: "meeting-room" },
      typeLabel: "Meeting Room",
      purpose: "business",
      status: {
        group: "attention",
        code: "confirmation_issue",
        label: "Confirmation issue",
      },
      statusNote: null,
      statusNoteCode: null,
      createdAt: atTime(currentDate, 8),
      latestPayment: makeFixturePayment(
        "0198-admin-fixture-attention",
        atTime(currentDate, 10)
      ),
      updatedAt: atTime(currentDate, 10),
    },
    {
      id: fixtureReservationId("0198-admin-fixture-pending"),
      dotyposReservationId: fixtureBookingId("live-0198-admin-fixture-pending"),
      customerId: fixtureCustomers["customer-jordan"].id,
      customer: fixtureCustomers["customer-jordan"],
      liveDetailsAvailable: true,
      startsAt: atTime(currentDate, 9),
      endsAt: atTime(currentDate, 18),
      date: currentDate.toString(),
      type: "cowork",
      product: { kind: "cowork", tier: "profi" },
      typeLabel: "Cowork Profi",
      purpose: "personal",
      status: {
        group: "in_progress",
        code: "payment_pending",
        label: "Payment pending",
      },
      statusNote: null,
      statusNoteCode: null,
      createdAt: atTime(currentDate, 8),
      latestPayment: {
        ...makeFixturePayment(
          "0198-admin-fixture-pending",
          atTime(currentDate, 9)
        ),
        state: "pending",
        stateLabel: "Pending",
      },
      updatedAt: atTime(currentDate, 9),
    },
    {
      id: fixtureReservationId("0198-admin-fixture-confirming"),
      dotyposReservationId: fixtureBookingId(
        "live-0198-admin-fixture-confirming"
      ),
      customerId: fixtureCustomers["customer-sam"].id,
      customer: fixtureCustomers["customer-sam"],
      liveDetailsAvailable: true,
      startsAt: atTime(tomorrow, 10),
      endsAt: atTime(tomorrow, 17),
      date: tomorrow.toString(),
      type: "cowork",
      product: { kind: "cowork", tier: "plus" },
      typeLabel: "Cowork Plus",
      purpose: "personal",
      status: { group: "in_progress", code: "confirming", label: "Confirming" },
      statusNote: null,
      statusNoteCode: null,
      createdAt: atTime(yesterday, 16),
      latestPayment: makeFixturePayment(
        "0198-admin-fixture-confirming",
        atTime(yesterday, 17)
      ),
      updatedAt: atTime(yesterday, 17),
    },
    {
      id: fixtureReservationId("0198-admin-fixture-complete"),
      dotyposReservationId: fixtureBookingId(
        "live-0198-admin-fixture-complete"
      ),
      customerId: fixtureCustomers["customer-alex"].id,
      customer: fixtureCustomers["customer-alex"],
      liveDetailsAvailable: true,
      startsAt: atTime(lastWeek, 9),
      endsAt: atTime(lastWeek, 18),
      date: lastWeek.toString(),
      type: "cowork",
      product: { kind: "cowork", tier: "basic" },
      typeLabel: "Cowork Basic",
      purpose: "personal",
      status: { group: "complete", code: "complete", label: "Complete" },
      statusNote: null,
      statusNoteCode: null,
      createdAt: atTime(lastWeek, 7),
      latestPayment: makeFixturePayment(
        "0198-admin-fixture-complete",
        atTime(lastWeek, 8)
      ),
      updatedAt: atTime(lastWeek, 8),
    },
    {
      id: fixtureReservationId("0198-admin-fixture-cancelled"),
      dotyposReservationId: fixtureBookingId(
        "live-0198-admin-fixture-cancelled"
      ),
      customerId: fixtureCustomers["customer-jordan"].id,
      customer: fixtureCustomers["customer-jordan"],
      liveDetailsAvailable: true,
      startsAt: atTime(yesterday, 13),
      endsAt: atTime(yesterday, 15),
      date: yesterday.toString(),
      type: "meeting-room",
      product: { kind: "meeting-room" },
      typeLabel: "Meeting Room",
      purpose: null,
      status: { group: "cancelled", code: "cancelled", label: "Cancelled" },
      statusNote: null,
      statusNoteCode: null,
      createdAt: atTime(yesterday, 7),
      latestPayment: null,
      updatedAt: atTime(yesterday, 8),
    },
  ];
};

const fixtureBookingStatuses = {
  attention: { status: "CONFIRMED", statusLabel: "Confirmed" },
  in_progress: { status: "NEW", statusLabel: "New" },
  complete: { status: "CONFIRMED", statusLabel: "Confirmed" },
  cancelled: { status: "CANCELLED", statusLabel: "Cancelled" },
} as const;

const makeBookings = (): readonly AdministrationBookingSummary[] =>
  makeReservations().map((reservation, index) => ({
    id: fixtureBookingId(`live-${reservation.id}`),
    customerId: reservation.customerId,
    customer: reservation.customer,
    startsAt: reservation.startsAt ?? reservation.updatedAt,
    endsAt:
      reservation.endsAt ??
      Temporal.Instant.from(reservation.updatedAt).add({ hours: 2 }).toString(),
    seats: reservation.type === "meeting-room" ? "4" : "1",
    ...fixtureBookingStatuses[reservation.status.group],
    tableId: fixtureTableId(`fixture-table-${index + 1}`),
    tableName: index === 3 ? "Table 4" : `Table ${index + 1}`,
    tableLocation: index % 2 === 0 ? "Main floor" : "Coworking area",
    linkedReservation: {
      id: reservation.id,
      label: reservation.typeLabel,
      product: reservation.product,
    },
    createdAt: Temporal.Instant.from(reservation.updatedAt)
      .subtract({ hours: 2 })
      .toString(),
    updatedAt: reservation.updatedAt,
  }));

const getFixtureLifecycle = (reservation: AdministrationReservationSummary) => {
  switch (reservation.status.code) {
    case "confirmation_issue":
      return getAdministrationReservationLifecycle({
        fulfillmentState: "failed",
        paymentState: "paid",
        reservationState: "confirmed",
      });
    case "complete":
      return getAdministrationReservationLifecycle({
        fulfillmentState: "fulfilled",
        paymentState: "paid",
        reservationState: "confirmed",
      });
    case "cancelled":
      return getAdministrationReservationLifecycle({
        fulfillmentState: "not_started",
        paymentState: "cancelled",
        reservationState: "cancelled",
      });
    case "confirming":
      return getAdministrationReservationLifecycle({
        fulfillmentState: "processing",
        paymentState: "paid",
        reservationState: "confirming",
      });
    default:
      return getAdministrationReservationLifecycle({
        fulfillmentState: "not_started",
        paymentState: "pending",
        reservationState: "held",
      });
  }
};

export const loadFixtureReservations = (
  input: AdministrationReservationListInput
) => {
  const dateRange = getAdministrationReservationDateRange(input);
  const items = makeReservations().filter(
    (reservation) =>
      (!input.customerId || reservation.customerId === input.customerId) &&
      (!input.status || reservation.status.group === input.status) &&
      (!input.type || reservation.type === input.type) &&
      (!dateRange ||
        (reservation.date !== null &&
          (!dateRange.from || reservation.date >= dateRange.from) &&
          (!dateRange.to || reservation.date <= dateRange.to)))
  );
  return {
    items,
    page: 1,
    pageCount: 1,
    total: items.length,
    dateFilterUnavailable: false,
    dateSortUnavailable: false,
  };
};

export const loadFixtureReservation = (
  id: string
): AdministrationReservationDetail | null => {
  const reservations = makeReservations();
  const reservation = reservations.find((item) => item.id === id);
  if (!reservation) return null;
  const startedAt = Temporal.Instant.from(reservation.updatedAt)
    .subtract({ hours: 2 })
    .toString();
  const paidAt = Temporal.Instant.from(reservation.updatedAt)
    .subtract({ minutes: 35 })
    .toString();
  const providerOrderCreatedAt = Temporal.Instant.from(paidAt)
    .subtract({ minutes: 2 })
    .toString();
  return {
    author: null,
    reservation,
    operatorNotice: null,
    canCancel: true,
    requiresProviderCredentialRemoval: false,
    timeline: [
      {
        id: "fixture-checkout",
        event: { source: "reservation", kind: "workflow_created" },
        title: "Checkout workflow created",
        description: "Deskohub created the local reservation workflow.",
        occurredAt: startedAt,
        tone: "neutral",
      },
      {
        id: "fixture-hold",
        event: { source: "reservation", kind: "reservation_held" },
        title: "Reservation held",
        description: "The booking was held for the customer.",
        occurredAt: Temporal.Instant.from(startedAt)
          .add({ minutes: 1 })
          .toString(),
        tone: "neutral",
      },
      {
        id: "fixture-payment-started",
        event: { source: "reservation", kind: "payment_started" },
        title: "Payment started",
        description: "An online payment attempt began.",
        occurredAt: Temporal.Instant.from(paidAt)
          .subtract({ minutes: 3 })
          .toString(),
        tone: "neutral",
      },
      {
        id: "fixture-order-created",
        event: { source: "payment", kind: "orderCreated", estimated: false },
        title: "Nexi order created",
        description: "Nexi accepted the hosted-payment request.",
        occurredAt: providerOrderCreatedAt,
        tone: "neutral",
        href: "#order-DADMINFIXTUREPAYMENT",
      },
      {
        id: "fixture-operation",
        event: {
          source: "payment",
          kind: "operationReported",
          outcome: "executed",
          operationType: "CAPTURE",
          operationResult: "EXECUTED",
          channel: "ECOMMERCE",
        },
        title: "Payment executed by Nexi",
        description: "Nexi reported this Ecommerce operation.",
        occurredAt: Temporal.Instant.from(paidAt)
          .subtract({ minutes: 1 })
          .toString(),
        tone: "positive",
        href: "#operation-DADMINFIXTUREOPERATION",
      },
      {
        id: "fixture-paid",
        event: { source: "reservation", kind: "payment_recorded" },
        title: "Payment recorded by Deskohub",
        description:
          "Deskohub verified the provider payment and marked the reservation paid.",
        occurredAt: paidAt,
        tone: "positive",
      },
      ...(reservation.status.group === "attention"
        ? [
            {
              id: "fixture-attention",
              event: {
                source: "reservation",
                kind: "confirmation_failed",
              } as const,
              title: "Customer confirmation failed",
              description: "The confirmation could not be completed.",
              occurredAt: reservation.updatedAt,
              tone: "warning" as const,
            },
          ]
        : []),
    ],
    paymentAttempts: [
      {
        id: fixturePaymentAttemptId("fixture-payment"),
        state: "paid",
        refundState: "not_required",
        providerOrderId: fixtureNexiOrderId("DADMINFIXTUREPAYMENT"),
        provider: "nexi",
        providerLabel: "Online payment",
        stateLabel: "Paid",
        failureCode: null,
        amount: { value: 240000, exponent: 2, currency: "CZK" },
        refundedAmount: null,
        refundedAt: null,
        createdAt: Temporal.Instant.from(paidAt)
          .subtract({ minutes: 3 })
          .toString(),
        providerOrderCreatedAt,
        updatedAt: paidAt,
      },
    ],
    booking:
      makeBookings().find(
        ({ linkedReservation }) => linkedReservation?.id === reservation.id
      ) ?? null,
    lifecycle: getFixtureLifecycle(reservation),
    orders: [
      {
        orderId: fixtureNexiOrderId("DADMINFIXTUREPAYMENT"),
        providerAvailable: true,
        providerStatus: "available",
        provider: {
          orderId: fixtureNexiOrderId("DADMINFIXTUREPAYMENT"),
          amount: "240000",
          currency: "CZK",
          capturedAmount: "240000",
          lastOperationTime: Temporal.Instant.from(paidAt)
            .subtract({ minutes: 1 })
            .toString(),
          lastOperationType: "CAPTURE",
          operations: [
            {
              orderId: fixtureNexiOrderId("DADMINFIXTUREPAYMENT"),
              operationId: fixtureNexiOperationId("DADMINFIXTUREOPERATION"),
              channel: "ECOMMERCE",
              operationType: "CAPTURE",
              operationResult: "EXECUTED",
              operationTime: Temporal.Instant.from(paidAt)
                .subtract({ minutes: 1 })
                .toString(),
              amount: "240000",
              currency: "CZK",
            },
          ],
        },
        link: {
          paymentAttemptId: fixturePaymentAttemptId("fixture-payment"),
          reservationId: reservation.id,
          state: "paid",
          refundState: "not_required",
          stateLabel: "Paid",
          failureCode: null,
          amount: { value: 240000, exponent: 2, currency: "CZK" },
          refundedAmount: null,
          refundedAt: null,
          attemptCreatedAt: Temporal.Instant.from(paidAt)
            .subtract({ minutes: 3 })
            .toString(),
          providerOrderCreatedAt,
          providerOrderCreatedAtEstimated: false,
          updatedAt: paidAt,
        },
      },
    ],
    discounts: [
      {
        id: fixtureDiscountApplicationId("fixture-discount"),
        label: "Workspace welcome offer",
        amount: { value: 30000, exponent: 2, currency: "CZK" },
      },
    ],
    accessGrant:
      reservation.status.group === "attention"
        ? {
            id: "fixture-access-grant",
            state: "failed",
            provider: "igloohome",
            credentialType: "algopin_hourly",
            deviceId: "EK1X16f8898a",
            providerCredentialId: null,
            accessName: "Deskohub fixture-access-grant",
            scheduledStartsAt: reservation.startsAt ?? startedAt,
            startsAt: reservation.startsAt ?? startedAt,
            endsAt: reservation.endsAt ?? reservation.updatedAt,
            provisioningStartedAt: null,
            issuedAt: null,
            failedAt: reservation.updatedAt,
            failureCode: "provider_request_rejected",
            createdAt: startedAt,
            updatedAt: reservation.updatedAt,
          }
        : null,
    otherCustomerReservations: reservations.filter(
      (item) => item.customerId === reservation.customerId && item.id !== id
    ),
    sameDateReservations: reservations.filter(
      (item) => item.date === reservation.date && item.id !== id
    ),
    references: {
      workspaceReservationId: reservation.id,
      dotyposReservationId: fixtureBookingId(`live-${reservation.id}`),
      customerId: reservation.customerId,
    },
  };
};
