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

mock.module("next/navigation", () => ({
  useRouter: () => ({
    refresh,
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
    refresh.mockClear();
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
    const view = render(
      <CustomerAdministrationDetailPage
        profile={profile}
        reservations={{ items: [], page: 1, pageCount: 1, total: 0 }}
      />
    );
    const table = view.getByRole("table", {
      name: "Customer code eligibility",
    });

    expect(within(table).getByText("ONLYME")).toBeDefined();
    expect(within(table).getByText("OPEN")).toBeDefined();
    expect(within(table).queryByText("SOMEONEELSE")).toBeNull();
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
    expect(view.getByRole("dialog")).toBeDefined();
    expect(view.getByRole("button", { name: "Delete code" })).toBeDefined();
    expect(
      view.getByRole("button", { name: "Make available to all" })
    ).toBeDefined();

    fireEvent.click(view.getByRole("button", { name: "Close" }));
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

  test("shows calendar sales in a table with readable status badges", async () => {
    const { SalesAdministrationPage } = await import("./components");
    const view = render(<SalesAdministrationPage dashboard={dashboard} />);

    expect(view.getByRole("table", { name: "Calendar sales" })).toBeDefined();
    expect(view.getByText("Associated").className).toContain("text-white");
    expect(view.getByText("tentative").className).toContain("text-navy-blue");
  });
});
