import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  mock,
  test,
} from "bun:test";
import { NexiOperationIdSchema, NexiOrderIdSchema } from "@deskohub/nexi";
import { within } from "@testing-library/react";
import { prerender } from "react-dom/static";
import { m } from "@/features/administration/i18n";
import type { loadAdministrationOrder } from "@/features/administration/page-data.server";
import { getProviderValueLabel } from "@/features/administration/payment-presentation";
import { paymentAttemptIdSchema } from "@/features/checkout/checkout-identifiers";
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

type Order = Awaited<ReturnType<typeof loadAdministrationOrder>>;

const orderId = NexiOrderIdSchema.make("order-1");
const firstOperationId = NexiOperationIdSchema.make("operation-1");
const secondOperationId = NexiOperationIdSchema.make("operation-2");
const reservationId = workspaceReservationIdSchema.make("reservation-1");
const paymentAttemptId = paymentAttemptIdSchema.make("attempt-1");
const locale = "en-US";

const fullOrder: Order = {
  orderId,
  provider: {
    orderId,
    amount: "12000",
    currency: "CZK",
    authorizedAmount: "12000",
    capturedAmount: "12000",
    lastOperationTime: "2026-08-12T08:05:00.000Z",
    lastOperationType: "CAPTURE",
    operations: [
      {
        orderId,
        operationId: firstOperationId,
        operationType: "AUTHORIZATION",
      },
      { orderId, operationId: secondOperationId, operationType: "CAPTURE" },
    ],
  },
  providerAvailable: true,
  providerStatus: "available",
  link: {
    paymentAttemptId,
    reservationId,
    state: "paid",
    refundState: "not_required",
    stateLabel: "Paid",
    failureCode: null,
    amount: { value: 12_000, exponent: 2, currency: "CZK" },
    refundedAmount: null,
    refundedAt: null,
    attemptCreatedAt: "2026-08-12T08:00:00.000Z",
    providerOrderCreatedAt: "2026-08-12T08:01:00.000Z",
    providerOrderCreatedAtEstimated: true,
    updatedAt: "2026-08-12T08:05:00.000Z",
  },
};

let order: Order = fullOrder;
const administrationPageData = await import(
  "@/features/administration/page-data.server"
);
mock.module("@/features/administration/page-data.server", () => ({
  ...administrationPageData,
  loadAdministrationOrder: () => Promise.resolve(order),
}));

async function prerenderOrderDetail() {
  const { OrderAdministrationDetail } = await import("./page");
  const { prelude } = await prerender(
    <RouteLocaleProvider locale={locale}>
      <OrderAdministrationDetail
        locale={locale}
        params={Promise.resolve({ orderId })}
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

const facts = (container: HTMLElement) =>
  [...container.querySelectorAll("section dl > div")].map((fact) => ({
    label: fact.querySelector("dt")?.textContent,
    value: fact.querySelector("dd")?.textContent,
  }));

const unreported = new Set([
  m.administrationOrderNotReported({}, { locale }),
  m.administrationPaymentNotReported({}, { locale }),
]);

describe("OrderAdministrationDetail", () => {
  beforeAll(() => registerWorkspaceComponentTestEnv());
  afterEach(() => {
    order = fullOrder;
  });
  afterAll(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await unregisterWorkspaceComponentTestEnv();
  });

  test("reports a linked order's facts, operations, reservation, and local attempt", async () => {
    const container = await prerenderOrderDetail();
    const view = within(container);
    const orderFacts = facts(container);

    expect(view.getByRole("heading", { level: 1 }).textContent).toBe(orderId);
    expect(orderFacts).toHaveLength(6);
    expect(orderFacts.filter(({ value }) => unreported.has(value!))).toEqual(
      []
    );
    expect(orderFacts.map(({ label }) => label)).toContain(
      m.administrationOrderFactCreatedEstimated({}, { locale })
    );
    expect(orderFacts.map(({ value }) => value)).toContain(
      getProviderValueLabel("CAPTURE", locale)
    );
    expect(
      linksTo(container, `/admin/operations/${firstOperationId}`)
    ).toHaveLength(1);
    expect(
      linksTo(container, `/admin/operations/${secondOperationId}`)
    ).toHaveLength(1);
    // The related-reservation card and each operation row link the reservation.
    expect(
      linksTo(container, `/admin/reservations/${reservationId}`)
    ).toHaveLength(3);
    expect(view.getByText(paymentAttemptId)).toBeDefined();
    expect(
      view.queryByText(m.administrationOrderDetailNotFound({}, { locale }))
    ).toBeNull();
    expect(
      view.queryByText(m.administrationOrderDetailUnavailable({}, { locale }))
    ).toBeNull();
  });

  test("labels an exactly recorded creation time without the estimate", async () => {
    order = {
      ...fullOrder,
      link: { ...fullOrder.link!, providerOrderCreatedAtEstimated: false },
    };
    const labels = facts(await prerenderOrderDetail()).map(
      ({ label }) => label
    );

    expect(labels).toContain(m.administrationOrderFactCreated({}, { locale }));
    expect(labels).not.toContain(
      m.administrationOrderFactCreatedEstimated({}, { locale })
    );
  });

  test("reports an order the provider does not know and no attempt links", async () => {
    order = {
      ...fullOrder,
      provider: null,
      providerAvailable: true,
      providerStatus: "not_found",
      link: null,
    };
    const container = await prerenderOrderDetail();
    const view = within(container);
    const orderFacts = facts(container);

    expect(
      view.getByText(m.administrationOrderDetailNotFound({}, { locale }))
    ).toBeDefined();
    // Amount, authorized, captured, last operation, and last activity.
    expect(
      orderFacts.filter(({ value }) => unreported.has(value!))
    ).toHaveLength(5);
    expect(orderFacts.map(({ value }) => value)).toContain(
      m.administrationOrderNotRecorded({}, { locale })
    );
    expect(container.querySelectorAll("aside section")).toHaveLength(1);
    expect(container.querySelectorAll("aside a")).toHaveLength(0);
    expect(
      linksTo(container, `/admin/operations/${firstOperationId}`)
    ).toHaveLength(0);
  });

  test("warns that the provider is unavailable while still showing the local attempt", async () => {
    order = {
      ...fullOrder,
      provider: null,
      providerAvailable: false,
      providerStatus: "unavailable",
    };
    const container = await prerenderOrderDetail();
    const view = within(container);

    expect(
      view.getByText(m.administrationOrderDetailUnavailable({}, { locale }))
    ).toBeDefined();
    expect(container.querySelectorAll("aside section")).toHaveLength(2);
    expect(view.getByText(paymentAttemptId)).toBeDefined();
  });
});
