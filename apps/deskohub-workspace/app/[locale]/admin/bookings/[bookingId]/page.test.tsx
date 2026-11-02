import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  mock,
  test,
} from "bun:test";
import {
  DotyposCustomerIdSchema,
  DotyposReservationIdSchema,
} from "@deskohub/dotypos";
import { testEmailAddress } from "@deskohub/test-email";
import { within } from "@testing-library/react";
import { prerender } from "react-dom/static";
import type {
  AdministrationBookingDetail,
  AdministrationBookingSummary,
} from "@/features/administration/administration.service";
import { RouteLocaleProvider } from "@/features/i18n/route-locale";
import { workspaceReservationIdSchema } from "@/features/reservation/persistence-contracts";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";

mock.module("server-only", () => ({}));
mock.module("next/root-params", () => ({
  locale: () => Promise.resolve("en-US"),
}));

const customerId = DotyposCustomerIdSchema.make("1001");
const reservationId = workspaceReservationIdSchema.make("reservation-1");
const customerEmail = testEmailAddress("ada");

const fullBooking: AdministrationBookingSummary = {
  id: DotyposReservationIdSchema.make("booking-1"),
  customerId,
  customer: {
    id: customerId,
    displayName: "Ada Lovelace",
    hasName: true,
    email: customerEmail,
    phone: "+420 111 222 333",
  },
  startsAt: "2026-08-12T08:00:00.000Z",
  endsAt: "2026-08-12T16:00:00.000Z",
  seats: "2",
  status: "CONFIRMED",
  statusLabel: "Confirmed",
  tableId: null,
  tableName: "Window desk",
  tableLocation: "Ground floor",
  linkedReservation: {
    id: reservationId,
    label: "Cowork",
    product: { kind: "meeting-room" },
  },
  createdAt: "2026-08-01T08:00:00.000Z",
  updatedAt: "2026-08-02T08:00:00.000Z",
};

const bareBooking: AdministrationBookingSummary = {
  ...fullBooking,
  customerId: null,
  customer: null,
  tableName: null,
  tableLocation: null,
  linkedReservation: null,
  createdAt: null,
  updatedAt: null,
};

const fullDetail: AdministrationBookingDetail = {
  booking: fullBooking,
  references: {
    bookingId: fullBooking.id,
    customerId,
    workspaceReservationId: reservationId,
  },
};

let detail: AdministrationBookingDetail = fullDetail;
const administrationPageData = await import(
  "@/features/administration/page-data.server"
);
mock.module("@/features/administration/page-data.server", () => ({
  ...administrationPageData,
  loadAdministrationBooking: () => Promise.resolve(detail),
}));

async function prerenderBookingDetail() {
  const { BookingAdministrationDetail } = await import("./page");
  const { prelude } = await prerender(
    <RouteLocaleProvider locale="en-US">
      <BookingAdministrationDetail
        locale="en-US"
        params={Promise.resolve({ bookingId: "booking-1" })}
      />
    </RouteLocaleProvider>,
    { progressiveChunkSize: Number.POSITIVE_INFINITY }
  );
  const container = document.createElement("div");
  container.innerHTML = await new Response(prelude).text();
  return container;
}

const linksTo = (container: HTMLElement, path: string) =>
  [...container.querySelectorAll("a")].filter((link) =>
    link.getAttribute("href")?.endsWith(path)
  );

const factCount = (container: HTMLElement) =>
  container.querySelectorAll("section dl dt").length;

describe("BookingAdministrationDetail", () => {
  beforeAll(() => registerWorkspaceComponentTestEnv());
  afterEach(() => {
    detail = fullDetail;
  });
  afterAll(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await unregisterWorkspaceComponentTestEnv();
  });

  test("names the booking by its table and links its customer and reservation", async () => {
    const container = await prerenderBookingDetail();
    const view = within(container);

    expect(view.getByRole("heading", { level: 1 }).textContent).toBe(
      "Window desk"
    );
    expect(view.getAllByText("Ground floor")).not.toHaveLength(0);
    // The reference list and the related-entity card both link each record.
    expect(linksTo(container, `/admin/customers/${customerId}`)).toHaveLength(
      2
    );
    expect(
      linksTo(container, `/admin/reservations/${reservationId}`)
    ).toHaveLength(2);
    expect(view.getByText("Ada Lovelace")).toBeDefined();
    expect(view.getByText(customerEmail)).toBeDefined();
  });

  test("falls back to the phone when the customer has no email", async () => {
    detail = {
      ...fullDetail,
      booking: {
        ...fullBooking,
        customer: { ...fullBooking.customer!, email: null },
      },
    };
    const view = within(await prerenderBookingDetail());

    expect(view.getByText("+420 111 222 333")).toBeDefined();
    expect(view.queryByText(customerEmail)).toBeNull();
  });

  test("shows only the facts and references a bare booking has", async () => {
    const full = await prerenderBookingDetail();
    detail = {
      booking: bareBooking,
      references: {
        bookingId: bareBooking.id,
        customerId: null,
        workspaceReservationId: null,
      },
    };
    const bare = await prerenderBookingDetail();
    const view = within(bare);

    expect(view.getByRole("heading", { level: 1 }).textContent).not.toBe(
      "Window desk"
    );
    expect(view.queryByText("Ground floor")).toBeNull();
    expect(factCount(full) - factCount(bare)).toBe(2);
    expect(bare.querySelectorAll("details dd")).toHaveLength(1);
    expect(full.querySelectorAll("details dd")).toHaveLength(3);
    expect(linksTo(bare, `/admin/customers/${customerId}`)).toHaveLength(0);
    expect(linksTo(bare, `/admin/reservations/${reservationId}`)).toHaveLength(
      0
    );
  });
});
