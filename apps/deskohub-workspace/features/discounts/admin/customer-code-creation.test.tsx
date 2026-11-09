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
import type { ReactNode } from "react";
import {
  administrationHref,
  localizeAdministrationHref,
} from "@/features/administration/administration-href";
import { m } from "@/features/administration/i18n";
import { discountLabelFor } from "@/features/discounts/discount-label";
import type { Locale } from "@/features/i18n";
import type { DotyposCustomerId } from "@/features/reservation/dotypos-customer";
import { workspaceUseAction } from "@/shared/testing/workspace-component-module-mocks";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";
import type { AdminDiscount } from "./discount-administration.service";

// react-dom decides how to synthesize change events while it is evaluated, so
// the DOM environment must exist before @testing-library/react loads.
registerWorkspaceComponentTestEnv();
const { act, cleanup, fireEvent, render, waitFor } = await import(
  "@testing-library/react"
);

const locale = "en-US";
const back = mock();
const refresh = mock();
const replace = mock();

const navigation = await import("next/navigation");
mock.module("next/navigation", () => ({
  ...navigation,
  useParams: () => ({ locale }),
  useRouter: () => ({ back, push: mock(), refresh, replace }),
  unstable_rethrow: () => {},
}));

mock.module("./actions", () => ({
  createDiscountAdminForm: mock(),
  createDiscountCodeAdminForm: mock(),
  deleteDiscountAdminForm: mock(),
  deleteDiscountCodeAdminForm: mock(),
  mutateDiscountAdmin: mock(),
  searchDiscountAdminCustomers: mock(),
  updateDiscountAdminForm: mock(),
  updateDiscountCodeAdminForm: mock(),
}));

type ActionCallbacks = {
  readonly onSuccess: (result: {
    readonly data?: { readonly notice: string };
  }) => void;
  readonly onError: (result: {
    readonly error: { readonly serverError?: string };
  }) => void;
  readonly onTransportError: () => void;
};

// Each test mounts one form, whose mutation hook reports to the latest options.
let callbacks: ActionCallbacks | undefined;
const execute = mock();
let isExecuting = false;

const report = (run: (actionCallbacks: ActionCallbacks) => void) =>
  act(() => {
    if (!callbacks) throw new Error("The action hook was not mounted.");
    run(callbacks);
  });

const customerId = "dotypos-customer" as DotyposCustomerId;
const discounts: readonly Pick<AdminDiscount, "id" | "labels">[] = [
  {
    id: "019c91dd-c560-7e55-b9d8-c95065efd51d" as AdminDiscount["id"],
    labels: { "cs-CZ": "Letní sleva", "en-US": "Summer discount" },
  },
];
const customerHref = localizeAdministrationHref(
  administrationHref("/[locale]/admin/customers/[customerId]", { customerId }),
  locale
);

const renderInLocale = async (
  node: ReactNode,
  routeLocale: Locale = locale
) => {
  const { RouteLocaleProvider } = await import("@/features/i18n/route-locale");
  return render(
    <RouteLocaleProvider locale={routeLocale}>{node}</RouteLocaleProvider>
  );
};

const renderForm = async (
  props: Partial<{
    readonly completion: "back" | "customer";
    readonly customerId: DotyposCustomerId;
    readonly customerName: string;
    readonly discounts: readonly Pick<AdminDiscount, "id" | "labels">[];
  }> = {}
) => {
  const { DiscountCodeCreationForm } = await import("./customer-code-creation");
  return renderInLocale(
    <DiscountCodeCreationForm discounts={discounts} {...props} />
  );
};

const formName = m.discountsCodeCreateSubmit({}, { locale });
const cancelName = m.discountsCancel({}, { locale });

