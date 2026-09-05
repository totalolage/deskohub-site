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
  act,
  cleanup,
  fireEvent,
  render,
  waitFor,
  within,
} from "@testing-library/react";
import { Profiler, StrictMode } from "react";
import { AdministrationTableToolbar } from "@/features/administration/components";
import { loadFixtureReservations } from "@/features/administration/fixtures";
import { workspaceUseAction } from "@/shared/testing/workspace-component-module-mocks";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";
import type {
  AdminCustomerProfile,
  DiscountAdminDashboard,
} from "./discount-administration.service";

const refresh = mock();
const back = mock();
const replace = mock();
const emptyReservationActivity = {
  from: "2025-08-25",
  to: "2026-08-24",
  dates: [],
} as const;

mock.module("next/navigation", () => ({
  useRouter: () => ({
    back,
    refresh,
    replace,
  }),
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

const dashboard: DiscountAdminDashboard = {
  discounts: [
    {
      id: "019c91dd-c560-7e55-b9d8-c95065efd51d",
      labels: {
        "cs-CZ": "Letní sleva",
        "en-US": "Summer discount",
      },
      adjustment: { kind: "percentage", basisPoints: 1000 },
      products: [{ kind: "cowork" }],
      codeCount: 1,
      createdAt: Temporal.Instant.from("2026-07-01T08:00:00Z"),
      updatedAt: Temporal.Instant.from("2026-07-02T08:00:00Z"),
    },
  ],
  codes: [
    {
      id: "019c91dd-c560-7e55-b9d8-c95065efd52d",
      discountId: "019c91dd-c560-7e55-b9d8-c95065efd51d",
      code: "SUMMER10",
      enabled: true,
      validFrom: Temporal.Instant.from("2026-08-01T08:00:00Z"),
      validUntil: Temporal.Instant.from("2026-09-01T08:00:00Z"),
      maxUses: 100,
      maxUsesPerCustomer: 2,
      audienceSize: 2,
      reservedUses: 1,
      redeemedUses: 3,
      releasedUses: 1,
      remainingUses: 96,
      createdAt: Temporal.Instant.from("2026-07-01T08:00:00Z"),
      updatedAt: Temporal.Instant.from("2026-07-02T08:00:00Z"),
    },
  ],
  vouchers: [],
  calendar: {
    events: [
      {
        eventReference: "calendar-event",
        title: "Summer sale",
        description: "019c91dd-c560-7e55-b9d8-c95065efd51d",
        start: "2026-08-01",
        end: "2026-08-02",
        status: "tentative",
        eventUrl: "https://calendar.google.com/event?eid=test",
        association: {
          kind: "associated",
          discountId: "019c91dd-c560-7e55-b9d8-c95065efd51d",
          discountLabel: "Summer discount",
        },
      },
    ],
    unavailable: false,
    calendarUrl: "https://calendar.google.com/",
    from: "2026-07-01",
    to: "2027-07-01",
  },
};

describe("discount administration pages", () => {
  beforeAll(() => {
    registerWorkspaceComponentTestEnv();
  });

  beforeEach(() => {
    back.mockClear();
    refresh.mockClear();
    replace.mockClear();
    workspaceUseAction.mockReset();
    workspaceUseAction.mockReturnValue({
      execute: mock(),
      isExecuting: false,
      result: {},
    });
  });

  afterEach(() => {
    cleanup();
  });

  afterAll(() => {
    unregisterWorkspaceComponentTestEnv();
  });

  test("searches customers with one fuzzy name or email query", async () => {
    const { CustomerSearch } = await import("./customer-admin-client");
    const view = render(<CustomerSearch />);

    const searchboxes = view.getAllByRole("searchbox", {
      name: "Customer name or email",
    });
    expect(searchboxes).toHaveLength(1);
    expect(view.getByRole("button", { name: "Find customer" })).toBeDefined();
    expect(view.queryByRole("combobox", { name: "Search by" })).toBeNull();
  });

  test("uses the shared compact list count on codes and sales", async () => {
    const { CodesAdministrationActions, CodesAdministrationCollection } =
      await import("./components");
    const codes = render(
      <>
        <AdministrationTableToolbar
          actions={<CodesAdministrationActions dashboard={dashboard} />}
          count={dashboard.codes.length}
          itemLabel="discount code"
        />
        <CodesAdministrationCollection dashboard={dashboard} />
      </>
    );

    expect(codes.getByLabelText("1 discount code").textContent).toBe("1");
    cleanup();

    const { SalesAdministrationActions, SalesAdministrationCollection } =
      await import("./components");
    const sales = render(
      <>
        <AdministrationTableToolbar
          actions={<SalesAdministrationActions />}
          count={dashboard.calendar.events.length}
          itemLabel="sale"
        />
        <SalesAdministrationCollection dashboard={dashboard} />
      </>
    );

    expect(sales.getByLabelText("1 sale").textContent).toBe("1");
  });

  test("uses a sortable table and a percentage editor with a dirty save state", async () => {
    const { CodesAdministrationCollection } = await import("./components");
    const view = render(
      <CodesAdministrationCollection dashboard={dashboard} />
    );

    expect(view.getByRole("table", { name: "Discount codes" })).toBeDefined();
    fireEvent.click(
      view.getByRole("button", {
        name: "Edit SUMMER10",
      })
    );

    const percentage = view.container.querySelector(
      "#percentage-019c91dd-c560-7e55-b9d8-c95065efd51d"
    ) as HTMLInputElement;
    expect(percentage.step).toBe("0.01");
    expect(percentage.value).toBe("10");
    expect(
      view.container.querySelector(
        "#fixedAmountValue-019c91dd-c560-7e55-b9d8-c95065efd51d"
      )
    ).toBeNull();
    expect(
      within(percentage.closest("form")!)
        .getAllByRole("checkbox")
        .map((checkbox) => checkbox.closest("label")?.textContent?.trim())
    ).toEqual(["Cowork", "Meeting room", "Private office"]);
    expect(view.queryByText("Cowork Basic")).toBeNull();

    const save = view.getByRole("button", { name: "Save discount" });
    expect(save).toHaveProperty("disabled", true);
    fireEvent.input(
      view.container.querySelector(
        "#labelEn-019c91dd-c560-7e55-b9d8-c95065efd51d"
      ) as HTMLInputElement,
      { target: { value: "Updated summer discount" } }
    );
    expect(save).toHaveProperty("disabled", false);
  });

  test("sorts code rows without entering a render loop", async () => {
    const sortableDashboard: DiscountAdminDashboard = {
      ...dashboard,
      codes: [
        ...dashboard.codes,
        {
          ...dashboard.codes[0],
          id: "019c91dd-c560-7e55-b9d8-c95065efd53d",
          code: "AUTUMN10",
        },
      ],
    };
    const { CodesAdministrationCollection } = await import("./components");
    let renderCount = 0;
    const view = render(
      <StrictMode>
        <Profiler
          id="discounts-administration"
          onRender={() => {
            renderCount += 1;
            if (renderCount > 20) {
              throw new Error("Discount sorting entered a render loop.");
            }
          }}
        >
          <CodesAdministrationCollection dashboard={sortableDashboard} />
        </Profiler>
      </StrictMode>
    );
    const table = view.getByRole("table", { name: "Discount codes" });
    const labelHeader = within(table).getByRole("button", {
      name: "Code",
    });

    await act(() => new Promise<void>((resolve) => queueMicrotask(resolve)));
    fireEvent.click(labelHeader);
    await act(() => new Promise<void>((resolve) => setTimeout(resolve, 50)));

    await waitFor(() => {
      expect(labelHeader.closest("th")?.getAttribute("aria-sort")).toBe(
        "ascending"
      );
      expect(within(table).getAllByRole("row")[1]?.textContent).toContain(
        "AUTUMN10"
      );
      expect(renderCount).toBeLessThan(20);
    });
  });

  test("uses local datetime controls and renders server errors inline", async () => {
    let actionOptions:
      | {
          onError: (args: {
            error: {
              serverError?: string;
            };
          }) => void;
        }
      | undefined;
    workspaceUseAction.mockImplementation((_action, options) => {
      const candidate = options as typeof actionOptions & {
        actionName?: string;
      };
      if (candidate?.actionName?.startsWith("updateDiscountCode.")) {
        actionOptions = candidate;
      }
      return {
        execute: mock(),
        isExecuting: false,
        result: {},
      };
    });

    const { CodesAdministrationCollection } = await import("./components");
    const view = render(
      <CodesAdministrationCollection dashboard={dashboard} />
    );

    expect(view.getByRole("table", { name: "Discount codes" })).toBeDefined();
    expect(view.queryByRole("table", { name: "Discounts" })).toBeNull();
    fireEvent.click(
      view.getByRole("button", {
        name: "Edit SUMMER10",
      })
    );

    const validFrom = view.container.querySelector(
      "#validFrom-019c91dd-c560-7e55-b9d8-c95065efd52d"
    ) as HTMLInputElement;
    expect(validFrom.type).toBe("datetime-local");
    expect(validFrom.value).toBe("2026-08-01T10:00");
    expect(
      view.container.querySelector(
        "#labelEn-019c91dd-c560-7e55-b9d8-c95065efd51d"
      )
    ).not.toBeNull();
    expect(
      view.getByRole("spinbutton", { name: "Maximum uses per customer" })
    ).toHaveProperty("value", "2");
    expect(view.getByRole("button", { name: "Save discount" })).toBeDefined();

    act(() => {
      actionOptions?.onError({
        error: { serverError: "A code with this value already exists." },
      });
    });
    await waitFor(() =>
      expect(view.getByRole("alert").textContent).toContain(
        "A code with this value already exists."
      )
    );
    expect(validFrom).toHaveProperty("value", "2026-08-01T10:00");
  });

  test("lists and updates voucher credit without discount or use fields", async () => {
    const execute = mock();
    workspaceUseAction.mockReturnValue({
      execute,
      isExecuting: false,
      result: {},
    });
    const voucher = {
      id: "019c91dd-c560-7e55-b9d8-c95065efd53d",
      issuedCredit: { value: 10_000, exponent: 2, currency: "CZK" },
      remainingCredit: {
        value: 6500,
        exponent: 2,
        currency: "CZK",
      },
      code: "GIFT100",
      enabled: true,
      validFrom: null,
      validUntil: null,
      audienceSize: 0,
      reservedUses: 0,
      redeemedUses: 1,
      releasedUses: 0,
      createdAt: Temporal.Instant.from("2026-07-01T08:00:00Z"),
      updatedAt: Temporal.Instant.from("2026-07-02T08:00:00Z"),
    };
    const { VouchersAdministrationCollection } = await import("./components");
    const view = render(
      <VouchersAdministrationCollection dashboard={{ vouchers: [voucher] }} />
    );

    expect(view.getByText(/CZK.?100/)).toBeDefined();
    expect(view.getByText(/CZK.?65/)).toBeDefined();
    fireEvent.click(view.getByRole("button", { name: "Edit GIFT100" }));
    const credit = view.getByRole("spinbutton", {
      name: "Value in minor units",
    });
    expect(credit).toHaveProperty("value", "10000");
    expect(view.queryByRole("combobox", { name: "Discount" })).toBeNull();
    expect(view.queryByRole("spinbutton", { name: "Maximum uses" })).toBeNull();

    fireEvent.input(credit, { target: { value: "15000" } });
    fireEvent.submit(
      view.getByRole("button", { name: "Save voucher" }).closest("form")!
    );
    expect(execute).toHaveBeenCalledWith({
      kind: "update-voucher",
      voucher: {
        id: voucher.id,
        code: "GIFT100",
        credit: { value: 15_000, exponent: 2, currency: "CZK" },
        enabled: true,
        validFrom: null,
        validUntil: null,
      },
    });
  });

  test("creates vouchers through their own administration dialog", async () => {
    const execute = mock();
    workspaceUseAction.mockReturnValue({
      execute,
      isExecuting: false,
      result: {},
    });
    const { VouchersAdministrationActions } = await import("./components");
    const view = render(<VouchersAdministrationActions />);

    fireEvent.click(view.getByRole("button", { name: "Create a voucher" }));
    expect(
      view.getByLabelText("Valid from").closest("label")?.parentElement
        ?.className
    ).toContain("md:grid-cols-2");
    fireEvent.change(view.getByRole("textbox", { name: "Code" }), {
      target: { value: "gift100" },
    });
    fireEvent.submit(
      view.getByRole("button", { name: "Create voucher" }).closest("form")!
    );

    expect(execute).toHaveBeenCalledWith({
      kind: "create-voucher",
      voucher: {
        code: "GIFT100",
        credit: { value: 10_000, exponent: 2, currency: "CZK" },
        enabled: true,
        validFrom: null,
        validUntil: null,
      },
    });
  });

  test("links codes to audience management and shows live capacity", async () => {
    const { CodesAdministrationCollection } = await import("./components");
    const view = render(
      <CodesAdministrationCollection dashboard={dashboard} />
    );
    const table = view.getByRole("table", { name: "Discount codes" });

    expect(
      within(table).getByRole("link", { name: "SUMMER10" }).getAttribute("href")
    ).toBe("/admin/codes/019c91dd-c560-7e55-b9d8-c95065efd52d");
    expect(
      within(table).getByRole("columnheader", { name: "Uses per customer" })
    ).toBeDefined();
    expect(within(table).getByText("2 customers")).toBeDefined();
    expect(within(table).getByText("96")).toBeDefined();
  });

  test("expands a code from its row while preserving nested actions", async () => {
    const { CodesAdministrationCollection } = await import("./components");
    const view = render(
      <CodesAdministrationCollection dashboard={dashboard} />
    );
    const table = view.getByRole("table", { name: "Discount codes" });
    const codeLink = within(table).getByRole("link", { name: "SUMMER10" });
    const codeRow = codeLink.closest("tr");
    expect(codeRow).not.toBeNull();
    if (!codeRow) return;

    expect(
      within(codeRow).getByRole("button", { name: "Delete SUMMER10" })
    ).toBeDefined();
    fireEvent.click(within(codeRow).getByText("2 customers"));

    expect(view.getByRole("button", { name: "Save code" })).toBeDefined();
    expect(
      within(codeRow).getByRole("button", { name: "Delete SUMMER10" })
    ).toBeDefined();
    expect(
      view.getAllByRole("button", { name: "Delete SUMMER10" })
    ).toHaveLength(1);

    fireEvent.click(codeLink);
    expect(view.getByRole("button", { name: "Save code" })).toBeDefined();

    fireEvent.click(within(codeRow).getByText("2 customers"));
    expect(view.queryByRole("button", { name: "Save code" })).toBeNull();
  });

  test("expands a code row from the keyboard", async () => {
    const { CodesAdministrationCollection } = await import("./components");
    const view = render(
      <CodesAdministrationCollection dashboard={dashboard} />
    );
    const table = view.getByRole("table", { name: "Discount codes" });
    const codeRow = within(table)
      .getByRole("link", { name: "SUMMER10" })
      .closest("tr");
    expect(codeRow).not.toBeNull();
    if (!codeRow) return;

    expect(codeRow.getAttribute("tabindex")).toBe("0");
    fireEvent.keyDown(codeRow, { key: "Enter" });
    expect(view.getByRole("button", { name: "Save code" })).toBeDefined();

    fireEvent.keyDown(codeRow, { key: " " });
    expect(view.queryByRole("button", { name: "Save code" })).toBeNull();
  });

  test("creates a code and its discount together when no definitions exist", async () => {
    const { CodesAdministrationActions } = await import("./components");
    const view = render(
      <CodesAdministrationActions
        dashboard={{ ...dashboard, codes: [], discounts: [] }}
      />
    );

    expect(
      view.queryByRole("form", { name: "Create discount code" })
    ).toBeNull();
    fireEvent.click(view.getByText("Create a discount code"));
    expect(view.getByRole("dialog")).toBeDefined();
    expect(
      view.getByRole("heading", { name: "Create a discount code" })
    ).toBeDefined();
    expect(
      view.getByRole("radio", { name: "Create a new discount" })
    ).toHaveProperty("checked", true);
    expect(
      view.getByRole("textbox", { name: "English (en-US)" })
    ).toBeDefined();
  });

  test("generates a valid code only while creating a discount code", async () => {
    const { CodesAdministrationActions, CodesAdministrationCollection } =
      await import("./components");
    const view = render(<CodesAdministrationActions dashboard={dashboard} />);

    fireEvent.click(view.getByText("Create a discount code"));
    const creationForm = view.getByRole("form", {
      name: "Create discount code",
    });
    const codeInput = within(creationForm).getByRole("textbox", {
      name: "Code",
    }) as HTMLInputElement;

    expect(codeInput.value).toBe("");
    fireEvent.click(
      within(creationForm).getByRole("button", { name: "Generate code" })
    );
    expect(codeInput.value).toMatch(/^[A-HJ-NP-Z2-9]{6}-[A-HJ-NP-Z2-9]{6}$/);

    cleanup();
    const editorView = render(
      <CodesAdministrationCollection dashboard={dashboard} />
    );
    fireEvent.click(editorView.getByText("2 customers"));
    expect(
      editorView.queryByRole("button", { name: "Generate code" })
    ).toBeNull();
  });

  test("confirms a general code creation before allowing another submission", async () => {
    let onSuccess:
      | ((result: { data?: { notice: string } }) => void)
      | undefined;
    workspaceUseAction.mockImplementation((_action, options) => {
      const candidate = options as {
        actionName?: string;
        onSuccess?: typeof onSuccess;
      };
      if (candidate.actionName === "createCustomerDiscountCode") {
        onSuccess = candidate.onSuccess;
      }
      return {
        execute: mock(),
        isExecuting: false,
        result: {},
      };
    });
    const { CodesAdministrationActions } = await import("./components");
    const view = render(<CodesAdministrationActions dashboard={dashboard} />);

    fireEvent.click(view.getByText("Create a discount code"));
    expect(
      view.getByRole("form", { name: "Create discount code" })
    ).toBeDefined();

    act(() => onSuccess?.({ data: { notice: "Discount code created." } }));

    expect(refresh).toHaveBeenCalledTimes(1);
    expect(view.getByRole("status").textContent).toContain(
      "Discount code created."
    );
    expect(
      view.queryByRole("form", { name: "Create discount code" })
    ).toBeNull();

    fireEvent.click(view.getByRole("button", { name: "Create another code" }));
    expect(
      view.getByRole("form", { name: "Create discount code" })
    ).toBeDefined();
  });

  test("manages code audiences while keeping claim history read-only", async () => {
    const { CodeAdministrationDetailPage } = await import(
      "./customer-admin-components"
    );
    const code = dashboard.codes[0];
    const view = render(
      <CodeAdministrationDetailPage
        detail={{
          code,
          discountLabel: "Summer discount",
          customers: [
            {
              customerId: "dotypos-customer",
              customer: {
                id: "dotypos-customer",
                displayName: "Test Customer",
                email: "test@example.com",
                phone: null,
                discountGroupId: null,
              },
            },
          ],
          claims: [
            {
              id: "claim-id",
              codeId: code.id,
              dotyposCustomerId: "dotypos-customer",
              state: "redeemed",
              paymentAttemptId: "payment-id",
              workspaceReservationId: "reservation-id",
              appliedAmount: { value: 3500, exponent: 2, currency: "CZK" },
              reservationExpiresAt: Temporal.Instant.from(
                "2026-08-01T09:00:00Z"
              ),
              reservedAt: Temporal.Instant.from("2026-08-01T08:00:00Z"),
              redeemedAt: Temporal.Instant.from("2026-08-01T08:10:00Z"),
              releasedAt: null,
              releaseReason: null,
            },
          ],
        }}
      />
    );

    expect(view.getByText("Use Make unrestricted")).toBeDefined();
    expect(
      view.getByRole("table", { name: "Discount code claim history" })
    ).toBeDefined();
    expect(view.getByText(/CZK.?35\.00/)).toBeDefined();
    expect(view.getByText("Enabled")).toBeDefined();
    expect(
      view.getByRole("link", { name: "Edit or delete code" })
    ).toBeDefined();
    expect(view.queryByRole("button", { name: /release/i })).toBeNull();
    expect(view.queryByRole("button", { name: /redeem/i })).toBeNull();
  });

  test("manages voucher configuration, deletion, audience, and history", async () => {
    const { VoucherAdministrationDetailPage } = await import(
      "./customer-admin-components"
    );
    const voucher = {
      id: "019c91dd-c560-7e55-b9d8-c95065efd53d",
      issuedCredit: { value: 10_000, exponent: 2, currency: "CZK" },
      remainingCredit: { value: 6500, exponent: 2, currency: "CZK" },
      code: "GIFT100",
      enabled: true,
      validFrom: null,
      validUntil: null,
      audienceSize: 1,
      reservedUses: 0,
      redeemedUses: 1,
      releasedUses: 0,
      createdAt: Temporal.Instant.from("2026-07-01T08:00:00Z"),
      updatedAt: Temporal.Instant.from("2026-07-02T08:00:00Z"),
    };
    const view = render(
      <VoucherAdministrationDetailPage
        detail={{
          voucher,
          customers: [
            {
              customerId: "dotypos-customer",
              customer: {
                id: "dotypos-customer",
                displayName: "Test Customer",
                email: "test@example.com",
                phone: null,
                discountGroupId: null,
              },
            },
          ],
          claims: [
            {
              id: "voucher-claim-id",
              voucherId: voucher.id,
              dotyposCustomerId: "dotypos-customer",
              state: "redeemed",
              paymentAttemptId: "payment-id",
              workspaceReservationId: "reservation-id",
              appliedAmount: { value: 3500, exponent: 2, currency: "CZK" },
              reservationExpiresAt: Temporal.Instant.from(
                "2026-08-01T09:00:00Z"
              ),
              reservedAt: Temporal.Instant.from("2026-08-01T08:00:00Z"),
              redeemedAt: Temporal.Instant.from("2026-08-01T08:10:00Z"),
              releasedAt: null,
              releaseReason: null,
            },
          ],
        }}
      />
    );

    expect(view.getByRole("button", { name: "Save voucher" })).toBeDefined();
    expect(view.getByRole("button", { name: "Delete GIFT100" })).toBeDefined();
    expect(
      view.getByRole("button", { name: "Make unrestricted" })
    ).toBeDefined();
    expect(view.getByRole("button", { name: "Add customer" })).toBeDefined();
    expect(
      view.getByRole("table", { name: "Voucher claim history" })
    ).toBeDefined();
    expect(view.getAllByText(/CZK.?35\.00/).length).toBeGreaterThan(0);
    expect(view.queryByRole("button", { name: /release/i })).toBeNull();
  });

  test("shows only explicit and unrestricted customer codes with guarded icon actions", async () => {
    const { CustomerAdministrationDetailPage } = await import(
      "./customer-admin-components"
    );
    const profile: AdminCustomerProfile = {
      customer: {
        id: "dotypos-customer",
        displayName: "Test Customer",
        email: "test@example.com",
        phone: "+420 123 456 789",
        discountGroupId: null,
      },
      discountGroups: [],
      codes: [
        {
          ...dashboard.codes[0],
          code: "ONLYME",
          audienceSize: 1,
          discountAdjustment: {
            kind: "percentage",
            basisPoints: 1000,
          },
          discountLabel: "Only me discount",
          eligible: true,
        },
        {
          ...dashboard.codes[0],
          id: "019c91dd-c560-7e55-b9d8-c95065efd53d",
          code: "OPEN",
          audienceSize: 0,
          discountAdjustment: {
            kind: "fixed",
            amount: { value: 7500, exponent: 2, currency: "CZK" },
          },
          discountLabel: "Open discount",
          eligible: false,
        },
        {
          ...dashboard.codes[0],
          id: "019c91dd-c560-7e55-b9d8-c95065efd55d",
          code: "AADISABLED",
          audienceSize: 1,
          discountAdjustment: {
            kind: "percentage",
            basisPoints: 500,
          },
          discountLabel: "Disabled discount",
          eligible: true,
          enabled: false,
        },
        {
          ...dashboard.codes[0],
          id: "019c91dd-c560-7e55-b9d8-c95065efd54d",
          code: "SOMEONEELSE",
          audienceSize: 3,
          discountAdjustment: {
            kind: "percentage",
            basisPoints: 1000,
          },
          discountLabel: "Restricted discount",
          eligible: false,
        },
      ],
      claims: [],
      vouchers: [
        {
          id: "019c91dd-c560-7e55-b9d8-c95065efd55d",
          issuedCredit: { value: 10_000, exponent: 2, currency: "CZK" },
          remainingCredit: { value: 6500, exponent: 2, currency: "CZK" },
          code: "GIFT100",
          enabled: true,
          validFrom: null,
          validUntil: null,
          audienceSize: 0,
          reservedUses: 0,
          redeemedUses: 1,
          releasedUses: 0,
          createdAt: Temporal.Instant.from("2026-07-01T08:00:00Z"),
          updatedAt: Temporal.Instant.from("2026-07-02T08:00:00Z"),
          eligible: false,
        },
      ],
      voucherClaims: [],
    };
    const reservations = loadFixtureReservations({
      customerId: "customer-alex",
    }).items.map((reservation) => ({ ...reservation, customer: null }));
    const paidReservation = reservations.find(
      ({ latestPayment }) => latestPayment?.state === "paid"
    );
    expect(paidReservation?.latestPayment).toBeDefined();
    if (!paidReservation?.latestPayment) return;
    const view = render(
      <CustomerAdministrationDetailPage
        activity={{
          reservations,
          reservationHistoryTruncated: true,
          transactions: [
            {
              attempt: paidReservation.latestPayment,
              reservation: paidReservation,
            },
          ],
          transactionHistoryTruncated: true,
          stats: {
            reservationCount: reservations.length,
            favoriteProduct: "Cowork Basic",
            revenue: [paidReservation.latestPayment.amount],
            discountSavings: [{ value: 7500, exponent: 2, currency: "CZK" }],
          },
          marketingConsent: {
            documentHash: "marketing-hash",
            grantedAt: paidReservation.updatedAt,
            locale: "en-US",
            withdrawnAt: null,
          },
        }}
        profile={profile}
        reservationActivity={{
          ...emptyReservationActivity,
          dates: [
            { category: "cowork-profi", count: 2, date: "2026-08-10" },
            { category: "meeting-room", count: 1, date: "2026-08-12" },
            { category: "office", count: 1, date: "2026-08-13" },
            { category: "cowork-basic", count: 1, date: "2026-08-14" },
            { category: "cowork-plus", count: 1, date: "2026-08-15" },
          ],
        }}
      />
    );
    const table = view.getByRole("table", {
      name: "Customer code eligibility",
    });

    const createCodeLink = view.getByRole("link", {
      name: "Create code",
    });
    expect(createCodeLink.getAttribute("href")).toBe(
      "/admin/customers/dotypos-customer/create-code"
    );
    expect(createCodeLink.className).toContain("text-white");
    expect(createCodeLink.className).not.toContain("text-black");

    expect(within(table).getByText("ONLYME")).toBeDefined();
    expect(within(table).getByText("OPEN")).toBeDefined();
    expect(within(table).getByText("AADISABLED")).toBeDefined();
    const voucherTable = view.getByRole("table", {
      name: "Customer voucher eligibility",
    });
    expect(within(voucherTable).getByText("GIFT100")).toBeDefined();
    expect(within(voucherTable).getByText(/CZK.?100\.00/)).toBeDefined();
    expect(within(voucherTable).getByText(/CZK.?65\.00/)).toBeDefined();
    expect(within(table).queryByText("SOMEONEELSE")).toBeNull();
    expect(view.getByText("1 (+ 1)")).toBeDefined();
    expect(
      within(table)
        .getAllByRole("row")
        .slice(1)
        .map((row) => row.textContent)
    ).toEqual([
      expect.stringContaining("ONLYME"),
      expect.stringContaining("OPEN"),
      expect.stringContaining("AADISABLED"),
    ]);
    fireEvent.click(
      within(table).getByRole("button", {
        name: "Code",
      })
    );
    expect(
      within(table)
        .getAllByRole("row")
        .slice(1)
        .map((row) => row.textContent)
    ).toEqual([
      expect.stringContaining("AADISABLED"),
      expect.stringContaining("ONLYME"),
      expect.stringContaining("OPEN"),
    ]);
    expect(within(table).getAllByText("Enabled")).toHaveLength(2);
    expect(within(table).getByText("Disabled")).toBeDefined();
    expect(within(table).getByText("Only me discount · 10%")).toBeDefined();
    expect(within(table).getByText("Open discount · CZK 75.00")).toBeDefined();
    const onlyMeLink = within(table).getByRole("link", { name: "ONLYME" });
    expect(onlyMeLink.getAttribute("href")).toBe(
      `/admin/codes/${dashboard.codes[0].id}`
    );
    expect(onlyMeLink.className).toContain("before:absolute");
    expect(onlyMeLink.closest("tr")?.className).toContain("relative");
    expect(view.getByRole("heading", { name: "Stats" })).toBeDefined();
    expect(view.getByRole("heading", { name: "Consents" })).toBeDefined();
    expect(
      view.getByRole("region", {
        name: "Reservation activity for the past 365 days",
      })
    ).toBeDefined();
    expect(view.getByText("2 reservations on 10 Aug 2026")).toBeDefined();
    expect(
      view.container
        .querySelector('time[datetime="2026-08-10"]')
        ?.getAttribute("title")
    ).toBe("2 reservations on 10 Aug 2026");
    expect(
      view.container
        .querySelector('time[datetime="2026-08-11"]')
        ?.getAttribute("title")
    ).toBe("No reservations on 11 Aug 2026");
    for (const [date, className] of [
      ["2026-08-10", "bg-[#10b981]"],
      ["2026-08-12", "bg-[#60a5fa]"],
      ["2026-08-13", "bg-[#fb923c]"],
      ["2026-08-14", "bg-aquamarine-green/25"],
      ["2026-08-15", "bg-aquamarine-green/70"],
    ] as const) {
      expect(
        view.container.querySelector(`time[datetime="${date}"]`)?.className
      ).toContain(className);
    }
    const reservationActivitySection = view
      .getByRole("heading", { name: "Reservation activity" })
      .closest("section");
    if (!reservationActivitySection) {
      throw new Error("Reservation activity section is missing");
    }
    const reservationActivity = within(reservationActivitySection);
    for (const label of ["Basic", "Plus", "Profi", "Meeting room", "Office"]) {
      expect(reservationActivity.getByText(label)).toBeDefined();
    }
    expect(reservationActivity.queryByText("Less")).toBeNull();
    expect(reservationActivity.queryByText("More")).toBeNull();
    expect(
      reservationActivitySection?.nextElementSibling?.contains(
        view.getByRole("heading", { name: "Stats" })
      )
    ).toBe(true);
    expect(
      reservationActivitySection?.nextElementSibling?.contains(
        view.getByRole("heading", { name: "Consents" })
      )
    ).toBe(true);
    expect(view.getByText("Granted").className).toContain(
      "text-aquamarine-ink"
    );
    expect(view.queryByText("Declined")).toBeNull();
    expect(view.queryByText("Privacy policy")).toBeNull();
    expect(
      view.container.textContent?.match(/test@example\.com/g)
    ).toHaveLength(1);
    expect(
      view.container.textContent?.match(/\+420 123 456 789/g)
    ).toHaveLength(1);
    expect(
      view.getByText("Showing the 24 most recently updated reservations.")
    ).toBeDefined();
    expect(view.getByText("Showing the 50 latest transactions.")).toBeDefined();
    expect(
      view.getByRole("table", { name: "Customer transaction history" })
    ).toBeDefined();
    const pastReservations = view
      .getByText(/Past reservations \(/)
      .closest("details");
    expect(pastReservations?.hasAttribute("open")).toBe(false);
    expect(view.queryByText("Details unavailable")).toBeNull();
    expect(
      view.queryByText("Reservations associated with this customer.")
    ).toBeNull();
    expect(
      view.queryByText(/Codes explicitly available to this customer/)
    ).toBeNull();
    expect(
      within(table).getByRole("columnheader", { name: "Status" })
    ).toBeDefined();
    expect(
      within(table).queryByRole("columnheader", { name: "Action" })
    ).toBeNull();

    fireEvent.click(
      within(table).getByRole("button", {
        name: "Remove Test Customer from ONLYME",
      })
    );
    expect(await view.findByRole("dialog")).toBeDefined();
    expect(view.getByRole("button", { name: "Delete code" })).toBeDefined();
    expect(
      view.getByRole("button", { name: "Make available to all" })
    ).toBeDefined();

    fireEvent.click(view.getByRole("button", { name: "Close" }));
    await waitFor(() => expect(view.queryByRole("dialog")).toBeNull());
    fireEvent.click(
      within(table).getByRole("button", {
        name: "Add Test Customer to OPEN",
      })
    );
    expect(
      view.getByRole("button", { name: "Limit to only this user" })
    ).toBeDefined();
    expect(
      view.getByRole("button", { name: "Keep available to all" })
    ).toBeDefined();
  });

  test("describes an empty customer transaction history as payments", async () => {
    const { CustomerAdministrationDetailPage } = await import(
      "./customer-admin-components"
    );
    const view = render(
      <CustomerAdministrationDetailPage
        activity={{
          reservations: [],
          reservationHistoryTruncated: false,
          transactions: [],
          transactionHistoryTruncated: false,
          stats: {
            reservationCount: 0,
            favoriteProduct: null,
            revenue: [],
            discountSavings: [],
          },
          marketingConsent: null,
        }}
        reservationActivity={emptyReservationActivity}
        profile={{
          customer: {
            id: "dotypos-customer",
            displayName: "Test Customer",
            email: "test@example.com",
            phone: null,
            discountGroupId: null,
          },
          discountGroups: [],
          codes: [],
          claims: [],
          vouchers: [],
          voucherClaims: [],
        }}
      />
    );

    expect(view.getByText("This customer has no payments.")).toBeDefined();
    expect(view.getByText("Not granted")).toBeDefined();
    expect(view.queryByText(/payment attempts/i)).toBeNull();
  });

  test("distinguishes withdrawn customer marketing consent", async () => {
    const { CustomerAdministrationDetailPage } = await import(
      "./customer-admin-components"
    );
    const view = render(
      <CustomerAdministrationDetailPage
        activity={{
          reservations: [],
          reservationHistoryTruncated: false,
          transactions: [],
          transactionHistoryTruncated: false,
          stats: {
            reservationCount: 0,
            favoriteProduct: null,
            revenue: [],
            discountSavings: [],
          },
          marketingConsent: {
            documentHash: "marketing-hash",
            grantedAt: "2026-08-09T10:00:00Z",
            locale: "en-US",
            withdrawnAt: "2026-08-10T11:00:00Z",
          },
        }}
        reservationActivity={{
          ...emptyReservationActivity,
          dates: null,
        }}
        profile={{
          customer: {
            id: "dotypos-customer",
            displayName: "Test Customer",
            email: "test@example.com",
            phone: null,
            discountGroupId: null,
          },
          discountGroups: [],
          codes: [],
          claims: [],
          vouchers: [],
          voucherClaims: [],
        }}
      />
    );

    expect(view.getByText("Withdrawn").className).toContain(
      "text-burned-orange-ink"
    );
    expect(view.getByText(/Granted 9 Aug 2026/)).toBeDefined();
    expect(
      view.getByText("Reservation activity is temporarily unavailable.")
    ).toBeDefined();
    expect(view.queryByText("Declined")).toBeNull();
  });

  test("creates a customer discount code without mixing in vouchers", async () => {
    const execute = mock();
    workspaceUseAction.mockReturnValue({
      execute,
      isExecuting: false,
      result: {},
    });
    const { CustomerDiscountCodeCreationForm } = await import(
      "./customer-code-creation"
    );
    const view = render(
      <CustomerDiscountCodeCreationForm
        completion="back"
        customerId="dotypos-customer"
        customerName="Test Customer"
        discounts={dashboard.discounts}
      />
    );

    expect(
      view.getByRole("radio", { name: "Use an existing discount" })
    ).toHaveProperty("checked", true);
    expect(view.getByRole("combobox", { name: "Discount" })).toBeDefined();
    expect(view.queryByRole("textbox", { name: "English (en-US)" })).toBeNull();

    fireEvent.change(view.getByRole("textbox", { name: "Code" }), {
      target: { value: "personal10" },
    });
    fireEvent.submit(view.getByRole("form", { name: "Create discount code" }));
    expect(execute).toHaveBeenCalledWith({
      kind: "create-customer-code",
      customerId: "dotypos-customer",
      code: {
        code: "PERSONAL10",
        enabled: true,
        validFrom: null,
        validUntil: null,
        maxUses: null,
        maxUsesPerCustomer: null,
      },
      discount: {
        kind: "existing",
        discountId: dashboard.discounts[0].id,
      },
    });

    fireEvent.click(view.getByRole("radio", { name: "Create a new discount" }));
    expect(
      view.getByRole("textbox", { name: "English (en-US)" })
    ).toBeDefined();
    expect(view.queryByRole("combobox", { name: "Discount" })).toBeNull();

    expect(view.queryByRole("radio", { name: "Create a voucher" })).toBeNull();
  });

  test("shows nested customer code validation errors", async () => {
    let onError:
      | ((result: {
          error: {
            validationErrors?: unknown;
          };
        }) => void)
      | undefined;
    workspaceUseAction.mockImplementation((_action, options) => {
      const candidate = options as {
        actionName?: string;
        onError?: typeof onError;
      };
      if (candidate.actionName === "createCustomerDiscountCode") {
        onError = candidate.onError;
      }
      return {
        execute: mock(),
        isExecuting: false,
        result: {},
      };
    });
    const { CustomerDiscountCodeCreationForm } = await import(
      "./customer-code-creation"
    );
    const view = render(
      <CustomerDiscountCodeCreationForm
        completion="back"
        customerId="dotypos-customer"
        customerName="Test Customer"
        discounts={dashboard.discounts}
      />
    );

    act(() =>
      onError?.({
        error: {
          validationErrors: {
            fieldErrors: {
              discount: [
                'discount.products[0].tier: Unexpected key with value "basic"',
              ],
            },
          },
        },
      })
    );

    expect(view.getByRole("alert").textContent).toContain(
      'discount.products[0].tier: Unexpected key with value "basic"'
    );
  });

  test("describes adding a customer to an existing restricted code audience", async () => {
    const { CustomerCodeAction } = await import("./customer-admin-client");
    const view = render(
      <CustomerCodeAction
        audienceSize={3}
        code="TEAM"
        codeId={dashboard.codes[0].id}
        customerId="dotypos-customer"
        customerName="Test Customer"
        eligible={false}
      />
    );

    fireEvent.click(
      view.getByRole("button", {
        name: "Add Test Customer to TEAM",
      })
    );

    expect(
      await view.findByRole("heading", { name: "Add Test Customer to TEAM?" })
    ).toBeDefined();
    expect(
      view.getByText(
        "TEAM is currently limited to 3 other customers. Adding Test Customer will make it available to 4 customers."
      )
    ).toBeDefined();
    expect(view.getByRole("button", { name: "Add customer" })).toBeDefined();
  });

  test("shows calendar sales in a table with readable status badges", async () => {
    const { SalesAdministrationActions, SalesAdministrationCollection } =
      await import("./components");
    const view = render(
      <>
        <AdministrationTableToolbar
          actions={<SalesAdministrationActions />}
          count={dashboard.calendar.events.length}
          itemLabel="sale"
        />
        <SalesAdministrationCollection dashboard={dashboard} />
      </>
    );

    expect(view.queryByRole("dialog")).toBeNull();
    fireEvent.click(
      view.getByRole("button", { name: "Create a sale discount" })
    );
    expect(view.getByRole("dialog")).toBeDefined();
    expect(
      view.getByRole("heading", { name: "Create a sale discount" })
    ).toBeDefined();
    fireEvent.click(view.getByRole("button", { name: "Close" }));
    await waitFor(() => expect(view.queryByRole("dialog")).toBeNull());

    expect(view.getByRole("table", { name: "Calendar sales" })).toBeDefined();
    expect(view.queryByRole("table", { name: "Discounts" })).toBeNull();
    expect(view.queryByText("2026-07-01 — 2027-07-01")).toBeNull();
    const calendarSalesTable = view.getByRole("table", {
      name: "Calendar sales",
    });
    const salesMainColumn = calendarSalesTable.closest("section");
    expect(salesMainColumn).not.toBeNull();
    expect(
      view
        .getByLabelText("1 sale")
        .closest("section")
        ?.contains(view.getByRole("button", { name: "Create a sale discount" }))
    ).toBe(true);
    const linkSalePanel = view
      .getByRole("heading", { name: "Link a sale" })
      .closest("aside");
    expect(linkSalePanel).not.toBeNull();
    if (!linkSalePanel) return;
    expect(linkSalePanel.parentElement).toBe(salesMainColumn?.parentElement);
    expect(
      within(linkSalePanel)
        .getByRole("link", { name: "Open calendar" })
        .getAttribute("href")
    ).toBe("https://calendar.google.com/");
    expect(view.getByText("Associated").className).toContain(
      "text-aquamarine-ink"
    );
    expect(view.getByText("tentative").className).toContain("text-navy-blue");
    const saleRow = view.getByText("Summer sale").closest("tr");
    expect(saleRow?.getAttribute("tabindex")).toBe("0");
    fireEvent.click(
      view.getByRole("link", {
        name: "Open Summer sale in Google Calendar",
      })
    );
    expect(view.queryByRole("button", { name: "Save discount" })).toBeNull();
    fireEvent.click(view.getByText("Summer sale"));
    expect(view.getByRole("button", { name: "Save discount" })).toBeDefined();
    if (!saleRow) return;
    fireEvent.keyDown(saleRow, { key: "Enter" });
    expect(view.queryByRole("button", { name: "Save discount" })).toBeNull();
    fireEvent.click(
      view.getByRole("button", { name: "Edit discount for Summer sale" })
    );
    expect(
      view.container.querySelector(
        "#labelEn-019c91dd-c560-7e55-b9d8-c95065efd51d"
      )
    ).not.toBeNull();
    expect(view.getByRole("button", { name: "Save discount" })).toBeDefined();
  });

  test("confirms sale discount creation before allowing another submission", async () => {
    let onSuccess:
      | ((result: {
          data?: {
            notice: string;
            createdDiscountId?: string;
          };
        }) => void)
      | undefined;
    workspaceUseAction.mockImplementation((_action, options) => {
      const candidate = options as {
        actionName?: string;
        onSuccess?: typeof onSuccess;
      };
      if (candidate.actionName === "createDiscount") {
        onSuccess = candidate.onSuccess;
      }
      return {
        execute: mock(),
        isExecuting: false,
        result: {},
      };
    });
    const { SalesAdministrationActions } = await import("./components");
    const view = render(<SalesAdministrationActions />);

    fireEvent.click(
      view.getByRole("button", { name: "Create a sale discount" })
    );
    expect(view.getByRole("button", { name: "Create discount" })).toBeDefined();

    act(() =>
      onSuccess?.({
        data: {
          notice: "Discount created.",
          createdDiscountId: "calendar-discount-id",
        },
      })
    );

    expect(view.getByRole("status").textContent).toContain(
      "Calendar ID: calendar-discount-id"
    );
    expect(view.queryByRole("button", { name: "Create discount" })).toBeNull();
    fireEvent.click(
      view.getByRole("button", { name: "Create another discount" })
    );
    expect(view.getByRole("button", { name: "Create discount" })).toBeDefined();
  });
});
