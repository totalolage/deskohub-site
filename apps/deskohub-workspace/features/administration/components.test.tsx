import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  mock,
  test,
} from "bun:test";
import { cleanup, fireEvent, render, within } from "@testing-library/react";
import {
  workspaceRouterPush,
  workspaceUseAction,
} from "@/shared/testing/workspace-component-module-mocks";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";
import { AdministrationBreadcrumbs } from "./admin-shell";
import {
  BookingTable,
  getBookingTableLabel,
  PaymentAttemptList,
  ReservationReferences,
  ReservationTable,
  ReservationTimeline,
} from "./components";
import {
  loadFixtureBookings,
  loadFixtureReservation,
  loadFixtureReservations,
} from "./fixtures";
import {
  OperationTable,
  OrderTable,
  ProviderStatusBadge,
  ReservationOrderList,
} from "./payment-components";
import { ReservationLifecycleMap } from "./reservation-lifecycle-map";

mock.module("./actions", () => ({
  getAdministrationReservation: mock(),
}));

describe("administration reservation components", () => {
  beforeAll(() => registerWorkspaceComponentTestEnv());
  beforeEach(() => {
    workspaceRouterPush.mockClear();
    workspaceUseAction.mockReset();
  });
  afterEach(() => cleanup());
  afterAll(() => unregisterWorkspaceComponentTestEnv());

  test("renders a semantic reservation table with friendly status labels", () => {
    const { items } = loadFixtureReservations({});
    const view = render(<ReservationTable reservations={items} />);
    const table = view.getByRole("table", { name: "Reservations" });
    expect(within(table).getAllByText("Confirmation issue")).not.toHaveLength(
      0
    );
    const reservationLink = within(table)
      .getAllByRole("link")
      .find(
        (link) =>
          link.getAttribute("href") ===
          "/admin/reservations/0198-admin-fixture-attention"
      );
    expect(reservationLink?.className).toContain("before:absolute");
    expect(
      within(table)
        .getByRole("link", {
          name: "Payment ORDER-0198-admin-fixture-attention (opens in XPay)",
        })
        .getAttribute("href")
    ).toBe(
      "https://xpaydashboard.nexigroup.com/nexi/ordermanagement/order/ORDER-0198-admin-fixture-attention"
    );
    expect(
      view.getAllByRole("link", {
        name: "Payment ORDER-0198-admin-fixture-attention (opens in XPay)",
      })
    ).toHaveLength(2);
  });

  test("renders ordered operational history without forbidden fields", () => {
    const detail = loadFixtureReservation("0198-admin-fixture-attention");
    expect(detail).not.toBeNull();
    if (!detail) return;
    const serialized = JSON.stringify(detail);
    expect(serialized).not.toContain("customerAccessCode");
    expect(serialized).not.toContain("securityToken");
    expect(serialized).not.toContain("providerRedirectUrl");
    expect(serialized).not.toContain("rawPayload");

    const view = render(<ReservationTimeline items={detail.timeline} />);
    const timeline = view.getByRole("list", {
      name: "Reservation history",
    });
    expect(within(timeline).getAllByRole("listitem")).toHaveLength(7);
    expect(within(timeline).getByText("Payment started")).toBeDefined();
    expect(
      within(timeline)
        .getByRole("link", { name: "Nexi order created" })
        .getAttribute("href")
    ).toBe("#order-DADMINFIXTUREPAYMENT");
    expect(
      within(timeline)
        .getByRole("link", { name: "Payment executed by Nexi" })
        .getAttribute("href")
    ).toBe("#operation-DADMINFIXTUREOPERATION");
  });

  test("links Nexi payment IDs directly to the XPay dashboard", () => {
    const detail = loadFixtureReservation("0198-admin-fixture-attention");
    expect(detail).not.toBeNull();
    if (!detail) return;
    const attempt = detail.paymentAttempts[0];
    expect(attempt).toBeDefined();
    if (!attempt) return;

    const view = render(
      <PaymentAttemptList
        attempts={[
          ...detail.paymentAttempts,
          {
            ...attempt,
            id: "fixture-internal-payment",
            providerOrderId: null,
            providerLabel: "Included",
          },
        ]}
      />
    );
    const orderLink = view.getByRole("link", {
      name: "Nexi order DADMINFIXTUREPAYMENT (opens in XPay)",
    });
    expect(orderLink.getAttribute("href")).toBe(
      "https://xpaydashboard.nexigroup.com/nexi/ordermanagement/order/DADMINFIXTUREPAYMENT"
    );
    expect(orderLink.getAttribute("target")).toBe("_blank");
    expect(view.getAllByText("Nexi order")).toHaveLength(1);
  });

  test("folds Nexi orders and operations into the reservation", () => {
    const detail = loadFixtureReservation("0198-admin-fixture-attention");
    expect(detail).not.toBeNull();
    if (!detail) return;

    const view = render(<ReservationOrderList orders={detail.orders} />);
    expect(
      view
        .getByRole("link", {
          name: "Nexi order DADMINFIXTUREPAYMENT (opens in XPay)",
        })
        .getAttribute("href")
    ).toBe(
      "https://xpaydashboard.nexigroup.com/nexi/ordermanagement/order/DADMINFIXTUREPAYMENT"
    );
    expect(view.getByText("DADMINFIXTUREOPERATION")).toBeDefined();
    expect(view.container.querySelector('a[href^="/admin/orders"]')).toBeNull();
    expect(
      view.container.querySelector('a[href^="/admin/operations"]')
    ).toBeNull();
  });

  test("marks the actual lifecycle stage accessibly", () => {
    const detail = loadFixtureReservation("0198-admin-fixture-attention");
    expect(detail).not.toBeNull();
    if (!detail) return;

    const view = render(
      <ReservationLifecycleMap lifecycle={detail.lifecycle} />
    );
    expect(
      view.getByText("Paid").closest('[aria-current="step"]')
    ).not.toBeNull();
    expect(view.getByText("Confirmation issue")).toBeDefined();
    expect(
      view
        .getByText("Cancelled")
        .compareDocumentPosition(view.getByText("Paid")) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).not.toBe(0);
  });

  test("links order and operation entities back to their reservation", () => {
    const detail = loadFixtureReservation("0198-admin-fixture-attention");
    expect(detail).not.toBeNull();
    if (!detail) return;
    const orderView = render(<OrderTable orders={detail.orders} />);
    expect(
      orderView
        .getByRole("link", { name: "DADMINFIXTUREPAYMENT" })
        .getAttribute("href")
    ).toBe("/admin/orders/DADMINFIXTUREPAYMENT");
    expect(
      orderView
        .getByRole("link", { name: "View reservation" })
        .getAttribute("href")
    ).toBe("/admin/reservations/0198-admin-fixture-attention");
    orderView.unmount();

    const operation = detail.orders[0]?.provider?.operations[0];
    expect(operation).toBeDefined();
    if (!operation) return;
    const operationView = render(
      <OperationTable
        operations={[
          {
            ...operation,
            linkedReservationId: detail.reservation.id,
          },
        ]}
      />
    );
    expect(
      operationView
        .getByRole("link", { name: "DADMINFIXTUREOPERATION" })
        .getAttribute("href")
    ).toBe("/admin/operations/DADMINFIXTUREOPERATION");
    expect(
      operationView
        .getByRole("link", { name: "DADMINFIXTUREPAYMENT" })
        .getAttribute("href")
    ).toBe("/admin/orders/DADMINFIXTUREPAYMENT");
  });

  test("renders both Nexi cancellation spellings as warnings", () => {
    const view = render(<ProviderStatusBadge value="CANCELLED" />);
    expect(view.getByText("Cancelled").className).toContain(
      "bg-burned-orange/10"
    );
  });

  test("keeps the customer visible when booking details are unavailable", () => {
    const { items } = loadFixtureReservations({});
    const reservation = items[0];
    expect(reservation).toBeDefined();
    if (!reservation) return;

    const view = render(
      <ReservationTable
        reservations={[
          {
            ...reservation,
            liveDetailsAvailable: false,
            startsAt: null,
            endsAt: null,
            date: null,
          },
        ]}
      />
    );

    expect(view.getAllByText("Alex Morgan")).not.toHaveLength(0);
    expect(view.queryByText("Details unavailable")).toBeNull();
  });

  test("distinguishes an unassigned table from unavailable table details", () => {
    expect(getBookingTableLabel(null)).toBe("Unavailable");
    expect(
      getBookingTableLabel({ tableId: "dotypos-table", tableName: null })
    ).toBe("Details unavailable");
    expect(getBookingTableLabel({ tableId: null, tableName: null })).toBe(
      "Not assigned"
    );
    expect(
      getBookingTableLabel({
        tableId: "dotypos-table",
        tableName: "Meeting room",
      })
    ).toBe("Meeting room");
  });

  test("links reservation references to their related entities", () => {
    const view = render(
      <ReservationReferences
        references={{
          workspaceReservationId: "workspace-reservation",
          dotyposReservationId: "dotypos-booking",
          customerId: "dotypos-customer",
        }}
      />
    );

    expect(
      view.getByRole("link", { name: "dotypos-customer" }).getAttribute("href")
    ).toBe("/admin/customers/dotypos-customer");
    expect(view.getByText("dotypos-booking")).toBeDefined();
    expect(view.queryByRole("link", { name: "dotypos-booking" })).toBeNull();
  });

  test("renders Dotypos bookings with linked customers and reservations", () => {
    const view = render(
      <BookingTable bookings={loadFixtureBookings().items} />
    );
    const table = view.getByRole("table", { name: "Bookings" });

    expect(within(table).getByText("Table 4")).toBeDefined();
    expect(
      within(table)
        .getAllByRole("link", { name: "Alex Morgan" })[0]
        ?.getAttribute("href")
    ).toBe("/admin/customers/customer-alex");
    expect(
      within(table)
        .getByRole("link", { name: "Cowork Basic" })
        .getAttribute("href")
    ).toBe("/admin/reservations/0198-admin-fixture-complete");
  });

  test("identifies customer and reservation entities in breadcrumbs", () => {
    const view = render(
      <AdministrationBreadcrumbs
        entityLabel="Ada Lovelace"
        segments={["admin", "customers", "customer-ada"]}
      />
    );
    expect(view.getByText("Ada Lovelace")).toBeDefined();

    view.rerender(
      <AdministrationBreadcrumbs
        entityLabel="Cowork Basic"
        segments={["admin", "reservations", "reservation-basic"]}
      />
    );
    expect(view.getByText("Cowork Basic")).toBeDefined();
  });

  test("gets one reservation from any associated unique ID", async () => {
    const execute = mock();
    let onSuccess:
      | ((result: {
          readonly data?: { readonly reservationId: string | null };
        }) => void)
      | undefined;
    workspaceUseAction.mockImplementation((_action, options) => {
      onSuccess = (
        options as {
          readonly onSuccess?: (result: {
            readonly data?: { readonly reservationId: string | null };
          }) => void;
        }
      ).onSuccess;
      return { execute, isExecuting: false };
    });
    const { ReservationLookup } = await import("./reservation-lookup");
    const view = render(<ReservationLookup />);

    fireEvent.input(
      view.getByRole("searchbox", { name: "Reservation or payment ID" }),
      { target: { value: "  payment-123  " } }
    );
    fireEvent.submit(view.getByRole("button", { name: "Get reservation" }));

    expect(execute).toHaveBeenCalledWith({ identifier: "payment-123" });
    onSuccess?.({ data: { reservationId: "reservation-456" } });
    expect(workspaceRouterPush).toHaveBeenCalledWith(
      "/admin/reservations/reservation-456"
    );
  });
});
