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
import type { loadAdministrationOperation } from "@/features/administration/page-data.server";
import { getProviderValueLabel } from "@/features/administration/payment-presentation";
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

type OperationDetail = Awaited<ReturnType<typeof loadAdministrationOperation>>;

const operationId = NexiOperationIdSchema.make("operation-1");
const orderId = NexiOrderIdSchema.make("order-1");
const reversedOperationId = NexiOperationIdSchema.make("operation-0");
const reservationId = workspaceReservationIdSchema.make("reservation-1");

const fullDetail: OperationDetail = {
  operationId,
  operation: {
    orderId,
    operationId,
    channel: "ECOMMERCE",
    operationType: "CAPTURE",
    operationResult: "EXECUTED",
    operationTime: "2026-08-12T08:00:00.000Z",
    amount: "12000",
    currency: "CZK",
    cancelledOperationId: reversedOperationId,
  },
  providerAvailable: true,
  providerStatus: "available",
  linkedReservationId: reservationId,
};

let detail: OperationDetail = fullDetail;
const administrationPageData = await import(
  "@/features/administration/page-data.server"
);
mock.module("@/features/administration/page-data.server", () => ({
  ...administrationPageData,
  loadAdministrationOperation: () => Promise.resolve(detail),
}));

async function prerenderOperationDetail() {
  const { OperationAdministrationDetail } = await import("./page");
  const { prelude } = await prerender(
    <RouteLocaleProvider locale="en-US">
      <OperationAdministrationDetail
        locale="en-US"
        params={Promise.resolve({ operationId })}
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

const factValues = (container: HTMLElement) =>
  [...container.querySelectorAll("section dl dd")].map(
    (value) => value.textContent
  );

const notReported = m.administrationOperationNotReported(
  {},
  { locale: "en-US" }
);

describe("OperationAdministrationDetail", () => {
  beforeAll(() => registerWorkspaceComponentTestEnv());
  afterEach(() => {
    detail = fullDetail;
  });
  afterAll(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await unregisterWorkspaceComponentTestEnv();
  });

  test("names the operation, reports every fact, and links its order and reservation", async () => {
    const container = await prerenderOperationDetail();
    const view = within(container);

    expect(view.getByRole("heading", { level: 1 }).textContent).toBe(
      operationId
    );
    expect(factValues(container)).toHaveLength(6);
    expect(factValues(container)).not.toContain(notReported);
    expect(factValues(container)).toContain(reversedOperationId);
    // The result shows as the header badge and as a fact.
    expect(
      view.getAllByText(getProviderValueLabel("EXECUTED", "en-US"))
    ).toHaveLength(2);
    expect(linksTo(container, `/admin/orders/${orderId}`)).toHaveLength(1);
    expect(
      linksTo(container, `/admin/reservations/${reservationId}`)
    ).toHaveLength(1);
    expect(
      view.queryByText(
        m.administrationOperationDetailNotFound({}, { locale: "en-US" })
      )
    ).toBeNull();
    expect(
      view.queryByText(
        m.administrationOperationDetailUnavailable({}, { locale: "en-US" })
      )
    ).toBeNull();
  });

  test("falls back for every fact and record the provider did not report", async () => {
    detail = {
      ...fullDetail,
      operation: {},
      linkedReservationId: null,
    };
    const container = await prerenderOperationDetail();
    const values = factValues(container);

    expect(values).toHaveLength(6);
    expect(
      within(container).queryByText(getProviderValueLabel("EXECUTED", "en-US"))
    ).toBeNull();
    const unreported = new Set([
      notReported,
      m.administrationPaymentNotReported({}, { locale: "en-US" }),
    ]);
    // Type, result, origin, time, and amount; the reversal is not applicable.
    expect(values.filter((value) => unreported.has(value!))).toHaveLength(5);
    expect(values).toContain(
      m.administrationOperationNotApplicable({}, { locale: "en-US" })
    );
    expect(container.querySelectorAll("aside a")).toHaveLength(0);
    expect(
      within(container).getByText(notReported, { selector: "aside span" })
    ).toBeDefined();
  });

  test("warns that the provider is unavailable", async () => {
    detail = { ...fullDetail, providerStatus: "unavailable" };
    const view = within(await prerenderOperationDetail());

    expect(
      view.getByText(
        m.administrationOperationDetailUnavailable({}, { locale: "en-US" })
      )
    ).toBeDefined();
  });

  test("reports an operation the provider does not know, with no facts or records", async () => {
    detail = {
      ...fullDetail,
      operation: null,
      providerAvailable: true,
      providerStatus: "not_found",
    };
    const container = await prerenderOperationDetail();

    expect(
      within(container).getByText(
        m.administrationOperationDetailNotFound({}, { locale: "en-US" })
      )
    ).toBeDefined();
    expect(container.querySelector("section dl")).toBeNull();
    expect(container.querySelector("aside")).toBeNull();
  });
});
