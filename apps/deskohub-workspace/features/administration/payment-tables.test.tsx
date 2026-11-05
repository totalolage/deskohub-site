import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
} from "bun:test";
import { NexiOperationIdSchema, NexiOrderIdSchema } from "@deskohub/nexi";
import { cleanup, fireEvent, render, within } from "@testing-library/react";
import { RouteLocaleProvider } from "@/features/i18n/route-locale";
import { workspaceReservationIdSchema } from "@/features/reservation/persistence-contracts";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";
import { loadFixtureReservation } from "./fixtures";
import { m } from "./i18n";
import type {
  AdministrationOperation,
  AdministrationOrder,
} from "./payment-administration.service";
import { formatProviderDateTime } from "./payment-components";
import { getProviderValueLabel } from "./payment-presentation";
import {
  getOperationRowId,
  OperationTable,
  OrderTable,
} from "./payment-tables";

const locale = "en-US";

const linkedOrder = (): AdministrationOrder => {
  const order = loadFixtureReservation("0198-admin-fixture-attention")
    ?.orders[0];
  if (!order?.link) throw new Error("Expected a linked fixture order");
  return order;
};

const unlinkedOrder = (
  orderId: string,
  overrides: Partial<AdministrationOrder>
): AdministrationOrder => ({
  orderId: NexiOrderIdSchema.make(orderId),
  provider: null,
  providerAvailable: false,
  providerStatus: "unavailable",
  link: null,
  ...overrides,
});

const renderInRouteLocale = (children: React.ReactNode) =>
  render(<RouteLocaleProvider locale={locale}>{children}</RouteLocaleProvider>);

/** Each body row's cells, as text. */
const bodyRows = (table: HTMLElement) =>
  within(table)
    .getAllByRole("row")
    .slice(1)
    .map((row) =>
      within(row)
        .getAllByRole("cell")
        .map((cell) => cell.textContent)
    );

