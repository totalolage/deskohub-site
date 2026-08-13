import {
  DotyposCustomerIdSchema,
  DotyposReservationIdSchema,
  DotyposTableIdSchema,
} from "@deskohub/dotypos";
import { NexiOperationIdSchema, NexiOrderIdSchema } from "@deskohub/nexi";
import { paymentAttemptIdSchema } from "@/features/checkout/checkout-identifiers";
import { discountApplicationIdSchema } from "@/features/discounts/persistence-contracts";
import { workspaceReservationIdSchema } from "@/features/reservation/persistence-contracts";
import type {
  AdministrationBookingPage,
  AdministrationBookingSummary,
  AdministrationPaymentAttempt,
  AdministrationReservationDetail,
  AdministrationReservationListInput,
  AdministrationReservationSummary,
} from "./administration.service";
import { getAdministrationReservationDateRange } from "./reservation-date-range";
import { getAdministrationReservationLifecycle } from "./reservation-status";

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
    email: "alex.morgan@example.test",
    phone: "+420 700 000 101",
  },
  "customer-jordan": {
    id: fixtureCustomerId("customer-jordan"),
    displayName: "Jordan Lee",
    email: "jordan.lee@example.test",
    phone: "+420 700 000 202",
  },
  "customer-sam": {
    id: fixtureCustomerId("customer-sam"),
    displayName: "Sam Taylor",
    email: "sam.taylor@example.test",
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
  providerLabel: "Online payment",
  stateLabel: "Paid",
  amount: { value: 27_500, exponent: 2, currency: "CZK" },
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
      customerId: fixtureCustomers["customer-alex"].id,
      customer: fixtureCustomers["customer-alex"],
      liveDetailsAvailable: true,
      startsAt: atTime(currentDate, 14),
      endsAt: atTime(currentDate, 16),
      date: currentDate.toString(),
      type: "meeting-room",
      typeLabel: "Meeting Room",
      status: { group: "attention", label: "Confirmation issue" },
      statusNote: null,
      createdAt: atTime(currentDate, 8),
      latestPayment: makeFixturePayment(
        "0198-admin-fixture-attention",
        atTime(currentDate, 10)
      ),
      updatedAt: atTime(currentDate, 10),
    },
    {
      id: fixtureReservationId("0198-admin-fixture-pending"),
      customerId: fixtureCustomers["customer-jordan"].id,
      customer: fixtureCustomers["customer-jordan"],
      liveDetailsAvailable: true,
      startsAt: atTime(currentDate, 9),
      endsAt: atTime(currentDate, 18),
      date: currentDate.toString(),
      type: "cowork",
      typeLabel: "Cowork Profi",
      status: { group: "in_progress", label: "Payment pending" },
      statusNote: null,
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
      customerId: fixtureCustomers["customer-sam"].id,
      customer: fixtureCustomers["customer-sam"],
      liveDetailsAvailable: true,
      startsAt: atTime(tomorrow, 10),
      endsAt: atTime(tomorrow, 17),
      date: tomorrow.toString(),
      type: "cowork",
      typeLabel: "Cowork Plus",
      status: { group: "in_progress", label: "Confirming" },
      statusNote: null,
      createdAt: atTime(yesterday, 16),
      latestPayment: makeFixturePayment(
        "0198-admin-fixture-confirming",
        atTime(yesterday, 17)
      ),
      updatedAt: atTime(yesterday, 17),
    },
    {
      id: fixtureReservationId("0198-admin-fixture-complete"),
      customerId: fixtureCustomers["customer-alex"].id,
      customer: fixtureCustomers["customer-alex"],
      liveDetailsAvailable: true,
      startsAt: atTime(lastWeek, 9),
      endsAt: atTime(lastWeek, 18),
      date: lastWeek.toString(),
      type: "cowork",
      typeLabel: "Cowork Basic",
      status: { group: "complete", label: "Complete" },
      statusNote: null,
      createdAt: atTime(lastWeek, 7),
      latestPayment: makeFixturePayment(
        "0198-admin-fixture-complete",
        atTime(lastWeek, 8)
      ),
      updatedAt: atTime(lastWeek, 8),
    },
    {
      id: fixtureReservationId("0198-admin-fixture-cancelled"),
      customerId: fixtureCustomers["customer-jordan"].id,
      customer: fixtureCustomers["customer-jordan"],
      liveDetailsAvailable: true,
      startsAt: atTime(yesterday, 13),
      endsAt: atTime(yesterday, 15),
      date: yesterday.toString(),
      type: "meeting-room",
      typeLabel: "Meeting Room",
      status: { group: "cancelled", label: "Cancelled" },
      statusNote: null,
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
    },
    createdAt: Temporal.Instant.from(reservation.updatedAt)
      .subtract({ hours: 2 })
      .toString(),
    updatedAt: reservation.updatedAt,
  }));

const getFixtureLifecycle = (reservation: AdministrationReservationSummary) => {
  switch (reservation.status.label) {
    case "Confirmation issue":
      return getAdministrationReservationLifecycle({
        fulfillmentState: "failed",
        paymentState: "paid",
        reservationState: "confirmed",
      });
    case "Complete":
      return getAdministrationReservationLifecycle({
        fulfillmentState: "fulfilled",
        paymentState: "paid",
        reservationState: "confirmed",
      });
    case "Cancelled":
      return getAdministrationReservationLifecycle({
        fulfillmentState: "not_started",
        paymentState: "cancelled",
        reservationState: "cancelled",
      });
    case "Confirming":
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

export const loadFixtureBookings = (input?: {
  readonly date?: string;
  readonly page?: number;
}): AdministrationBookingPage => {
  const items = makeBookings().filter(
    (booking) => !input?.date || getFixtureDate(booking.startsAt) === input.date
  );
  return {
    items,
    page: input?.page ?? 1,
    pageCount: 1,
    total: items.length,
  };
};

const getFixtureDate = (value: string) =>
  Temporal.Instant.from(value)
    .toZonedDateTimeISO(timeZone)
    .toPlainDate()
    .toString();

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
    reservation,
    canCancel: true,
    timeline: [
      {
        id: "fixture-checkout",
        title: "Checkout started",
        description: "The customer began checkout.",
        occurredAt: startedAt,
        tone: "neutral",
      },
      {
        id: "fixture-hold",
        title: "Reservation held",
        description: "The booking was held for the customer.",
        occurredAt: Temporal.Instant.from(startedAt)
          .add({ minutes: 1 })
          .toString(),
        tone: "neutral",
      },
      {
        id: "fixture-payment-started",
        title: "Payment started",
        description: "An online payment attempt began.",
        occurredAt: Temporal.Instant.from(paidAt)
          .subtract({ minutes: 3 })
          .toString(),
        tone: "neutral",
      },
      {
        id: "fixture-order-created",
        title: "Nexi order created",
        description: "Nexi accepted the hosted-payment request.",
        occurredAt: providerOrderCreatedAt,
        tone: "neutral",
        href: "#order-DADMINFIXTUREPAYMENT",
      },
      {
        id: "fixture-operation",
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
        providerLabel: "Online payment",
        stateLabel: "Paid",
        amount: { value: 240000, exponent: 2, currency: "CZK" },
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
          stateLabel: "Paid",
          amount: { value: 240000, exponent: 2, currency: "CZK" },
          attemptCreatedAt: Temporal.Instant.from(paidAt)
            .subtract({ minutes: 3 })
            .toString(),
          providerOrderCreatedAt,
          providerOrderCreatedAtEstimated: false,
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
