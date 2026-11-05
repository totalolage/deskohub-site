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
import { testEmailAddress } from "@deskohub/test-email";
import type { ReactNode } from "react";
import { m } from "@/features/administration/i18n";
import type {
  DiscountCodeId,
  VoucherId,
} from "@/features/discounts/persistence-contracts";
import type { DotyposCustomerId } from "@/features/reservation/dotypos-customer";
import { workspaceUseAction } from "@/shared/testing/workspace-component-module-mocks";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";
import type { DiscountAdminMutation } from "./contracts";
import type { AdminDotyposCustomer } from "./discount-administration.service";

// react-dom decides how to synthesize change events while it is evaluated, so
// the DOM environment must exist before @testing-library/react loads.
registerWorkspaceComponentTestEnv();
const { act, cleanup, fireEvent, render, waitFor } = await import(
  "@testing-library/react"
);

const locale = "en-US";
const push = mock();
const refresh = mock();

const navigation = await import("next/navigation");
mock.module("next/navigation", () => ({
  ...navigation,
  useParams: () => ({ locale }),
  useRouter: () => ({ back: mock(), push, refresh, replace: mock() }),
  unstable_rethrow: () => {},
}));

const mutateDiscountAdmin = mock();
const searchDiscountAdminCustomers = mock();
mock.module("./actions", () => ({
  createDiscountAdminForm: mock(),
  createDiscountCodeAdminForm: mock(),
  deleteDiscountAdminForm: mock(),
  deleteDiscountCodeAdminForm: mock(),
  mutateDiscountAdmin,
  searchDiscountAdminCustomers,
  updateDiscountAdminForm: mock(),
  updateDiscountCodeAdminForm: mock(),
}));

type ActionCallbacks = {
  readonly onSuccess: (result: {
    readonly data?: unknown;
    readonly input?: unknown;
  }) => void;
};

type WorkspaceAction =
  | typeof mutateDiscountAdmin
  | typeof searchDiscountAdminCustomers;
const actionCallbacks = new Map<WorkspaceAction, ActionCallbacks>();
const executions = new Map<WorkspaceAction, ReturnType<typeof mock>>();

const executeOf = (action: WorkspaceAction) => {
  const execute = executions.get(action);
  if (!execute) throw new Error("The action hook was not mounted.");
  return execute;
};

const report = (
  action: WorkspaceAction,
  result: Parameters<ActionCallbacks["onSuccess"]>[0]
) =>
  act(() => {
    const callbacks = actionCallbacks.get(action);
    if (!callbacks) throw new Error("The action hook was not mounted.");
    callbacks.onSuccess(result);
  });

const renderInLocale = async (node: ReactNode) => {
  const { RouteLocaleProvider } = await import("@/features/i18n/route-locale");
  return render(
    <RouteLocaleProvider locale={locale}>{node}</RouteLocaleProvider>
  );
};

const customerId = "dotypos-customer" as DotyposCustomerId;
const otherCustomerId = "other-customer" as DotyposCustomerId;
const codeId = "019c91dd-c560-7e55-b9d8-c95065efd52d" as DiscountCodeId;
const voucherId = "019c91dd-c560-7e55-b9d8-c95065efd55d" as VoucherId;

const searchMatch: AdminDotyposCustomer = {
  id: customerId,
  displayName: "Test Customer",
  hasName: true,
  email: testEmailAddress("promotion-customers"),
  phone: null,
  discountGroupId: null,
};

/** Searches for the one customer the picker then offers to add or remove. */
const findCustomer = async (
  view: Awaited<ReturnType<typeof renderInLocale>>
) => {
  fireEvent.change(
    view.getByRole("searchbox", {
      name: m.discountsCustomerSearchLabel({}, { locale }),
    }),
    { target: { value: "Test" } }
  );
  fireEvent.click(
    view.getByRole("button", {
      name: m.discountsCustomerSearchSubmit({}, { locale }),
    })
  );
  await waitFor(() => {
    expect(executeOf(searchDiscountAdminCustomers)).toHaveBeenCalledWith({
      query: "Test",
    });
  });
  await report(searchDiscountAdminCustomers, {
    data: { kind: "matched", customers: [searchMatch] },
  });
};

const confirmDialog = async (
  view: Awaited<ReturnType<typeof renderInLocale>>,
  confirmLabel: string
) => {
  await view.findByRole("dialog");
  fireEvent.click(view.getByRole("button", { name: confirmLabel }));
};

