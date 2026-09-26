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
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { workspaceUseAction } from "@/shared/testing/workspace-component-module-mocks";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";
import type { DiscountAdminDashboard } from "./discount-administration.service";

const refresh = mock();

const temporalFields = [
  { label: "Valid from", name: "validFrom" },
  { label: "Valid until", name: "validUntil" },
  { label: "Service date from (inclusive)", name: "serviceDateFrom" },
  { label: "Service date until (exclusive)", name: "serviceDateUntil" },
] as const;

const openTemporalEditor = async (
  view: Pick<ReturnType<typeof render>, "getByRole" | "findByLabelText">,
  label: string
) => {
  fireEvent.click(view.getByRole("button", { name: label }));
  return (await view.findByLabelText(`Edit ${label}`)) as HTMLInputElement;
};

const readHiddenTemporalValue = (container: HTMLElement, name: string) =>
  container.querySelector<HTMLInputElement>(`input[name="${name}"]`)?.value ??
  null;

mock.module("next/navigation", () => ({
  useRouter: () => ({
    back: mock(),
    refresh,
    replace: mock(),
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
      serviceDateFrom: "2026-08-10",
      serviceDateUntil: "2026-08-11",
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

const voucherDashboard = {
  vouchers: [
    {
      id: "019c91dd-c560-7e55-b9d8-c95065efd53d",
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
    },
  ],
};

const hintParagraphContents = (container: HTMLElement) =>
  [...container.querySelectorAll("p")]
    .map((paragraph) => paragraph.textContent?.trim() ?? "")
    .filter(
      (text) =>
        text.includes("Prague time zone") ||
        text.includes("following date") ||
        text.includes("Set both dates")
    );

async function renderExpandedCodeEditor() {
  const { CodesAdministrationCollection } = await import("./components");
  const view = render(<CodesAdministrationCollection dashboard={dashboard} />);
  fireEvent.click(view.getByRole("button", { name: "Edit SUMMER10" }));
  return view;
}

describe("discount code form hints", () => {
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

  test("replaces always-visible hint paragraphs with label info tooltips", async () => {
    const view = await renderExpandedCodeEditor();

    expect(hintParagraphContents(view.container)).toEqual([]);

    const hintButtons = view
      .getAllByRole("button")
      .filter((button) =>
        button.getAttribute("aria-label")?.startsWith("About ")
      )
      .map((button) => button.getAttribute("aria-label"))
      .toSorted();
    expect(hintButtons).toEqual([
      "About Service date from (inclusive)",
      "About Service date until (exclusive)",
      "About Valid from",
      "About Valid until",
    ]);
    for (const button of view.getAllByRole("button")) {
      if (button.getAttribute("aria-label")?.startsWith("About ")) {
        expect(button).toHaveProperty("type", "button");
      }
    }
  });

  test("keeps the exact accessible labels on date inputs", async () => {
    const view = await renderExpandedCodeEditor();

    for (const { label, name } of temporalFields) {
      expect(view.getByLabelText(label)).toHaveProperty("type", "button");
      const editor = await openTemporalEditor(view, label);
      expect(editor.getAttribute("name")).toBeNull();
      const hidden = readHiddenTemporalValue(view.container, name);
      expect(hidden).not.toBeNull();
      expect(hidden).not.toBe("");
    }
  });

  test("opens each date hint on keyboard focus and dismisses with Escape", async () => {
    const view = await renderExpandedCodeEditor();

    for (const name of [
      "About Valid from",
      "About Service date until (exclusive)",
    ]) {
      const trigger = view.getByRole("button", { name });
      fireEvent.focus(trigger);
      await waitFor(() => expect(view.getByRole("tooltip")).toBeDefined());
      expect(view.getByRole("tooltip").textContent).not.toBe("");

      fireEvent.keyDown(trigger, { key: "Escape" });
      await waitFor(() => expect(view.queryByRole("tooltip")).toBeNull());
    }
  });

  test("info buttons never submit the form", async () => {
    const execute = mock();
    workspaceUseAction.mockReturnValue({
      execute,
      isExecuting: false,
      result: {},
    });
    const view = await renderExpandedCodeEditor();

    fireEvent.click(view.getByRole("button", { name: "About Valid from" }));
    expect(execute).not.toHaveBeenCalled();
  });

  test("excludes hint tooltips and service bounds from vouchers", async () => {
    const { VouchersAdministrationCollection } = await import("./components");
    const view = render(
      <VouchersAdministrationCollection dashboard={voucherDashboard} />
    );
    fireEvent.click(view.getByRole("button", { name: "Edit GIFT100" }));

    expect(
      view
        .getAllByRole("button")
        .map((button) => button.getAttribute("aria-label"))
        .filter((label) => label?.startsWith("About "))
    ).toEqual(["About Valid from", "About Valid until"]);
    expect(view.queryByLabelText("Service date from (inclusive)")).toBeNull();
    expect(view.queryByLabelText("Service date until (exclusive)")).toBeNull();
    expect(view.getByLabelText("Valid from")).toHaveProperty("type", "button");
    expect(readHiddenTemporalValue(view.container, "validFrom")).not.toBeNull();
    expect(hintParagraphContents(view.container)).toEqual([]);
  });
});
