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
} from "@testing-library/react";
import { workspaceUseAction } from "@/shared/testing/workspace-component-module-mocks";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";
import type { DiscountAdminDashboard } from "./discount-administration.service";

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

  test("shows calendar sales in a table with readable status badges", async () => {
    const { SalesAdministrationPage } = await import("./components");
    const view = render(<SalesAdministrationPage dashboard={dashboard} />);

    expect(view.getByRole("table", { name: "Calendar sales" })).toBeDefined();
    expect(view.getByText("Associated").className).toContain("text-white");
    expect(view.getByText("tentative").className).toContain("text-navy-blue");
  });
});
