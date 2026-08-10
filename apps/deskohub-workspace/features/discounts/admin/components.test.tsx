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
      products: [{ kind: "cowork", tier: "basic" }],
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
      audienceSize: 2,
      reservedUses: 1,
      redeemedUses: 3,
      releasedUses: 1,
      remainingUses: 96,
      createdAt: Temporal.Instant.from("2026-07-01T08:00:00Z"),
      updatedAt: Temporal.Instant.from("2026-07-02T08:00:00Z"),
    },
  ],
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

  test("uses a sortable table and a percentage editor with a dirty save state", async () => {
    const { DiscountsAdministrationPage } = await import("./components");
    const view = render(<DiscountsAdministrationPage dashboard={dashboard} />);

    expect(view.getByRole("table", { name: "Discounts" })).toBeDefined();
    fireEvent.click(
      view.getByRole("button", {
        name: "Edit Summer discount",
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

  test("sorts discount rows without entering a render loop", async () => {
    const sortableDashboard: DiscountAdminDashboard = {
      ...dashboard,
      discounts: [
        ...dashboard.discounts,
        {
          ...dashboard.discounts[0],
          id: "019c91dd-c560-7e55-b9d8-c95065efd53d",
          labels: {
            "cs-CZ": "Podzimní sleva",
            "en-US": "Autumn discount",
          },
          codeCount: 0,
        },
      ],
    };
    const { DiscountsAdministrationPage } = await import("./components");
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
          <DiscountsAdministrationPage dashboard={sortableDashboard} />
        </Profiler>
      </StrictMode>
    );
    const table = view.getByRole("table", { name: "Discounts" });
    const labelHeader = within(table).getByRole("button", {
      name: "English label",
    });

    await act(() => new Promise<void>((resolve) => queueMicrotask(resolve)));
    fireEvent.click(labelHeader);
    await act(() => new Promise<void>((resolve) => setTimeout(resolve, 50)));

    await waitFor(() => {
      expect(labelHeader.closest("th")?.getAttribute("aria-sort")).toBe(
        "ascending"
      );
      expect(within(table).getAllByRole("row")[1]?.textContent).toContain(
        "Autumn discount"
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

    const { CodesAdministrationPage } = await import("./components");
    const view = render(<CodesAdministrationPage dashboard={dashboard} />);

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

  test("links codes to audience management and shows live capacity", async () => {
    const { CodesAdministrationPage } = await import("./components");
    const view = render(<CodesAdministrationPage dashboard={dashboard} />);
    const table = view.getByRole("table", { name: "Discount codes" });

    expect(
      within(table).getByRole("link", { name: "SUMMER10" }).getAttribute("href")
    ).toBe("/admin/codes/019c91dd-c560-7e55-b9d8-c95065efd52d");
    expect(within(table).getByText("2 customers")).toBeDefined();
    expect(within(table).getByText("96")).toBeDefined();
  });

  test("expands a code from its row while preserving nested actions", async () => {
    const { CodesAdministrationPage } = await import("./components");
    const view = render(<CodesAdministrationPage dashboard={dashboard} />);
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
    const { CodesAdministrationPage } = await import("./components");
    const view = render(<CodesAdministrationPage dashboard={dashboard} />);
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
    const { CodesAdministrationPage } = await import("./components");
    const view = render(
      <CodesAdministrationPage
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
    const { CodesAdministrationPage } = await import("./components");
    const view = render(<CodesAdministrationPage dashboard={dashboard} />);

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
    expect(view.queryByRole("button", { name: /release/i })).toBeNull();
    expect(view.queryByRole("button", { name: /redeem/i })).toBeNull();
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
        phone: null,
        discountGroupId: null,
      },
      discountGroups: [],
      codes: [
        {
          ...dashboard.codes[0],
          code: "ONLYME",
          audienceSize: 1,
          discountLabel: "Only me discount",
          eligible: true,
        },
        {
          ...dashboard.codes[0],
          id: "019c91dd-c560-7e55-b9d8-c95065efd53d",
          code: "OPEN",
          audienceSize: 0,
          discountLabel: "Open discount",
          eligible: false,
        },
        {
          ...dashboard.codes[0],
          id: "019c91dd-c560-7e55-b9d8-c95065efd54d",
          code: "SOMEONEELSE",
          audienceSize: 3,
          discountLabel: "Restricted discount",
          eligible: false,
        },
      ],
      claims: [],
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
          consents: [
            {
              documentKey: "privacyPolicy",
              documentPath: "/legal/privacy-policy-v2.md",
              documentHash: "privacy-hash",
              accepted: true,
              acceptedAt: paidReservation.updatedAt,
              locale: "en-US",
            },
            {
              documentKey: "marketingCommunications",
              documentPath: "/legal/marketing-communications-v1.md",
              documentHash: "marketing-hash",
              accepted: false,
              acceptedAt: paidReservation.updatedAt,
              locale: "en-US",
            },
          ],
        }}
        profile={profile}
      />
    );
    const table = view.getByRole("table", {
      name: "Customer code eligibility",
    });

    const createCodeLink = view.getByRole("link", {
      name: "Create discount code",
    });
    expect(createCodeLink.getAttribute("href")).toBe(
      "/admin/customers/dotypos-customer/create-code"
    );
    expect(createCodeLink.className).toContain("text-white");
    expect(createCodeLink.className).not.toContain("text-black");

    expect(within(table).getByText("ONLYME")).toBeDefined();
    expect(within(table).getByText("OPEN")).toBeDefined();
    expect(within(table).queryByText("SOMEONEELSE")).toBeNull();
    expect(view.getByText("1 (+ 1)")).toBeDefined();
    expect(view.getByRole("heading", { name: "Stats" })).toBeDefined();
    expect(view.getByRole("heading", { name: "Consents" })).toBeDefined();
    expect(view.getByText("Accepted").className).toContain(
      "text-aquamarine-ink"
    );
    expect(view.getByText("Declined").className).toContain("text-red-600");
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
      within(table).queryByRole("columnheader", { name: "Status" })
    ).toBeNull();
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
          consents: [],
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
        }}
      />
    );

    expect(view.getByText("This customer has no payments.")).toBeDefined();
    expect(view.queryByText(/payment attempts/i)).toBeNull();
  });

  test("creates a customer code with an existing discount or a new definition", async () => {
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
    const { SalesAdministrationPage } = await import("./components");
    const view = render(<SalesAdministrationPage dashboard={dashboard} />);

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
    expect(view.getByText("Associated").className).toContain("text-white");
    expect(view.getByText("tentative").className).toContain("text-navy-blue");
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
    const { SalesAdministrationPage } = await import("./components");
    const view = render(<SalesAdministrationPage dashboard={dashboard} />);

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
