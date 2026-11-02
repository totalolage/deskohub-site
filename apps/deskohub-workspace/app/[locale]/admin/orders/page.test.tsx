import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  mock,
  test,
} from "bun:test";
import { NexiOrderIdSchema } from "@deskohub/nexi";
import { within } from "@testing-library/react";
import { prerender } from "react-dom/static";
import { m } from "@/features/administration/i18n";
import { orderListQuery } from "@/features/administration/order-list-query";
import type { loadAdministrationOrdersPage } from "@/features/administration/page-data.server";
import { RouteLocaleProvider } from "@/features/i18n/route-locale";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";

mock.module("server-only", () => ({}));
mock.module("next/root-params", () => ({
  locale: () => Promise.resolve("en-US"),
}));

type ListResult = Awaited<
  ReturnType<typeof loadAdministrationOrdersPage>["result"]
>;

const locale = "en-US";
const orderIds = [
  NexiOrderIdSchema.make("order-1"),
  NexiOrderIdSchema.make("order-2"),
];

const listedResult: ListResult = {
  items: orderIds.map((orderId) => ({
    orderId,
    provider: null,
    providerAvailable: true,
    providerStatus: "not_returned" as const,
    link: null,
  })),
  providerAvailable: true,
  truncated: false,
};

let result: ListResult = listedResult;
const administrationPageData = await import(
  "@/features/administration/page-data.server"
);
mock.module("@/features/administration/page-data.server", () => ({
  ...administrationPageData,
  loadAdministrationOrdersPage: () => ({
    range: Promise.resolve(orderListQuery.parse({})),
    result: Promise.resolve(result),
  }),
}));

async function prerenderListPage() {
  const { default: OrdersAdministrationPage } = await import("./page");
  const { prelude } = await prerender(
    <RouteLocaleProvider locale={locale}>
      <OrdersAdministrationPage searchParams={Promise.resolve({})} />
    </RouteLocaleProvider>,
    { progressiveChunkSize: Number.POSITIVE_INFINITY }
  );
  const container = document.createElement("div");
  container.innerHTML = await new Response(prelude).text();
  return within(container);
}

const providerUnavailable = m.administrationOrderListProviderUnavailable(
  {},
  { locale }
);
const truncated = m.administrationOrderListTruncated({}, { locale });

describe("OrdersAdministrationPage", () => {
  beforeAll(() => registerWorkspaceComponentTestEnv());
  afterEach(() => {
    result = listedResult;
  });
  afterAll(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await unregisterWorkspaceComponentTestEnv();
  });

  test("lists each order without notices when the provider returned the whole list", async () => {
    const view = await prerenderListPage();

    for (const id of orderIds) {
      expect(
        view
          .getAllByRole("link")
          .filter((link) =>
            link.getAttribute("href")?.endsWith(`/admin/orders/${id}`)
          )
      ).not.toHaveLength(0);
    }
    expect(view.queryByText(providerUnavailable)).toBeNull();
    expect(view.queryByText(truncated)).toBeNull();
  });

  test("warns when the provider is unavailable and notes a truncated list", async () => {
    result = { ...listedResult, providerAvailable: false, truncated: true };
    const view = await prerenderListPage();

    expect(view.getByText(providerUnavailable)).toBeDefined();
    expect(view.getByText(truncated)).toBeDefined();
  });
});
