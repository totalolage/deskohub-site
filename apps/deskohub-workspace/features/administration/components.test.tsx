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
import { NexiOrderIdSchema } from "@deskohub/nexi";
import { testEmailAddress } from "@deskohub/test-email";
import {
  act,
  cleanup,
  fireEvent,
  render,
  within,
} from "@testing-library/react";
import {
  workspaceRouterPush,
  workspaceRouterRefresh,
  workspaceUseAction,
} from "@/shared/testing/workspace-component-module-mocks";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";
import {
  formatAdministrationDateTime,
  PaymentAttemptList,
  RelatedReservationLink,
  ReservationTable,
} from "./components";
import { loadFixtureReservation, loadFixtureReservations } from "./fixtures";
import { ReservationOrderList } from "./payment-components";
import { OrderTable } from "./payment-tables";
import { ReservationAccessAdministration } from "./reservation-access-administration";

/** Text content with the formatter's non-breaking spaces as plain spaces. */
const readableText = (element: Element | null | undefined) =>
  element?.textContent?.replace(/\s+/g, " ");

mock.module("./actions", () => ({
  getAdministrationReservation: mock(),
  mutateReservationAccess: mock(),
}));
mock.module("next/navigation", () => ({
  useParams: () => ({ locale: "en-US" }),
  useRouter: () => ({
    push: workspaceRouterPush,
    refresh: workspaceRouterRefresh,
  }),
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
    expect(within(table).getAllByText("Confirmation issue")).not.toHaveLength(
      0
    );
    expect(
      within(table)
        .getAllByRole("link")
        .map((link) => link.getAttribute("href"))
    ).toContain("/en-US/admin/reservations/0198-admin-fixture-attention");
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

    const coworkDates = view.getAllByText("Aug 10, 2026");
    expect(coworkDates).toHaveLength(2);
    expect(coworkDates[0]?.textContent).not.toContain("00:00");
    expect(view.getAllByText(/Aug 10, 2026, 10:00/)).toHaveLength(2);
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
      "/en-US/admin/reservations?status=complete&sort=reservation&direction=desc"
    );
    expect(
      within(table).getByRole("link", { name: "Status" }).getAttribute("href")
    ).toBe(
      "/en-US/admin/reservations?status=complete&sort=status&direction=asc"
    );
    const dateHeader = within(table).getByRole("link", { name: "Date" });
    expect(dateHeader.closest("th")?.getAttribute("aria-sort")).toBe("none");
    expect(dateHeader.getAttribute("href")).toBe(
      "/en-US/admin/reservations?status=complete&sort=date&direction=asc"
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
    expect(view.getByText(testEmailAddress("alex.morgan"))).toBeDefined();
  });

  test("shows a recorded refund instead of the refund requirement", () => {
    const detail = loadFixtureReservation("0198-admin-fixture-attention");
    const attempt = detail?.paymentAttempts[0];
    expect(attempt).toBeDefined();
    if (!attempt) return;
    const refundedAt = "2026-10-05T08:30:00Z";

    const view = render(
      <PaymentAttemptList
        attempts={[
          {
            ...attempt,
            refundState: "refunded",
            refundedAmount: attempt.amount,
            refundedAt,
          },
          {
            ...attempt,
            id: "fixture-partially-refunded-payment",
            refundState: "refunded",
            refundedAmount: { ...attempt.amount, value: 100_000 },
            refundedAt,
          },
        ]}
      />
    );

    const recordedAt = formatAdministrationDateTime(refundedAt, "en-US");
    expect(view.queryByText("Needs refund")).toBeNull();
    expect(view.queryByText(/Paid/)).toBeNull();
    expect(view.getByText(`Refunded · ${recordedAt}`)).toBeDefined();
    expect(
      view.getByText(`Partially refunded CZK 1,000 · ${recordedAt}`)
    ).toBeDefined();
    expect(
      [...view.container.querySelectorAll("del")].map(readableText)
    ).toEqual(["CZK 2,400 refunded", "CZK 2,400 before refund"]);
    expect(view.getByText("CZK 1,400", { exact: false })).toBeDefined();
  });

  test("crosses out a refunded payment in the reservation list", () => {
    const { items } = loadFixtureReservations({});
    const [refunded, partiallyRefunded, paid] = items.filter(
      ({ latestPayment }) => latestPayment
    );
    if (
      !refunded?.latestPayment ||
      !partiallyRefunded?.latestPayment ||
      !paid?.latestPayment
    ) {
      throw new Error("Expected three fixture reservations with payments");
    }
    const refundedAt = "2026-10-12T09:00:00Z";
    const view = render(
      <ReservationTable
        reservations={[
          {
            ...refunded,
            latestPayment: {
              ...refunded.latestPayment,
              refundState: "refunded",
              refundedAmount: refunded.latestPayment.amount,
              refundedAt,
            },
          },
          {
            ...partiallyRefunded,
            latestPayment: {
              ...partiallyRefunded.latestPayment,
              refundState: "refunded",
              refundedAmount: {
                ...partiallyRefunded.latestPayment.amount,
                value: 10_000,
              },
              refundedAt,
            },
          },
          paid,
        ]}
      />
    );

    const table = view.getByRole("table", { name: "Reservations" });
    const [refundedRow, partiallyRefundedRow, paidRow] = within(table)
      .getAllByRole("row")
      .slice(1);
    const recordedAt = formatAdministrationDateTime(refundedAt, "en-US");

    expect(refundedRow?.textContent).not.toContain("Paid");
    expect(
      within(refundedRow as HTMLElement).getByText(`Refunded · ${recordedAt}`)
    ).toBeDefined();
    expect(readableText(refundedRow?.querySelector("del"))).toBe(
      "CZK 275 refunded"
    );

    expect(partiallyRefundedRow?.textContent).not.toContain("Paid");
    expect(
      within(partiallyRefundedRow as HTMLElement).getByText(
        `Partially refunded CZK 100 · ${recordedAt}`
      )
    ).toBeDefined();
    expect(readableText(partiallyRefundedRow?.querySelector("del"))).toBe(
      "CZK 275 before refund"
    );
    expect(readableText(partiallyRefundedRow)).toContain(
      "CZK 175 after refund"
    );

    expect(paidRow?.querySelector("del")).toBeNull();
    expect(
      within(paidRow as HTMLElement).getByText(
        `Paid · ${formatAdministrationDateTime(paid.latestPayment.updatedAt, "en-US")}`
      )
    ).toBeDefined();
    // The mobile list crosses out the same amounts.
    expect(view.container.querySelectorAll("del")).toHaveLength(4);
  });

  test("shows a refunded Nexi order as refunded, even when Nexi does not return it", () => {
    const detail = loadFixtureReservation("0198-admin-fixture-attention");
    const order = detail?.orders[0];
    if (!order?.link) throw new Error("Expected a linked fixture order");
    const refundedAt = "2026-10-12T09:00:00Z";
    const refundedOrder = {
      ...order,
      link: {
        ...order.link,
        refundState: "refunded",
        refundedAmount: order.link.amount,
        refundedAt,
      },
    } as const;

    const view = render(
      <ReservationOrderList
        locale="en-US"
        orders={[
          refundedOrder,
          {
            ...refundedOrder,
            orderId: NexiOrderIdSchema.make("DADMINFIXTUREMISSING"),
            provider: null,
            providerAvailable: false,
            providerStatus: "not_found",
            link: {
              ...refundedOrder.link,
              refundedAmount: { ...order.link.amount, value: 100_000 },
            },
          },
        ]}
      />
    );

    const recordedAt = formatAdministrationDateTime(refundedAt, "en-US");
    expect(view.queryByText(/Paid/)).toBeNull();
    expect(view.getByText(`Refunded · ${recordedAt}`)).toBeDefined();
    expect(
      view.getByText(`Partially refunded CZK 1,000 · ${recordedAt}`)
    ).toBeDefined();
    expect(
      [...view.container.querySelectorAll("del")].map(readableText)
    ).toEqual(["CZK 2,400 refunded", "CZK 2,400 before refund"]);

    const orderView = render(
      <OrderTable
        orders={[
          refundedOrder,
          {
            ...refundedOrder,
            orderId: NexiOrderIdSchema.make("DADMINFIXTUREPARTIAL"),
            link: {
              ...refundedOrder.link,
              refundedAmount: { ...order.link.amount, value: 100_000 },
            },
          },
        ]}
      />
    );
    const table = orderView.getByRole("table", { name: "Nexi orders" });
    expect(within(table).getByText("Refunded")).toBeDefined();
    expect(
      within(table).getByText("Partially refunded CZK 1,000")
    ).toBeDefined();
    expect(within(table).queryByText(/Partially Refunded/)).toBeNull();
    expect(within(table).queryByText("Paid")).toBeNull();
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
    const openWindow = render(
      <ReservationOrderList locale="en-US" orders={[emptyOrder]} />
    );
    expect(
      openWindow.getByText(/local payment window is open until/i)
    ).toBeDefined();
    openWindow.unmount();

    const overdue = render(
      <ReservationOrderList
        locale="en-US"
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
        locale="en-US"
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
    await act(async () => {
      fireEvent.submit(view.getByRole("button", { name: "Get reservation" }));
    });

    expect(execute).toHaveBeenCalledWith({ identifier: "payment-123" });
    onSuccess?.({ data: { reservationId: "reservation-456" } });
    expect(workspaceRouterPush).toHaveBeenCalledWith(
      "/en-US/admin/reservations/reservation-456"
    );
  });
});
