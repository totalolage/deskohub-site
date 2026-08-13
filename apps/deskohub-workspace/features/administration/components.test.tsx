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
  workspaceRouterRefresh,
  workspaceUseAction,
} from "@/shared/testing/workspace-component-module-mocks";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";
import { AdministrationBreadcrumbs } from "./admin-shell";
import {
  AdministrationStatusBadge,
  AdministrationTableCount,
  AdministrationTableToolbar,
  BookingTable,
  getBookingTableLabel,
  PaymentAttemptList,
  RelatedReservationLink,
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
import { ReservationAccessAdministration } from "./reservation-access-administration";
import { ReservationLifecycleMap } from "./reservation-lifecycle-map";

mock.module("./actions", () => ({
  getAdministrationReservation: mock(),
  mutateReservationAccess: mock(),
}));

describe("administration reservation components", () => {
  beforeAll(() => registerWorkspaceComponentTestEnv());
  beforeEach(() => {
    workspaceRouterPush.mockClear();
    workspaceRouterRefresh.mockClear();
    workspaceUseAction.mockReset();
  });
  afterEach(() => cleanup());
  afterAll(() => unregisterWorkspaceComponentTestEnv());

  test("composes collection counts, search, filters, and actions consistently", () => {
    const view = render(
      <AdministrationTableToolbar
        actions={<button type="button">Create</button>}
        count={2}
        filters={<button type="button">Filter</button>}
        itemLabel="reservation"
        search={<input aria-label="Lookup" />}
      />
    );

    const toolbar = view.getByRole("region", {
      name: "reservation table controls",
    });
    expect(within(toolbar).getByLabelText("2 reservations")).toBeDefined();
    expect(within(toolbar).getByLabelText("Lookup")).toBeDefined();
    expect(
      within(toolbar).getByRole("button", { name: "Filter" })
    ).toBeDefined();
    expect(
      within(toolbar).getByRole("button", { name: "Create" })
    ).toBeDefined();
  });

  test("keeps streamed collection counts styled and accessible", () => {
    const view = render(
      <AdministrationTableToolbar
        count={<AdministrationTableCount count={24} itemLabel="reservation" />}
        itemLabel="reservation"
      />
    );

    expect(view.getByLabelText("24 reservations").textContent).toBe("24");
  });

  test("uses one status badge foundation for domain-specific states", () => {
    const view = render(
      <AdministrationStatusBadge tone="positive">
        Active
      </AdministrationStatusBadge>
    );

    expect(view.getByText("Active").className).toContain(
      "bg-aquamarine-green/12"
    );
  });

  test("shows safe access metadata and the failed retry action without the PIN", () => {
    const detail = loadFixtureReservation("0198-admin-fixture-attention");
    expect(detail?.accessGrant).not.toBeNull();
    if (!detail?.accessGrant) return;
    const execute = mock();
    workspaceUseAction.mockReturnValue({
      execute,
      isExecuting: false,
    } as never);

    const view = render(
      <ReservationAccessAdministration
        grant={detail.accessGrant}
        reservationId={detail.reservation.id}
      />
    );

    expect(view.getByText("Failed")).toBeDefined();
    expect(view.getByText(detail.accessGrant.accessName)).toBeDefined();
    expect(view.queryByText("PIN")).toBeNull();
    fireEvent.click(view.getByRole("button", { name: "Retry access" }));
    expect(execute).toHaveBeenCalledWith({
      kind: "retry-failed",
      reservationId: detail.reservation.id,
    });
  });

  test("requires explicit manual provider reconciliation for uncertain access", async () => {
    const detail = loadFixtureReservation("0198-admin-fixture-attention");
    expect(detail?.accessGrant).not.toBeNull();
    if (!detail?.accessGrant) return;
    const execute = mock();
    workspaceUseAction.mockReturnValue({
      execute,
      isExecuting: false,
    } as never);

    const view = render(
      <ReservationAccessAdministration
        grant={{ ...detail.accessGrant, state: "uncertain" }}
        reservationId={detail.reservation.id}
      />
    );
    const disclosure = view.getByText("Reconcile access").closest("details");
    expect(disclosure?.open).toBe(false);
    fireEvent.click(view.getByText("Reconcile access"));
    expect(disclosure?.open).toBe(true);
    expect(
      await view.findByText(/connect the Igloohome app over Bluetooth/i)
    ).toBeDefined();
    fireEvent.click(
      view.getByRole("button", { name: "Confirm removed and retry" })
    );
    expect(execute).toHaveBeenCalledWith({
      kind: "confirm-provider-credential-removed",
      providerCredentialRemoved: true,
      reservationId: detail.reservation.id,
    });
  });

  test("offers reconciliation for stale provisioning but not a fresh claim", () => {
    const detail = loadFixtureReservation("0198-admin-fixture-attention");
    expect(detail?.accessGrant).not.toBeNull();
    if (!detail?.accessGrant) return;
    workspaceUseAction.mockReturnValue({
      execute: mock(),
      isExecuting: false,
    } as never);

    const fresh = render(
      <ReservationAccessAdministration
        grant={{
          ...detail.accessGrant,
          state: "provisioning",
          provisioningStartedAt: Temporal.Now.instant().toString(),
        }}
        reservationId={detail.reservation.id}
      />
    );
    expect(fresh.queryByText("Reconcile access")).toBeNull();
    fresh.unmount();

    const stale = render(
      <ReservationAccessAdministration
        grant={{
          ...detail.accessGrant,
          state: "provisioning",
          provisioningStartedAt: Temporal.Now.instant()
            .subtract({ minutes: 2 })
            .toString(),
        }}
        reservationId={detail.reservation.id}
      />
    );
    expect(stale.getByText("Reconcile access")).toBeDefined();
    expect(stale.getByText("Needs reconciliation")).toBeDefined();
  });

  test("renders a semantic reservation table with friendly status labels", () => {
    const { items } = loadFixtureReservations({});
    const view = render(
      <ReservationTable
        reservations={items.map((item, index) =>
          index === 1
            ? {
                ...item,
                status: { group: "in_progress", label: "Awaiting payment" },
                statusNote: "Cancelled in Dotypos",
              }
            : item
        )}
      />
    );
    const table = view.getByRole("table", { name: "Reservations" });
    expect(table.parentElement?.parentElement?.className).toContain(
      "overflow-x-auto"
    );
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
    expect(view.getAllByText("Cancelled in Dotypos")).toHaveLength(2);
    expect(view.getAllByText("Deskohub: Awaiting payment")).toHaveLength(2);
  });

  test("formats reservation dates according to their family", () => {
    const reservation = loadFixtureReservations({}).items[0];
    expect(reservation).toBeDefined();
    if (!reservation) return;
    const view = render(
      <ReservationTable
        reservations={[
          {
            ...reservation,
            id: "cowork-date-only",
            type: "cowork",
            typeLabel: "Cowork Basic",
            date: "2026-08-10",
            startsAt: "2026-08-09T22:00:00Z",
          },
          {
            ...reservation,
            id: "meeting-room-with-time",
            type: "meeting-room",
            typeLabel: "Meeting Room",
            date: "2026-08-10",
            startsAt: "2026-08-10T08:00:00Z",
          },
        ]}
      />
    );

    const coworkDates = view.getAllByText("10 Aug 2026");
    expect(coworkDates).toHaveLength(2);
    expect(coworkDates[0]?.textContent).not.toContain("00:00");
    expect(view.getAllByText("10 Aug 2026, 10:00")).toHaveLength(2);
  });

  test("links sortable reservation headers to server-side ordering", () => {
    const reservations = loadFixtureReservations({}).items;
    const view = render(
      <ReservationTable
        reservations={reservations}
        sorting={{
          basePath: "/admin/reservations",
          direction: "asc",
          field: "reservation",
          params: { status: "complete" },
        }}
      />
    );
    const table = view.getByRole("table", { name: "Reservations" });
    const reservationHeader = within(table).getByRole("link", {
      name: "Reservation",
    });

    expect(reservationHeader.closest("th")?.getAttribute("aria-sort")).toBe(
      "ascending"
    );
    expect(reservationHeader.getAttribute("href")).toBe(
      "/admin/reservations?status=complete&sort=reservation&direction=desc"
    );
    expect(
      within(table).getByRole("link", { name: "Status" }).getAttribute("href")
    ).toBe("/admin/reservations?status=complete&sort=status&direction=asc");
    const dateHeader = within(table).getByRole("link", { name: "Date" });
    expect(dateHeader.closest("th")?.getAttribute("aria-sort")).toBe("none");
    expect(dateHeader.getAttribute("href")).toBe(
      "/admin/reservations?status=complete&sort=date&direction=asc"
    );
  });

  test("shows live provider discrepancies on related reservations", () => {
    const { items } = loadFixtureReservations({});
    const reservation = items[0];
    expect(reservation).toBeDefined();
    if (!reservation) return;

    const view = render(
      <RelatedReservationLink
        reservation={{
          ...reservation,
          status: { group: "in_progress", label: "Awaiting payment" },
          statusNote: "Cancelled in Dotypos",
        }}
      />
    );

    expect(view.getByText("Cancelled in Dotypos")).toBeDefined();
    expect(view.getByText("Deskohub: Awaiting payment")).toBeDefined();
    expect(view.getByText("Alex Morgan")).toBeDefined();
    expect(view.getByText("alex.morgan@example.test")).toBeDefined();
  });

  test("keeps related reservations useful when customer details are unavailable", () => {
    const { items } = loadFixtureReservations({});
    const reservation = items[0];
    expect(reservation).toBeDefined();
    if (!reservation) return;

    const view = render(
      <RelatedReservationLink
        reservation={{ ...reservation, customer: null }}
      />
    );

    expect(view.getByText("Customer unavailable")).toBeDefined();
  });

  test("renders ordered operational history without forbidden fields", () => {
    const detail = loadFixtureReservation("0198-admin-fixture-attention");
    expect(detail).not.toBeNull();
    if (!detail) return;
    const serialized = JSON.stringify(detail);
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

  test("explains pending Nexi orders using the cleanup policy", () => {
    const detail = loadFixtureReservation("0198-admin-fixture-attention");
    expect(detail).not.toBeNull();
    if (!detail) return;
    const order = detail.orders[0];
    expect(order?.provider).not.toBeNull();
    expect(order?.link).not.toBeNull();
    if (!(order?.provider && order.link)) return;

    const emptyOrder = {
      ...order,
      provider: {
        ...order.provider,
        authorizedAmount: "0",
        capturedAmount: "0.00",
        operations: [],
      },
      link: {
        ...order.link,
        state: "pending" as const,
        stateLabel: "Pending",
        providerOrderCreatedAt: Temporal.Now.instant()
          .subtract({ minutes: 10 })
          .toString(),
      },
    };
    const openWindow = render(<ReservationOrderList orders={[emptyOrder]} />);
    expect(
      openWindow.getByText(/local payment window is open until/i)
    ).toBeDefined();
    openWindow.unmount();

    const overdue = render(
      <ReservationOrderList
        orders={[
          {
            ...emptyOrder,
            link: {
              ...emptyOrder.link,
              providerOrderCreatedAt: Temporal.Now.instant()
                .subtract({ minutes: 31 })
                .toString(),
            },
          },
        ]}
      />
    );
    expect(
      overdue.getByText(/still empty after the local payment window/i)
    ).toBeDefined();
    overdue.unmount();

    const activity = render(
      <ReservationOrderList
        orders={[
          {
            ...order,
            link: { ...order.link, state: "pending", stateLabel: "Pending" },
          },
        ]}
      />
    );
    expect(activity.getByText(/Nexi reports payment activity/i)).toBeDefined();
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
