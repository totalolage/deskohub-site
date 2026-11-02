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
import {
  workspaceRouterRefresh,
  workspaceUseAction,
} from "@/shared/testing/workspace-component-module-mocks";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";
import { invoiceAdministrationDetail } from "./invoice-detail.test-utils";

type RetryActionOptions = {
  readonly onSuccess: () => void;
  readonly onError: (result: {
    readonly error: { readonly serverError?: string };
  }) => void;
  readonly onTransportError: () => void;
};

// The real request-locale module reads the route locale from next/root-params.
mock.module("next/root-params", () => ({ locale: async () => locale }));
const invoiceActions = await import("./actions");
mock.module("./actions", () => ({
  ...invoiceActions,
  retryAdministrationInvoice: mock(),
}));

const { act, cleanup, fireEvent, render } = await import(
  "@testing-library/react"
);
const { m } = await import("@/features/administration/i18n");
const { RouteLocaleProvider } = await import("@/features/i18n/route-locale");
const { InvoiceDetailActions } = await import("./invoice-detail");

const locale = "cs-CZ";
const execute = mock((_input: { readonly invoiceId: string }) => undefined);
let isExecuting = false;
let retryOptions: RetryActionOptions | undefined;

const renderActions = (needsAttention: boolean) =>
  render(
    <RouteLocaleProvider locale={locale}>
      <InvoiceDetailActions
        invoice={invoiceAdministrationDetail({ needsAttention })}
      />
    </RouteLocaleProvider>
  );

const retryButtonName = () => m.accountingInvoiceRetryDelivery({}, { locale });

describe("InvoiceDetailActions", () => {
  beforeAll(() => registerWorkspaceComponentTestEnv());
  beforeEach(() => {
    isExecuting = false;
    retryOptions = undefined;
    execute.mockClear();
    workspaceRouterRefresh.mockClear();
    workspaceUseAction.mockImplementation((_action, options) => {
      retryOptions = options as RetryActionOptions;
      return { execute, isExecuting } as never;
    });
  });
  afterEach(() => cleanup());
  afterAll(async () => {
    workspaceUseAction.mockReset();
    await unregisterWorkspaceComponentTestEnv();
  });

  test("offers the PDF in the route's locale and no retry while delivery is fine", () => {
    const view = renderActions(false);

    const download = view.getByRole("link", {
      name: m.accountingInvoiceDownloadPdf({}, { locale }),
    });
    expect(download.getAttribute("href")).toBe(
      `/cs-CZ/admin/invoices/${invoiceAdministrationDetail().id}/pdf`
    );
    expect(download.hasAttribute("download")).toBe(true);
    expect(view.queryByRole("button")).toBeNull();
    expect(view.queryByRole("alert")).toBeNull();
  });

  test("retries the delivery and refreshes the page once it succeeds", async () => {
    const view = renderActions(true);

    fireEvent.click(view.getByRole("button", { name: retryButtonName() }));

    expect(execute).toHaveBeenCalledWith({
      invoiceId: invoiceAdministrationDetail().id,
    });
    await act(async () => retryOptions?.onSuccess());
    expect(workspaceRouterRefresh).toHaveBeenCalledTimes(1);
    expect(view.queryByRole("alert")).toBeNull();
  });

  test("shows the retry as pending while it runs", () => {
    isExecuting = true;
    const view = renderActions(true);

    const button = view.getByRole("button", {
      name: m.accountingInvoiceRetryingDelivery({}, { locale }),
    }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });

  test("shows the server's error, or the fallback without one, and clears it on the next try", async () => {
    const view = renderActions(true);

    await act(async () =>
      retryOptions?.onError({ error: { serverError: "Delivery refused." } })
    );
    expect(view.getByRole("alert").textContent).toBe("Delivery refused.");

    await act(async () => retryOptions?.onError({ error: {} }));
    expect(view.getByRole("alert").textContent).toBe(
      m.accountingInvoiceRetryDeliveryError({}, { locale })
    );

    fireEvent.click(view.getByRole("button", { name: retryButtonName() }));
    expect(view.queryByRole("alert")).toBeNull();
    expect(workspaceRouterRefresh).not.toHaveBeenCalled();
  });

  test("shows the fallback error when the action can't be reached", async () => {
    const view = renderActions(true);

    await act(async () => retryOptions?.onTransportError());

    expect(view.getByRole("alert").textContent).toBe(
      m.accountingInvoiceRetryDeliveryError({}, { locale })
    );
  });
});
