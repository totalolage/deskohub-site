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
import { RouteLocaleProvider } from "@/features/i18n/route-locale";
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
  BookingTable,
  formatAdministrationDateTime,
  formatAdministrationMoney,
  PaymentAttemptList,
  RelatedReservationLink,
  ReservationTable,
  ReservationTimeline,
} from "./components";
import { loadFixtureReservation, loadFixtureReservations } from "./fixtures";
import { ReservationOrderList } from "./payment-components";
import { OperationTable, OrderTable } from "./payment-tables";
import { ReservationAccessAdministration } from "./reservation-access-administration";
import { ReservationLifecycleMap } from "./reservation-lifecycle-map";
import { ReservationLookup } from "./reservation-lookup";
import { getAdministrationReservationLifecycle } from "./reservation-status";

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
                status: {
                  group: "in_progress",
                  code: "awaiting_payment",
                  label: "Awaiting payment",
                },
                statusNote: "Cancelled in Dotypos",
                statusNoteCode: "cancelled_in_dotypos",
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
        locale="en-US"
        reservation={{
          ...reservation,
          status: {
            group: "in_progress",
            code: "awaiting_payment",
            label: "Awaiting payment",
          },
          statusNote: "Cancelled in Dotypos",
          statusNoteCode: "cancelled_in_dotypos",
        }}
      />
    );

    expect(view.getByText("Cancelled in Dotypos")).toBeDefined();
    expect(view.getByText("Deskohub: Awaiting payment")).toBeDefined();
    expect(view.getByText("Alex Morgan")).toBeDefined();
    expect(view.getByText(testEmailAddress("alex.morgan"))).toBeDefined();
  });

  test("renders the reservation table in Czech on a Czech route", () => {
    const { items } = loadFixtureReservations({});
    const view = render(
      <RouteLocaleProvider locale="cs-CZ">
        <ReservationTable
          reservations={items.map((item, index) =>
            index === 1
              ? {
                  ...item,
                  status: {
                    group: "in_progress",
                    code: "awaiting_payment",
                    label: "Awaiting payment",
                  },
                  statusNote: "Cancelled in Dotypos",
                  statusNoteCode: "cancelled_in_dotypos",
                }
              : item
          )}
        />
      </RouteLocaleProvider>
    );

    const table = view.getByRole("table", { name: "Rezervace" });
    for (const header of ["Datum", "Stav", "Zákazník", "Vytvořeno", "Platba"]) {
      expect(
        within(table).getByRole("columnheader", { name: header })
      ).toBeDefined();
    }
    expect(within(table).getAllByText("Problém s potvrzením")).not.toHaveLength(
      0
    );
    expect(within(table).getAllByText("Zasedací místnost")).not.toHaveLength(0);
    expect(within(table).getAllByText("Profi Workstation")).not.toHaveLength(0);
    expect(within(table).getByText("Zrušeno v Dotyposu")).toBeDefined();
    expect(within(table).getByText("Deskohub: Čeká na platbu")).toBeDefined();
    expect(
      within(table).getAllByRole("link", {
        name: "Platba ORDER-0198-admin-fixture-attention (otevře se v XPay)",
      })
    ).toHaveLength(1);
    expect(view.queryByText("Awaiting payment")).toBeNull();
  });

  test("renders an empty Czech reservation table message", () => {
    const view = render(
      <RouteLocaleProvider locale="cs-CZ">
        <ReservationTable reservations={[]} />
      </RouteLocaleProvider>
    );

    expect(
      view.getByText("Tomuto zobrazení neodpovídají žádné rezervace.")
    ).toBeDefined();
  });

  test("renders a related reservation in Czech", () => {
    const reservation = loadFixtureReservations({}).items[4];
    expect(reservation).toBeDefined();
    if (!reservation) return;

    const view = render(
      <RelatedReservationLink
        locale="cs-CZ"
        reservation={{
          ...reservation,
          customer: null,
          date: null,
          endsAt: null,
          startsAt: null,
        }}
      />
    );

    expect(view.getByText("Zasedací místnost")).toBeDefined();
    expect(view.getByText("Zákazník není k dispozici")).toBeDefined();
    expect(view.getByText("Zrušeno")).toBeDefined();
  });

  test("shows door access in Czech on a Czech route", () => {
    const detail = loadFixtureReservation("0198-admin-fixture-attention");
    expect(detail?.accessGrant).not.toBeNull();
    if (!detail?.accessGrant) return;
    workspaceUseAction.mockReturnValue({
      execute: mock(),
      isExecuting: false,
    } as never);

    const view = render(
      <RouteLocaleProvider locale="cs-CZ">
        <ReservationAccessAdministration
          grant={{ ...detail.accessGrant, state: "uncertain" }}
          reservationId={detail.reservation.id}
        />
      </RouteLocaleProvider>
    );

    expect(view.getByText("Přístup ke dveřím")).toBeDefined();
    expect(view.getByText("Vyžaduje sladění")).toBeDefined();
    expect(view.getByText("Sladit přístup")).toBeDefined();
    expect(
      view.getByText(
        `U zámku se v aplikaci Igloohome připojte přes Bluetooth a najděte „${detail.accessGrant.accessName}“.`,
        { exact: false }
      )
    ).toBeDefined();
    expect(view.getByText("Platí od")).toBeDefined();
  });

  test("looks up reservations in Czech and reports an unmatched ID", async () => {
    const execute = mock();
    let onSuccess:
      | ((args: { readonly data?: { readonly reservationId: null } }) => void)
      | undefined;
    workspaceUseAction.mockImplementation((_action, options) => {
      onSuccess = (options as { onSuccess: typeof onSuccess }).onSuccess;
      return { execute, isExecuting: false } as never;
    });

    const view = render(
      <RouteLocaleProvider locale="cs-CZ">
        <ReservationLookup />
      </RouteLocaleProvider>
    );

    const button = view.getByRole("button", { name: "Najít rezervaci" });
    await act(async () => {
      fireEvent.click(button);
    });
    expect(
      await view.findByText("Zadejte ID rezervace nebo platby.")
    ).toBeDefined();
    expect(execute).not.toHaveBeenCalled();

    act(() => onSuccess?.({ data: { reservationId: null } }));
    expect(
      view.getByText("Tomuto ID neodpovídá žádná rezervace.")
    ).toBeDefined();
    expect(view.getByLabelText("ID rezervace nebo platby")).toBeDefined();
  });

  test("names lifecycle stages and the current condition in Czech", () => {
    const view = render(
      <ReservationLifecycleMap
        lifecycle={getAdministrationReservationLifecycle({
          fulfillmentState: "not_started",
          paymentState: "expired",
          reservationState: "held",
        })}
        locale="cs-CZ"
      />
    );

    expect(view.getByText("Zahájeno")).toBeDefined();
    expect(view.getByText("Platba vypršela")).toBeDefined();
    expect(view.getByText("Aktuální fáze")).toBeDefined();
    expect(view.getByText("Nebo pokračovat k platbě")).toBeDefined();
    expect(view.queryByText("Payment expired")).toBeNull();
  });

  test("shows a recorded refund instead of the refund requirement", () => {
    const detail = loadFixtureReservation("0198-admin-fixture-attention");
    const attempt = detail?.paymentAttempts[0];
    expect(attempt).toBeDefined();
    if (!attempt) return;
    const refundedAt = "2026-10-05T08:30:00Z";

    const view = render(
      <PaymentAttemptList
        locale="en-US"
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

  test("words payment attempts and Nexi orders in Czech", () => {
    const detail = loadFixtureReservation("0198-admin-fixture-attention");
    const attempt = detail?.paymentAttempts[0];
    const order = detail?.orders[0];
    if (!(attempt && order?.link)) {
      throw new Error("Expected a fixture payment and linked order");
    }
    const refundedAt = "2026-10-12T09:00:00Z";
    const refundedAmount = { ...attempt.amount, value: 100_000 };

    const attempts = render(
      <PaymentAttemptList
        attempts={[
          {
            ...attempt,
            refundState: "refunded",
            refundedAmount,
            refundedAt,
          },
        ]}
        locale="cs-CZ"
      />
    );
    expect(attempts.getByText("Online platba")).toBeDefined();
    expect(attempts.getByText("Objednávka Nexi")).toBeDefined();
    const attemptText = readableText(attempts.container);
    expect(attemptText).toContain(
      `Částečně vráceno ${formatAdministrationMoney(refundedAmount, "cs-CZ")} · ${formatAdministrationDateTime(refundedAt, "cs-CZ")}`.replace(
        /\s+/g,
        " "
      )
    );
    expect(readableText(attempts.container.querySelector("del"))).toBe(
      `${formatAdministrationMoney(attempt.amount, "cs-CZ")} před vrácením peněz`.replace(
        /\s+/g,
        " "
      )
    );
    attempts.unmount();

    const orders = render(
      <ReservationOrderList
        locale="cs-CZ"
        orders={[
          {
            ...order,
            provider: null,
            providerAvailable: false,
            providerStatus: "unavailable",
          },
        ]}
      />
    );
    expect(
      orders.getByText(
        "Aktuální operace objednávky jsou z Nexi dočasně nedostupné."
      )
    ).toBeDefined();
    expect(orders.getByText("Zaplaceno", { exact: false })).toBeDefined();
    orders.unmount();

    const orderTable = render(
      <RouteLocaleProvider locale="cs-CZ">
        <OrderTable
          orders={[
            order,
            {
              ...order,
              orderId: NexiOrderIdSchema.make("DADMINFIXTURENEXIONLY"),
              link: null,
            },
          ]}
        />
      </RouteLocaleProvider>
    );
    const table = orderTable.getByRole("table", { name: "Objednávky Nexi" });
    expect(
      within(table).getByRole("columnheader", { name: "Párování" })
    ).toBeDefined();
    expect(within(table).getByText("Zaplaceno")).toBeDefined();
    expect(within(table).getByText("Pouze v Nexi")).toBeDefined();
    expect(within(table).getAllByText("Zobrazit rezervaci")).toHaveLength(1);
    orderTable.unmount();

    const empty = render(
      <RouteLocaleProvider locale="cs-CZ">
        <OperationTable operations={[]} />
      </RouteLocaleProvider>
    );
    expect(
      empty.getByText("Těmto filtrům neodpovídají žádné operace Nexi.")
    ).toBeDefined();
  });

  test("words reservation and payment history in Czech", () => {
    const detail = loadFixtureReservation("0198-admin-fixture-attention");
    if (!detail) throw new Error("Expected a fixture reservation");

    const view = render(
      <ReservationTimeline items={detail.timeline} locale="cs-CZ" />
    );

    const timeline = view.getByRole("list", { name: "Historie rezervace" });
    // A reservation event uses the reservation copy.
    expect(
      within(timeline).getByText("Objednávkový proces byl vytvořen")
    ).toBeDefined();
    expect(
      within(timeline).getByText("Deskohub vytvořil místní proces rezervace.")
    ).toBeDefined();
    // Payment events use the payment copy, never the API's English.
    expect(
      within(timeline).getByRole("link", { name: "Objednávka Nexi vytvořena" })
    ).toBeDefined();
    expect(
      within(timeline).getByRole("link", { name: "Nexi platbu provedlo" })
    ).toBeDefined();
    expect(within(timeline).queryByText("Nexi order created")).toBeNull();
    expect(within(timeline).queryByText("Payment executed by Nexi")).toBeNull();
  });

  test("words Dotypos bookings in Czech", () => {
    const booking = loadFixtureReservation(
      "0198-admin-fixture-attention"
    )?.booking;
    if (!booking) throw new Error("Expected a fixture booking");

    const view = render(
      <RouteLocaleProvider locale="cs-CZ">
        <BookingTable
          bookings={[
            { ...booking, seats: "3", status: "CANCELLED" },
            {
              ...booking,
              id: `${booking.id}-unassigned` as typeof booking.id,
              customer: null,
              customerId: null,
              linkedReservation: null,
              seats: "5",
              tableName: null,
            },
          ]}
        />
      </RouteLocaleProvider>
    );

    const table = view.getByRole("table", { name: "Rezervace stolů" });
    expect(
      within(table).getByRole("columnheader", { name: /Stůl/ })
    ).toBeDefined();
    expect(within(table).getByText("3 osoby")).toBeDefined();
    expect(within(table).getByText("5 osob")).toBeDefined();
    expect(within(table).getByText("Zrušená")).toBeDefined();
    expect(within(table).getByText("Nepřiřazeno")).toBeDefined();
    expect(within(table).getByText("Nepřipojeno")).toBeDefined();
    // The linked reservation is named by the customer catalog's product name.
    expect(
      within(table).getByRole("link", { name: "Zasedací místnost" })
    ).toBeDefined();
    expect(
      within(table).getByText("Podrobnosti nejsou k dispozici")
    ).toBeDefined();
    // The mobile list words the same booking.
    expect(view.getByText("Bez přiřazeného stolu · 5 osob")).toBeDefined();
    view.unmount();

    const empty = render(
      <RouteLocaleProvider locale="cs-CZ">
        <BookingTable bookings={[]} />
      </RouteLocaleProvider>
    );
    expect(
      empty.getByText("K tomuto datu neexistují žádné rezervace stolů.")
    ).toBeDefined();
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