describe("promotion customer picker", () => {
  beforeAll(() => {
    registerWorkspaceComponentTestEnv();
  });

  beforeEach(() => {
    push.mockClear();
    refresh.mockClear();
    actionCallbacks.clear();
    executions.clear();
    workspaceUseAction.mockReset();
    workspaceUseAction.mockImplementation((action, options) => {
      actionCallbacks.set(
        action as WorkspaceAction,
        options as ActionCallbacks
      );
      const execute = executions.get(action as WorkspaceAction) ?? mock();
      executions.set(action as WorkspaceAction, execute);
      return { execute, isExecuting: false, result: {} };
    });
  });

  afterEach(() => {
    cleanup();
  });

  afterAll(async () => {
    await unregisterWorkspaceComponentTestEnv();
  });

  test("limits an unrestricted code to a found customer", async () => {
    const { PromotionCustomerPicker } = await import("./promotion-customers");
    const view = await renderInLocale(
      <PromotionCustomerPicker
        audienceCustomerIds={[]}
        code="SUMMER10"
        promotion={{ kind: "discount-code", id: codeId }}
      />
    );
    await findCustomer(view);

    expect(
      view.queryByText(m.discountsCustomerInAudience({}, { locale }))
    ).toBeNull();
    fireEvent.click(
      view.getByRole("button", { name: "Add Test Customer to SUMMER10" })
    );
    await confirmDialog(view, m.discountsLimitToCustomer({}, { locale }));
    const mutation: DiscountAdminMutation = {
      kind: "add-code-customer",
      codeId,
      customerId,
    };
    expect(executeOf(mutateDiscountAdmin)).toHaveBeenLastCalledWith(mutation);

    await report(mutateDiscountAdmin, {
      data: { notice: "Customer added." },
      input: mutation,
    });
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(push).not.toHaveBeenCalled();
  });

  test("adds a found customer to a voucher limited to other customers", async () => {
    const { PromotionCustomerPicker } = await import("./promotion-customers");
    const view = await renderInLocale(
      <PromotionCustomerPicker
        audienceCustomerIds={[otherCustomerId]}
        code="GIFT100"
        promotion={{ kind: "voucher", id: voucherId }}
      />
    );
    await findCustomer(view);

    fireEvent.click(
      view.getByRole("button", { name: "Add Test Customer to GIFT100" })
    );
    await confirmDialog(view, m.discountsAddCustomer({}, { locale }));
    expect(executeOf(mutateDiscountAdmin)).toHaveBeenLastCalledWith({
      kind: "add-voucher-customer",
      voucherId,
      customerId,
    });
  });

  test("marks a found customer already in the audience and removes them", async () => {
    const { PromotionCustomerPicker } = await import("./promotion-customers");
    const view = await renderInLocale(
      <PromotionCustomerPicker
        audienceCustomerIds={[otherCustomerId, customerId]}
        code="SUMMER10"
        promotion={{ kind: "discount-code", id: codeId }}
      />
    );
    await findCustomer(view);

    expect(
      view.getByText(m.discountsCustomerInAudience({}, { locale }))
    ).toBeDefined();
    const remove = view.getByRole("button", {
      name: "Remove Test Customer from SUMMER10",
    });
    expect(remove.textContent).toBe(m.discountsRemove({}, { locale }));
    fireEvent.click(remove);
    await confirmDialog(view, m.discountsRemoveCustomer({}, { locale }));
    expect(executeOf(mutateDiscountAdmin)).toHaveBeenLastCalledWith({
      kind: "remove-code-customer",
      codeId,
      customerId,
    });
  });

  test("leaves the deleted code's page after removing its only customer deletes it", async () => {
    const { administrationHref } = await import(
      "@/features/administration/administration-href"
    );
    const { PromotionCustomerPicker } = await import("./promotion-customers");
    const view = await renderInLocale(
      <PromotionCustomerPicker
        audienceCustomerIds={[customerId]}
        code="SUMMER10"
        deleteRedirect={administrationHref("/[locale]/admin/codes")}
        promotion={{ kind: "discount-code", id: codeId }}
      />
    );
    await findCustomer(view);

    fireEvent.click(
      view.getByRole("button", { name: "Remove Test Customer from SUMMER10" })
    );
    await confirmDialog(view, m.discountsDeleteCode({}, { locale }));
    const mutation: DiscountAdminMutation = { kind: "delete-code", id: codeId };
    expect(executeOf(mutateDiscountAdmin)).toHaveBeenLastCalledWith(mutation);

    await report(mutateDiscountAdmin, {
      data: { notice: "Code deleted." },
      input: mutation,
    });
    expect(push).toHaveBeenCalledWith(`/${locale}/admin/codes`);
    expect(refresh).not.toHaveBeenCalled();
  });

  test("stays on the page when removing the only customer opens the code to everyone", async () => {
    const { administrationHref } = await import(
      "@/features/administration/administration-href"
    );
    const { PromotionCustomerPicker } = await import("./promotion-customers");
    const view = await renderInLocale(
      <PromotionCustomerPicker
        audienceCustomerIds={[customerId]}
        code="SUMMER10"
        deleteRedirect={administrationHref("/[locale]/admin/codes")}
        promotion={{ kind: "discount-code", id: codeId }}
      />
    );
    await findCustomer(view);

    fireEvent.click(
      view.getByRole("button", { name: "Remove Test Customer from SUMMER10" })
    );
    await confirmDialog(view, m.discountsMakeAvailableToAll({}, { locale }));
    const mutation: DiscountAdminMutation = {
      kind: "make-code-unrestricted",
      codeId,
    };
    expect(executeOf(mutateDiscountAdmin)).toHaveBeenLastCalledWith(mutation);

    await report(mutateDiscountAdmin, {
      data: { notice: "Code opened to everyone." },
      input: mutation,
    });
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(push).not.toHaveBeenCalled();
  });

  test("keeps the search results and offers removal once the refreshed audience includes the added customer", async () => {
    const { RouteLocaleProvider } = await import(
      "@/features/i18n/route-locale"
    );
    const { PromotionCustomerPicker } = await import("./promotion-customers");
    const picker = (audienceCustomerIds: readonly DotyposCustomerId[]) => (
      <RouteLocaleProvider locale={locale}>
        <PromotionCustomerPicker
          audienceCustomerIds={audienceCustomerIds}
          code="SUMMER10"
          promotion={{ kind: "discount-code", id: codeId }}
        />
      </RouteLocaleProvider>
    );
    const view = render(picker([otherCustomerId]));
    await findCustomer(view);
    expect(
      view.getByRole("button", { name: "Add Test Customer to SUMMER10" })
    ).toBeDefined();

    view.rerender(picker([otherCustomerId, customerId]));
    expect(
      view.getByRole("button", { name: "Remove Test Customer from SUMMER10" })
    ).toBeDefined();
    expect(
      view.getByText(m.discountsCustomerInAudience({}, { locale }))
    ).toBeDefined();
  });
});