describe("payment tables", () => {
  beforeAll(() => registerWorkspaceComponentTestEnv());
  afterEach(() => cleanup());
  afterAll(() => unregisterWorkspaceComponentTestEnv());

  test("names how each order without both a Nexi record and a local attempt reconciles", () => {
    const view = renderInRouteLocale(
      <OrderTable
        orders={[
          unlinkedOrder("DPAYTABLEAVAILABLE", {
            provider: {
              orderId: NexiOrderIdSchema.make("DPAYTABLEAVAILABLE"),
              operations: [],
            },
            providerAvailable: true,
            providerStatus: "available",
          }),
          unlinkedOrder("DPAYTABLENOTFOUND", { providerStatus: "not_found" }),
          unlinkedOrder("DPAYTABLENOTRETURNED", {
            providerStatus: "not_returned",
          }),
          unlinkedOrder("DPAYTABLEUNAVAILABLE", {
            providerStatus: "unavailable",
          }),
        ]}
      />
    );

    const table = view.getByRole("table", {
      name: m.administrationOrderTableLabel({}, { locale }),
    });
    expect(bodyRows(table).map((cells) => cells.at(-1))).toEqual([
      m.administrationOrderReconciliationProviderOnly({}, { locale }),
      m.administrationOrderReconciliationNotFound({}, { locale }),
      m.administrationOrderReconciliationNotReturned({}, { locale }),
      m.administrationOrderReconciliationUnavailable({}, { locale }),
    ]);
  });

  test("dates each order by its latest known activity and links it", () => {
    const order = linkedOrder();
    const link = order.link;
    if (!link) throw new Error("Expected a linked fixture order");
    const lastOperationTime = "2026-10-03T09:15:00Z";
    const view = renderInRouteLocale(
      <OrderTable
        orders={[
          {
            ...order,
            orderId: NexiOrderIdSchema.make("DPAYTABLEOPERATION"),
            provider: {
              orderId: NexiOrderIdSchema.make("DPAYTABLEOPERATION"),
              lastOperationTime,
              operations: [],
            },
          },
          {
            ...order,
            orderId: NexiOrderIdSchema.make("DPAYTABLEATTEMPT"),
            provider: null,
            link: { ...link, providerOrderCreatedAt: null },
          },
          unlinkedOrder("DPAYTABLEUNDATED", {}),
        ]}
      />
    );

    const table = view.getByRole("table", {
      name: m.administrationOrderTableLabel({}, { locale }),
    });
    const [operation, attempt, undated] = within(table)
      .getAllByRole("row")
      .slice(1);
    expect(
      within(operation as HTMLElement)
        .getByRole("link", { name: "DPAYTABLEOPERATION" })
        .getAttribute("href")
    ).toBe("/en-US/admin/orders/DPAYTABLEOPERATION");
    expect(
      within(operation as HTMLElement).getByText(
        formatProviderDateTime(lastOperationTime, locale)
      )
    ).toBeDefined();
    expect(
      within(attempt as HTMLElement).getByText(
        formatProviderDateTime(link.attemptCreatedAt, locale)
      )
    ).toBeDefined();
    const undatedOrderCell = within(undated as HTMLElement).getAllByRole(
      "cell"
    )[0];
    expect(undatedOrderCell?.querySelector("p")).toBeNull();
    expect(undatedOrderCell?.textContent).toBe("DPAYTABLEUNDATED");
  });

  test("sorts orders by Nexi's amount, else the local attempt's", () => {
    const order = linkedOrder();
    const link = order.link;
    if (!link) throw new Error("Expected a linked fixture order");
    const view = renderInRouteLocale(
      <OrderTable
        orders={[
          {
            ...order,
            orderId: NexiOrderIdSchema.make("DPAYTABLELOCALAMOUNT"),
            provider: null,
            link: { ...link, amount: { ...link.amount, value: 1000 } },
          },
          {
            ...order,
            orderId: NexiOrderIdSchema.make("DPAYTABLENEXIAMOUNT"),
            provider: {
              orderId: NexiOrderIdSchema.make("DPAYTABLENEXIAMOUNT"),
              amount: "500000",
              currency: "CZK",
              operations: [],
            },
          },
        ]}
      />
    );
    const table = view.getByRole("table", {
      name: m.administrationOrderTableLabel({}, { locale }),
    });
    const orderIds = () => bodyRows(table).map((cells) => cells[0]);
    const amountSort = within(table).getByRole("button", {
      name: m.administrationOrderColumnAmount({}, { locale }),
    });
    expect(orderIds()).toEqual([
      expect.stringContaining("DPAYTABLELOCALAMOUNT"),
      expect.stringContaining("DPAYTABLENEXIAMOUNT"),
    ]);

    fireEvent.click(amountSort);
    expect(amountSort.closest("th")?.getAttribute("aria-sort")).toBe(
      "descending"
    );
    expect(orderIds()).toEqual([
      expect.stringContaining("DPAYTABLENEXIAMOUNT"),
      expect.stringContaining("DPAYTABLELOCALAMOUNT"),
    ]);

    fireEvent.click(amountSort);
    expect(amountSort.closest("th")?.getAttribute("aria-sort")).toBe(
      "ascending"
    );
    expect(orderIds()).toEqual([
      expect.stringContaining("DPAYTABLELOCALAMOUNT"),
      expect.stringContaining("DPAYTABLENEXIAMOUNT"),
    ]);
  });

  test("shows each reported operation detail and marks what Nexi left out", () => {
    const reservationId = workspaceReservationIdSchema.make(
      "01980000-0000-7000-8000-0000000000aa"
    );
    const operationTime = "2026-10-04T12:00:00Z";
    const operations: AdministrationOperation[] = [
      {
        operationId: NexiOperationIdSchema.make("synthetic-operation"),
        orderId: NexiOrderIdSchema.make("DPAYTABLEOPERATIONS"),
        operationType: "CAPTURE",
        operationResult: "EXECUTED",
        operationTime,
        channel: "ECOMMERCE",
        amount: "35000",
        currency: "CZK",
        linkedReservationId: reservationId,
      },
      { linkedReservationId: null },
    ];
    const view = renderInRouteLocale(
      <OperationTable operations={operations} />
    );

    const table = view.getByRole("table", {
      name: m.administrationOperationTableLabel({}, { locale }),
    });
    const [reported, unreported] = within(table).getAllByRole("row").slice(1);
    const reportedRow = within(reported as HTMLElement);
    expect(
      reportedRow
        .getByRole("link", { name: "synthetic-operation" })
        .getAttribute("href")
    ).toBe("/en-US/admin/operations/synthetic-operation");
    expect(
      reportedRow
        .getByRole("link", { name: "DPAYTABLEOPERATIONS" })
        .getAttribute("href")
    ).toBe("/en-US/admin/orders/DPAYTABLEOPERATIONS");
    expect(
      reportedRow.getByText(formatProviderDateTime(operationTime, locale))
    ).toBeDefined();
    expect(
      reportedRow.getByText(getProviderValueLabel("CAPTURE", locale))
    ).toBeDefined();
    expect(
      reportedRow.getByText(getProviderValueLabel("ECOMMERCE", locale))
    ).toBeDefined();
    expect(
      reportedRow
        .getByRole("link", {
          name: m.administrationOperationViewReservation({}, { locale }),
        })
        .getAttribute("href")
    ).toBe(`/en-US/admin/reservations/${reservationId}`);

    const notReported = m.administrationOperationNotReported({}, { locale });
    const unreportedCells = within(unreported as HTMLElement)
      .getAllByRole("cell")
      .map((cell) => cell.textContent);
    expect(unreportedCells).toEqual([
      notReported,
      notReported,
      notReported,
      notReported,
      notReported,
      m.administrationPaymentNotReported({}, { locale }),
      m.administrationOperationReservationNotLinked({}, { locale }),
    ]);
    expect(within(unreported as HTMLElement).queryAllByRole("link")).toEqual(
      []
    );
  });

  test("keys an operation by its id, else by its order, time and position", () => {
    expect(
      getOperationRowId(
        {
          operationId: NexiOperationIdSchema.make("synthetic-operation"),
          orderId: NexiOrderIdSchema.make("DPAYTABLEKEYED"),
          linkedReservationId: null,
        },
        3
      )
    ).toBe("synthetic-operation");
    expect(
      getOperationRowId(
        {
          orderId: NexiOrderIdSchema.make("DPAYTABLEKEYED"),
          operationTime: "2026-10-04T12:00:00Z",
          linkedReservationId: null,
        },
        3
      )
    ).toBe("DPAYTABLEKEYED-2026-10-04T12:00:00Z-3");
    expect(getOperationRowId({ linkedReservationId: null }, 0)).toBe(
      "unknown-unknown-0"
    );
  });
});