describe("discount code creation form", () => {
  beforeAll(() => {
    registerWorkspaceComponentTestEnv();
  });

  beforeEach(() => {
    back.mockClear();
    refresh.mockClear();
    replace.mockClear();
    execute.mockReset();
    isExecuting = false;
    callbacks = undefined;
    workspaceUseAction.mockReset();
    workspaceUseAction.mockImplementation((_action, options) => {
      callbacks = options as ActionCallbacks;
      return { execute, isExecuting, result: {} };
    });
  });

  afterEach(() => {
    cleanup();
  });

  afterAll(async () => {
    await unregisterWorkspaceComponentTestEnv();
  });

  test("shows a general code's notice and starts over on request", async () => {
    const view = await renderForm();

    expect(view.queryByRole("button", { name: cancelName })).toBeNull();
    fireEvent.change(
      view.getByRole("textbox", { name: m.discountsCodeLabel({}, { locale }) }),
      { target: { value: "summer10" } }
    );
    fireEvent.submit(view.getByRole("form", { name: formName }));
    await waitFor(() => expect(execute).toHaveBeenCalledTimes(1));

    report(({ onSuccess }) => onSuccess({ data: { notice: "Code created." } }));

    expect(view.getByRole("status").textContent).toContain("Code created.");
    expect(view.queryByRole("form", { name: formName })).toBeNull();
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(back).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();

    fireEvent.click(
      view.getByRole("button", {
        name: m.discountsCodeCreateAnother({}, { locale }),
      })
    );

    expect(view.queryByRole("status")).toBeNull();
    expect(
      view.getByRole("textbox", { name: m.discountsCodeLabel({}, { locale }) })
    ).toHaveProperty("value", "");
  });

  test("ignores a success without data", async () => {
    const view = await renderForm({ completion: "back", customerId });

    report(({ onSuccess }) => onSuccess({}));

    expect(view.getByRole("form", { name: formName })).toBeDefined();
    expect(back).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  test("goes back after a customer code is created or cancelled", async () => {
    const view = await renderForm({
      completion: "back",
      customerId,
      customerName: "Test Customer",
    });

    report(({ onSuccess }) => onSuccess({ data: { notice: "Code created." } }));
    fireEvent.click(view.getByRole("button", { name: cancelName }));

    expect(back).toHaveBeenCalledTimes(2);
    expect(replace).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
    expect(view.queryByRole("status")).toBeNull();
  });

  test("returns to the customer after a customer code is created or cancelled", async () => {
    const view = await renderForm({ completion: "customer", customerId });

    report(({ onSuccess }) => onSuccess({ data: { notice: "Code created." } }));
    fireEvent.click(view.getByRole("button", { name: cancelName }));

    expect(replace.mock.calls).toEqual([[customerHref], [customerHref]]);
    expect(back).not.toHaveBeenCalled();
  });

  test("reports the server's failure, the form check fallback, and a transport failure", async () => {
    const view = await renderForm();

    report(({ onError }) => onError({ error: { serverError: "Code taken." } }));
    expect(view.getByRole("alert").textContent).toBe("Code taken.");

    report(({ onError }) => onError({ error: {} }));
    expect(view.getByRole("alert").textContent).toBe(
      m.discountsCodeCreateFailedCheckForm({}, { locale })
    );

    report(({ onTransportError }) => onTransportError());
    expect(view.getByRole("alert").textContent).toBe(
      m.discountsCodeCreateFailedRetry({}, { locale })
    );
  });

  test("blocks a second submit while the code is being created", async () => {
    isExecuting = true;
    const view = await renderForm();

    expect(
      view.getByRole("button", { name: m.discountsCreating({}, { locale }) })
    ).toHaveProperty("disabled", true);
  });

  test("names each existing discount through its label fallback chain", async () => {
    const { DiscountCodeCreationForm } = await import(
      "./customer-code-creation"
    );
    for (const routeLocale of ["de-DE", "uk-UA", "sk-SK"] as const) {
      const view = await renderInLocale(
        <DiscountCodeCreationForm discounts={discounts} />,
        routeLocale
      );
      const [discount] = discounts;

      expect(
        view.getByRole("option", {
          name: discountLabelFor(discount!.labels, routeLocale),
        })
      ).toBeDefined();
      cleanup();
    }
  });

  test("offers only a new discount when none exist", async () => {
    const view = await renderForm({ discounts: [] });

    expect(
      view.getByRole("radio", {
        name: m.discountsCodeDiscountExisting({}, { locale }),
      })
    ).toHaveProperty("disabled", true);
    expect(
      view.getByRole("radio", {
        name: m.discountsCodeDiscountNew({}, { locale }),
      })
    ).toHaveProperty("checked", true);
    expect(
      view.queryByRole("combobox", {
        name: m.discountsDiscountLabel({}, { locale }),
      })
    ).toBeNull();
  });
});