describe("promotion customers panel", () => {
  beforeAll(() => {
    registerWorkspaceComponentTestEnv();
  });

  beforeEach(() => {
    workspaceUseAction.mockReset();
    workspaceUseAction.mockImplementation(() => ({
      execute: mock(),
      isExecuting: false,
      result: {},
    }));
  });

  afterEach(() => {
    cleanup();
  });

  afterAll(async () => {
    await unregisterWorkspaceComponentTestEnv();
  });

  test("offers customer search on an unrestricted code without a customer list link", async () => {
    const { PromotionCustomersPanel } = await import("./promotion-customers");
    const view = await renderInLocale(
      <PromotionCustomersPanel
        audienceCustomerIds={[]}
        code="SUMMER10"
        promotion={{ kind: "discount-code", id: codeId }}
      />
    );
    expect(
      view.getByRole("heading", {
        name: m.discountsColumnAudience({}, { locale }),
      })
    ).toBeDefined();
    expect(
      view.getByRole("searchbox", {
        name: m.discountsCustomerSearchLabel({}, { locale }),
      })
    ).toBeDefined();
    expect(
      view.queryByRole("link", {
        name: m.discountsShowAudienceCustomers({}, { locale }),
      })
    ).toBeNull();
  });

  test("links a restricted voucher to the page that lists its customers", async () => {
    const { PromotionCustomersPanel } = await import("./promotion-customers");
    const view = await renderInLocale(
      <PromotionCustomersPanel
        audienceCustomerIds={[customerId, otherCustomerId]}
        code="GIFT100"
        promotion={{ kind: "voucher", id: voucherId }}
      />
    );
    expect(
      view
        .getByRole("link", {
          name: m.discountsShowAudienceCustomers({}, { locale }),
        })
        .getAttribute("href")
    ).toBe(`/${locale}/admin/vouchers/${voucherId}`);
  });
});
