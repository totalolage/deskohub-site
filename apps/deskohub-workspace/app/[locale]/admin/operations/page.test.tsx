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
import { operationListQuery } from "@/features/administration/operation-list-query";
import type { loadAdministrationOperationsPage } from "@/features/administration/page-data.server";
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
  ReturnType<typeof loadAdministrationOperationsPage>["result"]
>;

const locale = "en-US";
const orderId = NexiOrderIdSchema.make("order-1");
const operationIds = [
  NexiOperationIdSchema.make("operation-1"),
  NexiOperationIdSchema.make("operation-2"),
];

const listedResult: ListResult = {
  items: operationIds.map((operationId) => ({
    orderId,
    operationId,
    linkedReservationId: null,
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
  loadAdministrationOperationsPage: () => ({
    criteria: Promise.resolve(operationListQuery.parse({})),
    result: Promise.resolve(result),
  }),
}));

async function prerenderListPage() {
  const { default: OperationsAdministrationPage } = await import("./page");
  const { prelude } = await prerender(
    <RouteLocaleProvider locale={locale}>
      <OperationsAdministrationPage searchParams={Promise.resolve({})} />
    </RouteLocaleProvider>,
    { progressiveChunkSize: Number.POSITIVE_INFINITY }
  );
  const container = document.createElement("div");
  container.innerHTML = await new Response(prelude).text();
  return within(container);
}

const providerUnavailable = m.administrationOperationListProviderUnavailable(
  {},
  { locale }
);
const truncated = m.administrationOperationListTruncated({}, { locale });

describe("OperationsAdministrationPage", () => {
  beforeAll(() => registerWorkspaceComponentTestEnv());
  afterEach(() => {
    result = listedResult;
  });
  afterAll(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await unregisterWorkspaceComponentTestEnv();
  });

  test("lists each operation without notices when the provider returned the whole list", async () => {
    const view = await prerenderListPage();

    for (const id of operationIds) {
      expect(
        view
          .getAllByRole("link")
          .filter((link) =>
            link.getAttribute("href")?.endsWith(`/admin/operations/${id}`)
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
