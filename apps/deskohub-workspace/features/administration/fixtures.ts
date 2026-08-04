import { env } from "@/env";
import type { AdminCustomerProfile } from "@/features/discounts/admin/discount-administration.service";
import type { DotyposCustomerId } from "@/features/reservation/dotypos-customer";
import type {
  AdministrationCustomerSummary,
  AdministrationReservationDetail,
  AdministrationReservationListInput,
  AdministrationReservationSummary,
} from "./administration.service";

const timeZone = "Europe/Prague";

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
    id: "customer-alex",
    displayName: "Alex Morgan",
    email: "alex.morgan@example.test",
    phone: "+420 700 000 101",
  },
  "customer-jordan": {
    id: "customer-jordan",
    displayName: "Jordan Lee",
    email: "jordan.lee@example.test",
    phone: "+420 700 000 202",
  },
  "customer-sam": {
    id: "customer-sam",
    displayName: "Sam Taylor",
    email: "sam.taylor@example.test",
    phone: null,
  },
} as const;

const makeReservations = (): readonly AdministrationReservationSummary[] => {
  const currentDate = today();
  const yesterday = currentDate.subtract({ days: 1 });
  const tomorrow = currentDate.add({ days: 1 });
  const lastWeek = currentDate.subtract({ days: 7 });
  return [
    {
      id: "0198-admin-fixture-attention",
      customerId: fixtureCustomers["customer-alex"].id,
      customer: fixtureCustomers["customer-alex"],
      liveDetailsAvailable: true,
      startsAt: atTime(currentDate, 14),
      endsAt: atTime(currentDate, 16),
      date: currentDate.toString(),
      type: "meeting-room",
      typeLabel: "Meeting Room",
      status: { group: "attention", label: "Confirmation issue" },
      updatedAt: atTime(currentDate, 10),
    },
    {
      id: "0198-admin-fixture-pending",
      customerId: fixtureCustomers["customer-jordan"].id,
      customer: fixtureCustomers["customer-jordan"],
      liveDetailsAvailable: true,
      startsAt: atTime(currentDate, 9),
      endsAt: atTime(currentDate, 18),
      date: currentDate.toString(),
      type: "cowork",
      typeLabel: "Cowork Profi",
      status: { group: "in_progress", label: "Payment pending" },
      updatedAt: atTime(currentDate, 9),
    },
    {
      id: "0198-admin-fixture-confirming",
      customerId: fixtureCustomers["customer-sam"].id,
      customer: fixtureCustomers["customer-sam"],
      liveDetailsAvailable: true,
      startsAt: atTime(tomorrow, 10),
      endsAt: atTime(tomorrow, 17),
      date: tomorrow.toString(),
      type: "cowork",
      typeLabel: "Cowork Plus",
      status: { group: "in_progress", label: "Confirming" },
      updatedAt: atTime(yesterday, 17),
    },
    {
      id: "0198-admin-fixture-complete",
      customerId: fixtureCustomers["customer-alex"].id,
      customer: fixtureCustomers["customer-alex"],
      liveDetailsAvailable: true,
      startsAt: atTime(lastWeek, 9),
      endsAt: atTime(lastWeek, 18),
      date: lastWeek.toString(),
      type: "cowork",
      typeLabel: "Cowork Basic",
      status: { group: "complete", label: "Complete" },
      updatedAt: atTime(lastWeek, 8),
    },
    {
      id: "0198-admin-fixture-cancelled",
      customerId: fixtureCustomers["customer-jordan"].id,
      customer: fixtureCustomers["customer-jordan"],
      liveDetailsAvailable: true,
      startsAt: atTime(yesterday, 13),
      endsAt: atTime(yesterday, 15),
      date: yesterday.toString(),
      type: "meeting-room",
      typeLabel: "Meeting Room",
      status: { group: "cancelled", label: "Cancelled" },
      updatedAt: atTime(yesterday, 8),
    },
  ];
};

export const administrationFixturesEnabled = () =>
  process.env.NODE_ENV === "development" &&
  env.ADMIN_PREVIEW_FIXTURES === "true";

export const loadFixtureReservations = (
  input: AdministrationReservationListInput
) => {
  const items = makeReservations().filter(
    (reservation) =>
      (!input.customerId || reservation.customerId === input.customerId) &&
      (!input.status || reservation.status.group === input.status) &&
      (!input.type || reservation.type === input.type) &&
      (!input.date || reservation.date === input.date)
  );
  return {
    items,
    page: 1,
    pageCount: 1,
    total: items.length,
    dateFilterUnavailable: false,
  };
};

export const loadFixtureOverview = () => {
  const reservations = makeReservations();
  const currentDate = today().toString();
  return {
    counts: {
      reservations: reservations.length,
      customers: Object.keys(fixtureCustomers).length,
    },
    today: reservations.filter(({ date }) => date === currentDate),
    todayUnavailable: false,
    recent: reservations.slice(0, 4),
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
  return {
    reservation,
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
        id: "fixture-paid",
        title: "Payment received",
        description: "The reservation payment completed.",
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
        id: "fixture-payment",
        providerLabel: "Online payment",
        stateLabel: "Paid",
        amount: { value: 240000, exponent: 2, currency: "CZK" },
        createdAt: Temporal.Instant.from(paidAt)
          .subtract({ minutes: 3 })
          .toString(),
        updatedAt: paidAt,
      },
    ],
    discounts: [
      {
        id: "fixture-discount",
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
      dotyposReservationId: `live-${reservation.id}`,
      customerId: reservation.customerId,
    },
  };
};

export const loadFixtureCustomers = () => {
  const reservations = makeReservations();
  const items: AdministrationCustomerSummary[] = Object.values(
    fixtureCustomers
  ).map((customer) => {
    const customerReservations = reservations.filter(
      (reservation) => reservation.customerId === customer.id
    );
    return {
      customer,
      customerId: customer.id,
      reservationCount: customerReservations.length,
      lastActivityAt:
        customerReservations[0]?.updatedAt ?? Temporal.Now.instant().toString(),
    };
  });
  return { items, page: 1, pageCount: 1, total: items.length };
};

export const loadFixtureCustomerReservations = (
  customerId: string,
  page = 1
) => {
  const items = makeReservations().filter(
    (reservation) => reservation.customerId === customerId
  );
  return { items, page, pageCount: 1, total: items.length };
};

export const loadFixtureCustomerProfile = (
  customerId: string
): AdminCustomerProfile | null => {
  const customer = Object.values(fixtureCustomers).find(
    (item) => item.id === customerId
  );
  if (!customer) return null;
  return {
    customer: {
      ...customer,
      id: customer.id as DotyposCustomerId,
      discountGroupId: null,
    },
    discountGroups: [
      { id: "fixture-standard", name: "Workspace member", basisPoints: 1000 },
    ],
    codes: [],
    claims: [],
  };
};
