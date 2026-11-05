import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  mock,
  test,
} from "bun:test";
import type { ReactElement, ReactNode } from "react";
import type { Locale } from "@/features/i18n";
import { workspaceUseAction } from "@/shared/testing/workspace-component-module-mocks";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";
import type { InvoiceAdministrationDetail } from "./invoice-administration.service";
import { invoiceAdministrationDetail } from "./invoice-detail.test-utils";

const locale = "en-US";
let detail = invoiceAdministrationDetail();
const loadInvoiceAdministrationDetail = mock((_invoiceId: string) =>
  Promise.resolve(detail)
);

// The real request-locale module reads the route locale from next/root-params.
mock.module("next/root-params", () => ({ locale: async () => locale }));
const invoiceActions = await import("./actions");
mock.module("./actions", () => ({
  ...invoiceActions,
  retryAdministrationInvoice: mock(),
}));
const invoicePageData = await import("./page-data.server");
mock.module("./page-data.server", () => ({
  ...invoicePageData,
  loadInvoiceAdministrationDetail,
}));
const requestLocale = await import("@/features/i18n/server/request-locale");
mock.module("@/features/i18n/server/request-locale", () => ({
  ...requestLocale,
  getRequestLocale: () => Promise.resolve(locale),
}));

const { cleanup, render } = await import("@testing-library/react");
const { InvoiceSettlement } = await import(
  "@/features/accounting/invoice-settlement"
);
const { m } = await import("@/features/administration/i18n");
const { RouteLocaleProvider } = await import("@/features/i18n/route-locale");
const { InvoiceAdministrationDetailScreen } = await import(
  "./invoice-detail-screen"
);

type DetailContentProps = {
  readonly locale: Locale;
  readonly params: Promise<{ readonly invoiceId: string }>;
};
type DetailContent = (props: DetailContentProps) => Promise<ReactNode>;

/** Resolves the screen's suspended content the way the server renders it. */
const renderDetail = async (invoice: InvoiceAdministrationDetail) => {
  detail = invoice;
  const screen = await InvoiceAdministrationDetailScreen({
    params: Promise.resolve({ invoiceId: invoice.id }),
  });
  const content: ReactElement<DetailContentProps, DetailContent> =
    screen.props.children;
  return render(
    <RouteLocaleProvider locale={locale}>
      {await content.type(content.props)}
    </RouteLocaleProvider>
  );
};

const definition = (
  view: Awaited<ReturnType<typeof renderDetail>>,
  term: string
) =>
  Array.from(view.container.querySelectorAll("dt")).find(
    (element) => element.textContent === term
  )?.nextElementSibling?.textContent;

describe("InvoiceAdministrationDetailScreen", () => {
  beforeAll(() => {
    registerWorkspaceComponentTestEnv();
    workspaceUseAction.mockImplementation(
      () => ({ execute: mock(), isExecuting: false }) as never
    );
  });
  afterEach(() => {
    cleanup();
    loadInvoiceAdministrationDetail.mockClear();
  });
  afterAll(async () => {
    workspaceUseAction.mockReset();
    await unregisterWorkspaceComponentTestEnv();
  });

  test("loads the requested invoice and shows its PDF, delivery, and provenance", async () => {
    const invoice = invoiceAdministrationDetail({ actor: "Ada Admin" });

    const view = await renderDetail(invoice);

    expect(loadInvoiceAdministrationDetail).toHaveBeenCalledWith(invoice.id);
    expect(
      view.getByRole("heading", { level: 1, name: invoice.invoiceNumber })
    ).toBeDefined();
    const pdf = view.getByTitle(
      m.accountingInvoiceDetailPdfTitle(
        { invoiceNumber: invoice.invoiceNumber },
        { locale }
      )
    );
    expect(pdf.getAttribute("src")).toBe(
      `/en-US/admin/invoices/${invoice.id}/pdf`
    );
    expect(
      definition(view, m.accountingInvoiceDetailActor({}, { locale }))
    ).toBe("Ada Admin");
    expect(
      view.getByText(
        m.accountingInvoiceDeliveryAudienceInternal({}, { locale })
      )
    ).toBeDefined();
  });

  test("shows the due date only while payment is requested and no payment date", async () => {
    const view = await renderDetail(
      invoiceAdministrationDetail({
        settlement: InvoiceSettlement.PaymentRequested({
          dueDate: "2026-09-01" as never,
          variableSymbol: "2026000042" as never,
        }),
      })
    );

    expect(
      definition(view, m.accountingInvoiceDetailDueDate({}, { locale }))
    ).toBeDefined();
    expect(
      definition(view, m.accountingInvoiceDetailPaidOn({}, { locale }))
    ).toBeUndefined();
  });

  test("shows the payment date of a paid invoice and the legacy actor without one", async () => {
    const view = await renderDetail(
      invoiceAdministrationDetail({
        paidOn: "2026-08-20",
        paymentStatus: "paid",
        settlement: InvoiceSettlement.Paid({
          paidOn: "2026-08-20" as never,
          variableSymbol: null,
        }),
      })
    );

    expect(
      definition(view, m.accountingInvoiceDetailPaidOn({}, { locale }))
    ).toBeDefined();
    expect(
      definition(view, m.accountingInvoiceDetailDueDate({}, { locale }))
    ).toBeUndefined();
    expect(
      definition(view, m.accountingInvoiceDetailActor({}, { locale }))
    ).toBe(m.accountingInvoiceSourceLegacy({}, { locale }));
  });
});
