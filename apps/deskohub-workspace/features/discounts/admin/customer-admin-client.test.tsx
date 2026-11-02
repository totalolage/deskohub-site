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
import { formatDiscountAdjustment } from "@/features/checkout/format-discount-adjustment";
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
import type { AdminDotyposCustomer } from "./discount-administration.service";

// react-dom decides how to synthesize change events while it is evaluated, so
// the DOM environment must exist before @testing-library/react loads.
registerWorkspaceComponentTestEnv();
const { act, cleanup, fireEvent, render, waitFor, within } = await import(
  "@testing-library/react"
);

const locale = "en-US";
const refresh = mock();

const navigation = await import("next/navigation");
mock.module("next/navigation", () => ({
  ...navigation,
  useParams: () => ({ locale }),
  useRouter: () => ({ back: mock(), push: mock(), refresh, replace: mock() }),
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
  readonly onSuccess: (result: { readonly data?: unknown }) => void;
  readonly onError: (result: {
    readonly error: { readonly serverError?: string };
  }) => void;
  readonly onTransportError: () => void;
};

// Each test mounts one component, so the latest hook options per action are
// the ones its callbacks report to.
type WorkspaceAction =
  | typeof mutateDiscountAdmin
  | typeof searchDiscountAdminCustomers;
const actionCallbacks = new Map<WorkspaceAction, ActionCallbacks>();
const execute = mock();
let isExecuting = false;

const callbacksOf = (action: WorkspaceAction) => {
  const callbacks = actionCallbacks.get(action);
  if (!callbacks) throw new Error("The action hook was not mounted.");
  return callbacks;
};

const report = (
  action: WorkspaceAction,
  run: (callbacks: ActionCallbacks) => void
) => act(() => run(callbacksOf(action)));

const renderInLocale = async (node: ReactNode) => {
  const { RouteLocaleProvider } = await import("@/features/i18n/route-locale");
  return render(
    <RouteLocaleProvider locale={locale}>{node}</RouteLocaleProvider>
  );
};

const customerId = "dotypos-customer" as DotyposCustomerId;
const codeId = "019c91dd-c560-7e55-b9d8-c95065efd52d" as DiscountCodeId;

const customer = (
  overrides: Partial<AdminDotyposCustomer>
): AdminDotyposCustomer => ({
  id: customerId,
  displayName: "Test Customer",
  hasName: true,
  email: testEmailAddress("customer-search"),
  phone: "+420 123 456 789",
  discountGroupId: null,
  ...overrides,
});

describe("customer administration client controls", () => {
  beforeAll(() => {
    registerWorkspaceComponentTestEnv();
  });

  beforeEach(() => {
    refresh.mockClear();
    execute.mockReset();
    isExecuting = false;
    actionCallbacks.clear();
    workspaceUseAction.mockReset();
    workspaceUseAction.mockImplementation((action, options) => {
      actionCallbacks.set(
        action as WorkspaceAction,
        options as ActionCallbacks
      );
      return { execute, isExecuting, result: {} };
    });
  });

  afterEach(() => {
    cleanup();
  });

  afterAll(async () => {
    await unregisterWorkspaceComponentTestEnv();
  });

  describe("customer search", () => {
    const search = async (query: string) => {
      const { CustomerSearch } = await import("./customer-admin-client");
      const view = await renderInLocale(<CustomerSearch />);
      fireEvent.change(
        view.getByRole("searchbox", {
          name: m.discountsCustomerSearchLabel({}, { locale }),
        }),
        { target: { value: query } }
      );
      fireEvent.click(
        view.getByRole("button", {
          name: m.discountsCustomerSearchSubmit({}, { locale }),
        })
      );
      return view;
    };

    // Reports results only once the submit has cleared the previous ones.
    const submittedSearch = async (query: string) => {
      const view = await search(query);
      await waitFor(() => {
        expect(execute).toHaveBeenCalledTimes(1);
      });
      return view;
    };

    test("searches by the trimmed query and lists ambiguous matches with their contacts", async () => {
      const view = await search("  Test  ");
      await waitFor(() => {
        expect(execute).toHaveBeenCalledWith({ query: "Test" });
      });

      const reachable = customer({});
      const unnamed = customer({
        id: "unnamed-customer" as DotyposCustomerId,
        displayName: "—",
        hasName: false,
        email: null,
        phone: null,
      });
      await report(searchDiscountAdminCustomers, ({ onSuccess }) =>
        onSuccess({
          data: { kind: "ambiguous", customers: [reachable, unnamed] },
        })
      );

      expect(
        view.getByText(m.discountsCustomerSearchAmbiguous({}, { locale }))
      ).toBeDefined();
      const items = view.getAllByRole("listitem");
      expect(items).toHaveLength(2);
      const [reachableItem, unnamedItem] = items as [HTMLElement, HTMLElement];
      expect(
        within(reachableItem).getByText(reachable.displayName)
      ).toBeDefined();
      expect(
        within(reachableItem).getByText(
          `${reachable.email} · ${reachable.phone}`
        )
      ).toBeDefined();
      expect(
        within(unnamedItem).getByText(
          m.discountsUnnamedCustomer({}, { locale })
        )
      ).toBeDefined();
      expect(
        within(unnamedItem).getByText(
          m.discountsCustomerNoContactDetails({}, { locale })
        )
      ).toBeDefined();
      expect(
        within(unnamedItem)
          .getByRole("link", { name: m.discountsOpenCustomer({}, { locale }) })
          .getAttribute("href")
      ).toBe(`/${locale}/admin/customers/unnamed-customer`);
    });

    test("shows a single match without the ambiguity note and an empty result as empty", async () => {
      const view = await submittedSearch("Test");
      await report(searchDiscountAdminCustomers, ({ onSuccess }) =>
        onSuccess({ data: { kind: "matched", customers: [customer({})] } })
      );
      expect(view.getAllByRole("listitem")).toHaveLength(1);
      expect(
        view.queryByText(m.discountsCustomerSearchAmbiguous({}, { locale }))
      ).toBeNull();

      await report(searchDiscountAdminCustomers, ({ onSuccess }) =>
        onSuccess({ data: { kind: "not-found", customers: [] } })
      );
      expect(view.queryAllByRole("listitem")).toEqual([]);
      expect(
        view.getByText(m.discountsCustomerSearchEmpty({}, { locale }))
      ).toBeDefined();
    });

    test("ignores a success without data", async () => {
      const view = await submittedSearch("Test");
      await report(searchDiscountAdminCustomers, ({ onSuccess }) =>
        onSuccess({})
      );
      expect(view.queryByRole("list")).toBeNull();
      expect(view.queryByRole("alert")).toBeNull();
    });

    test("shows the server's error, a fallback, or the transport failure and clears results", async () => {
      const view = await submittedSearch("Test");
      await report(searchDiscountAdminCustomers, ({ onSuccess }) =>
        onSuccess({ data: { kind: "matched", customers: [customer({})] } })
      );

      await report(searchDiscountAdminCustomers, ({ onError }) =>
        onError({ error: { serverError: "Dotypos is unavailable." } })
      );
      expect(view.getByRole("alert").textContent).toBe(
        "Dotypos is unavailable."
      );
      expect(view.queryByRole("list")).toBeNull();

      await report(searchDiscountAdminCustomers, ({ onError }) =>
        onError({ error: {} })
      );
      expect(view.getByRole("alert").textContent).toBe(
        m.discountsCustomerSearchFailed({}, { locale })
      );

      await report(searchDiscountAdminCustomers, ({ onSuccess }) =>
        onSuccess({ data: { kind: "matched", customers: [customer({})] } })
      );
      expect(view.queryByRole("alert")).toBeNull();

      await report(searchDiscountAdminCustomers, ({ onTransportError }) =>
        onTransportError()
      );
      expect(view.getByRole("alert").textContent).toBe(
        m.discountsCustomerSearchFailed({}, { locale })
      );
      expect(view.queryByRole("list")).toBeNull();
    });

    test("rejects a query shorter than two characters without searching", async () => {
      const view = await search(" a ");
      await waitFor(() => {
        expect(
          view.getByText(m.discountsValidationSearchQueryLength({}, { locale }))
        ).toBeDefined();
      });
      expect(execute).not.toHaveBeenCalled();
    });

    test("disables the search while it runs", async () => {
      isExecuting = true;
      const { CustomerSearch } = await import("./customer-admin-client");
      const view = await renderInLocale(<CustomerSearch variant="toolbar" />);
      const button = view.getByRole("button", {
        name: m.discountsCustomerSearching({}, { locale }),
      });
      expect(button.hasAttribute("disabled")).toBe(true);
    });
  });

  describe("mutation button", () => {
    const mutation = {
      kind: "make-code-unrestricted",
      codeId,
    } as const;

    const renderButton = async (confirmation?: string) => {
      const { AdminMutationButton } = await import("./customer-admin-client");
      return renderInLocale(
        <AdminMutationButton confirmation={confirmation} mutation={mutation}>
          Open to everyone
        </AdminMutationButton>
      );
    };

    test("runs an unconfirmed mutation and refreshes after it succeeds", async () => {
      const view = await renderButton();
      fireEvent.click(view.getByRole("button", { name: "Open to everyone" }));
      expect(execute).toHaveBeenCalledWith(mutation);

      await report(mutateDiscountAdmin, ({ onSuccess }) => onSuccess({}));
      expect(refresh).toHaveBeenCalledTimes(1);
    });

    test("asks for confirmation and runs only when the operator confirms", async () => {
      const confirm = mock(() => false);
      const originalConfirm = globalThis.confirm;
      globalThis.confirm = confirm;
      try {
        const view = await renderButton("Really?");
        const button = view.getByRole("button", { name: "Open to everyone" });

        fireEvent.click(button);
        expect(confirm).toHaveBeenCalledWith("Really?");
        expect(execute).not.toHaveBeenCalled();

        confirm.mockReturnValue(true);
        fireEvent.click(button);
        expect(execute).toHaveBeenCalledWith(mutation);
      } finally {
        globalThis.confirm = originalConfirm;
      }
    });

    test("shows the server's error or a fallback and clears it on the next click", async () => {
      const view = await renderButton();
      await report(mutateDiscountAdmin, ({ onError }) =>
        onError({ error: { serverError: "Code is gone." } })
      );
      expect(view.getByRole("alert").textContent).toBe("Code is gone.");

      await report(mutateDiscountAdmin, ({ onError }) =>
        onError({ error: {} })
      );
      expect(view.getByRole("alert").textContent).toBe(
        m.discountsSaveFailed({}, { locale })
      );

      await report(mutateDiscountAdmin, ({ onTransportError }) =>
        onTransportError()
      );
      expect(view.getByRole("alert").textContent).toBe(
        m.discountsSaveFailedRetry({}, { locale })
      );

      fireEvent.click(view.getByRole("button", { name: "Open to everyone" }));
      expect(view.queryByRole("alert")).toBeNull();
    });

    test("shows that it is saving while the mutation runs", async () => {
      isExecuting = true;
      const view = await renderButton();
      const button = view.getByRole("button", {
        name: m.discountsSaving({}, { locale }),
      });
      expect(button.hasAttribute("disabled")).toBe(true);
    });
  });

  describe("mutation forms", () => {
    test("adds a customer to a code and clears the form after it saves", async () => {
      const { AddCodeCustomerForm } = await import("./customer-admin-client");
      const view = await renderInLocale(
        <AddCodeCustomerForm codeId={codeId} />
      );
      const input = view.getByRole("textbox", {
        name: m.discountsDotyposCustomerIdLabel({}, { locale }),
      }) as HTMLInputElement;
      fireEvent.change(input, { target: { value: ` ${customerId} ` } });
      fireEvent.click(
        view.getByRole("button", {
          name: m.discountsAddCustomer({}, { locale }),
        })
      );
      await waitFor(() => {
        expect(execute).toHaveBeenCalledWith({
          kind: "add-code-customer",
          codeId,
          customerId,
        });
      });

      await report(mutateDiscountAdmin, ({ onSuccess }) =>
        onSuccess({ data: { notice: "Customer added." } })
      );
      expect(view.getByRole("status").textContent).toBe("Customer added.");
      expect(input.value).toBe("");
      expect(refresh).toHaveBeenCalledTimes(1);
    });

    test("adds a customer to a voucher by the trimmed Dotypos id", async () => {
      const { AddVoucherCustomerForm } = await import(
        "./customer-admin-client"
      );
      const voucherId = "019c91dd-c560-7e55-b9d8-c95065efd55d" as VoucherId;
      const view = await renderInLocale(
        <AddVoucherCustomerForm voucherId={voucherId} />
      );
      fireEvent.change(
        view.getByRole("textbox", {
          name: m.discountsDotyposCustomerIdLabel({}, { locale }),
        }),
        { target: { value: ` ${customerId} ` } }
      );
      fireEvent.click(
        view.getByRole("button", {
          name: m.discountsAddCustomer({}, { locale }),
        })
      );
      await waitFor(() => {
        expect(execute).toHaveBeenCalledWith({
          kind: "add-voucher-customer",
          voucherId,
          customerId,
        });
      });
    });

    test("ignores a mutation success without data", async () => {
      const { AddCodeCustomerForm } = await import("./customer-admin-client");
      const view = await renderInLocale(
        <AddCodeCustomerForm codeId={codeId} />
      );
      await report(mutateDiscountAdmin, ({ onSuccess }) => onSuccess({}));
      expect(view.queryByRole("status")).toBeNull();
      expect(refresh).not.toHaveBeenCalled();
    });

    test("reports a form's save failures as alerts", async () => {
      const { AddCodeCustomerForm } = await import("./customer-admin-client");
      const view = await renderInLocale(
        <AddCodeCustomerForm codeId={codeId} />
      );
      await report(mutateDiscountAdmin, ({ onError }) =>
        onError({ error: { serverError: "Customer not found." } })
      );
      expect(view.getByRole("alert").textContent).toBe("Customer not found.");

      await report(mutateDiscountAdmin, ({ onError }) =>
        onError({ error: {} })
      );
      expect(view.getByRole("alert").textContent).toBe(
        m.discountsSaveFailed({}, { locale })
      );

      await report(mutateDiscountAdmin, ({ onTransportError }) =>
        onTransportError()
      );
      expect(view.getByRole("alert").textContent).toBe(
        m.discountsSaveFailedRetry({}, { locale })
      );
    });

    test("keeps the saved discount group selected after it saves", async () => {
      const { CustomerDiscountGroupForm } = await import(
        "./customer-admin-client"
      );
      const groups = [
        { id: "group-a", name: "Regulars", basisPoints: 1000 },
        { id: "group-b", name: "Friends", basisPoints: 2500 },
      ] as const;
      const view = await renderInLocale(
        <CustomerDiscountGroupForm
          currentGroupId={null}
          customerId={customerId}
          discountGroups={groups as never}
        />
      );
      const select = view.getByRole("combobox", {
        name: m.discountsCustomerDiscountGroupTitle({}, { locale }),
      }) as HTMLSelectElement;
      expect(
        within(select).getByRole("option", {
          name: `Friends (${formatDiscountAdjustment({ kind: "percentage", basisPoints: 2500 }, locale)})`,
        })
      ).toBeDefined();

      fireEvent.change(select, { target: { value: "group-b" } });
      fireEvent.click(
        view.getByRole("button", { name: m.discountsSaveGroup({}, { locale }) })
      );
      await waitFor(() => {
        expect(execute).toHaveBeenCalledWith({
          kind: "set-customer-discount-group",
          customerId,
          discountGroupId: "group-b",
        });
      });

      await report(mutateDiscountAdmin, ({ onSuccess }) =>
        onSuccess({ data: { notice: "Group saved." } })
      );
      expect(select.value).toBe("group-b");
      expect(view.getByRole("status").textContent).toBe("Group saved.");
      expect(refresh).toHaveBeenCalledTimes(1);
    });
  });
});
