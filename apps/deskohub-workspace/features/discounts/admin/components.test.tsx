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
import { Profiler, StrictMode, useEffect, useRef, useState } from "react";
import { loadFixtureReservations } from "@/features/administration/fixtures";
import { workspaceUseAction } from "@/shared/testing/workspace-component-module-mocks";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";
import type { VoucherTableItem } from "./admin-tables";
import type { DiscountAdminMutation } from "./contracts";
import type {
  AdminCustomerProfile,
  DiscountAdminDashboard,
} from "./discount-administration.service";

const testEmailAddressForTest = testEmailAddress("test");

// react-dom decides how to synthesize change events while it is evaluated, so
// the DOM environment must exist before @testing-library/react loads. Static
// imports always evaluate first, which is why the renderer is imported
// dynamically after the happy-dom registration instead.
registerWorkspaceComponentTestEnv();
const { act, cleanup, fireEvent, render, waitFor, within } = await import(
  "@testing-library/react"
);

const refresh = mock();
const back = mock();
const replace = mock();
const emptyReservationActivity = {
  from: "2025-08-25",
  to: "2026-08-24",
  dates: [],
} as const;

mock.module("next/navigation", () => ({
  useParams: () => ({ locale: "en-US" }),
  useRouter: () => ({
    back,
    refresh,
    replace,
  }),
  // The administration's export control runs browser Effects, whose runner
  // rethrows only Next control flow, which these tests never raise.
  unstable_rethrow: () => {},
}));

const mutateDiscountAdmin = mock();
mock.module("./actions", () => ({
  createDiscountAdminForm: mock(),
  createDiscountCodeAdminForm: mock(),
  deleteDiscountAdminForm: mock(),
  deleteDiscountCodeAdminForm: mock(),
  mutateDiscountAdmin,
  searchDiscountAdminCustomers: mock(),
  updateDiscountAdminForm: mock(),
  updateDiscountCodeAdminForm: mock(),
}));

type DiscountAdminActionResult = {
  readonly data?: {
    readonly notice: string;
    readonly createdDiscountId?: string;
  };
};
type DiscountAdminActionError = {
  readonly error: {
    readonly serverError?: string;
    readonly validationErrors?: unknown;
  };
};
type CapturedWorkspaceAction = {
  readonly execute: ReturnType<typeof mock>;
  readonly options: {
    readonly onSuccess: (result: DiscountAdminActionResult) => void;
    readonly onError: (result: DiscountAdminActionError) => void;
    readonly onTransportError: () => void;
  };
};

// Every discount mutation runs through one action, so a form's hook is found
// by the kinds of mutation it executes. A form that has not executed one yet is
// found as the only mounted mutation hook.
const captureWorkspaceActions = () => {
  type LatestOptions = { current: CapturedWorkspaceAction["options"] };
  const mounted = new Set<LatestOptions>();
  const executions: {
    readonly mutation: DiscountAdminMutation;
    readonly options: LatestOptions;
  }[] = [];
  const captures: {
    readonly kinds: readonly DiscountAdminMutation["kind"][];
    readonly execute: ReturnType<typeof mock>;
  }[] = [];
  workspaceUseAction.mockImplementation(
    function useCapturedWorkspaceAction(action, options) {
      const latestOptions = useRef(options as LatestOptions["current"]);
      latestOptions.current = options as LatestOptions["current"];
      const isMutation = action === mutateDiscountAdmin;
      useEffect(() => {
        if (!isMutation) return;
        mounted.add(latestOptions);
        return () => {
          mounted.delete(latestOptions);
        };
      }, [isMutation]);
      // The execute identity must stay stable across component re-renders.
      const [execute] = useState(() => (mutation: DiscountAdminMutation) => {
        if (!isMutation) return;
        executions.push({ mutation, options: latestOptions });
        for (const capture of captures) {
          if (capture.kinds.includes(mutation.kind)) capture.execute(mutation);
        }
      });
      return { execute, isExecuting: false, result: {} };
    }
  );
  return (
    ...kinds: DiscountAdminMutation["kind"][]
  ): CapturedWorkspaceAction => {
    const executionsOfKinds = () =>
      executions.filter(({ mutation }) => kinds.includes(mutation.kind));
    const execute = mock();
    for (const { mutation } of executionsOfKinds()) execute(mutation);
    captures.push({ kinds, execute });
    const options = () => {
      const executed = executionsOfKinds().at(-1);
      if (executed) return executed.options.current;
      const [only, ...others] = mounted;
      if (!only || others.length > 0) {
        throw new Error(`No single form to report ${kinds.join(" or ")} to`);
      }
      return only.current;
    };
    return {
      execute,
      options: {
        onSuccess: (result) => options().onSuccess(result),
        onError: (result) => options().onError(result),
        onTransportError: () => options().onTransportError(),
      },
    };
  };
};

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
          discountLabels: {
            "en-US": "Summer discount",
            "cs-CZ": "Summer discount",
          },
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

  afterAll(async () => {
    await unregisterWorkspaceComponentTestEnv();
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
          <CodesAdministrationCollection
            locale="en-US"
            dashboard={sortableDashboard}
          />
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

  test("renders the code list in the operator's locale", async () => {
    const { RouteLocaleProvider } = await import(
      "@/features/i18n/route-locale"
    );
    const { CodesAdministrationCollection } = await import("./components");
    const view = render(
      <RouteLocaleProvider locale="cs-CZ">
        <CodesAdministrationCollection dashboard={dashboard} locale="cs-CZ" />
      </RouteLocaleProvider>
    );
    const table = view.getByRole("table", { name: "Slevové kódy" });

    expect(view.getByRole("heading", { name: "Kódy" })).toBeDefined();
    expect(within(table).getByRole("button", { name: /^Kód/ })).toBeDefined();
    expect(within(table).getByText("Aktivní")).toBeDefined();
    expect(within(table).getByText("2 zákazníci")).toBeDefined();
    expect(within(table).getByText("Všechny úrovně coworku")).toBeDefined();
    expect(
      within(table).getByRole("button", { name: "Smazat SUMMER10" })
    ).toBeDefined();
  });

  test("formats code counts and cowork tier targets in the operator's locale", async () => {
    const { RouteLocaleProvider } = await import(
      "@/features/i18n/route-locale"
    );
    const { CodesAdministrationCollection } = await import("./components");
    const [discount] = dashboard.discounts;
    const [code] = dashboard.codes;
    const view = render(
      <RouteLocaleProvider locale="cs-CZ">
        <CodesAdministrationCollection
          dashboard={{
            ...dashboard,
            discounts: [
              {
                ...discount,
                products: [{ kind: "cowork", tier: "reserved-desk" }],
              },
            ],
            codes: [
              {
                ...code,
                reservedUses: 1250,
                redeemedUses: 2400,
                remainingUses: 6350,
                maxUsesPerCustomer: null,
              },
            ],
          }}
          locale="cs-CZ"
        />
      </RouteLocaleProvider>
    );
    const table = within(view.getByRole("table", { name: "Slevové kódy" }));

    expect(table.getByText("Pouze Vyhrazené místo")).toBeDefined();
    expect(table.getByText(/^1\s250$/)).toBeDefined();
    expect(table.getByText(/^2\s400$/)).toBeDefined();
    expect(table.getByText(/^6\s350$/)).toBeDefined();
    expect(table.getByText("Neomezeně")).toBeDefined();
  });

  test("renders customer payments and claim releases in the operator's locale", async () => {
    const { RouteLocaleProvider } = await import(
      "@/features/i18n/route-locale"
    );
    const { ClaimHistoryTable, CustomerTransactionHistoryTable } = await import(
      "./customer-admin-tables"
    );
    const paidReservation = loadFixtureReservations({
      customerId: "customer-alex",
    }).items.find(({ latestPayment }) => latestPayment?.state === "paid");
    const attempt = paidReservation?.latestPayment;
    if (!paidReservation || !attempt) {
      throw new Error("The fixtures have no paid reservation");
    }
    const reservation = {
      ...paidReservation,
      product: { kind: "cowork", tier: "reserved-desk" },
    } as const;
    const claim = {
      kind: "discount-code",
      appliedAmount: { value: 7500, exponent: 2, currency: "CZK" },
      promotion: { id: dashboard.codes[0].id, code: "SUMMER10" },
      dotyposCustomerId: "dotypos-customer",
      redeemedAt: null,
      releasedAt: "2026-08-02T08:00:00Z",
      reservedAt: "2026-08-01T08:00:00Z",
      reservedAtLabel: "1. 8. 2026 10:00",
      completedAtLabel: "2. 8. 2026 10:00",
      state: "released",
      workspaceReservationId: paidReservation.id,
    } as const;
    const view = render(
      <RouteLocaleProvider locale="cs-CZ">
        <CustomerTransactionHistoryTable
          transactions={[
            { attempt, reservation, updatedAtLabel: "1. 8. 2026 10:00" },
            {
              attempt: {
                ...attempt,
                id: `${attempt.id}-refunded`,
                refundState: "refunded",
                refundedAmount: {
                  ...attempt.amount,
                  value: attempt.amount.value / 2,
                },
                refundedAt: "2026-08-03T08:00:00Z",
              },
              reservation,
              updatedAtLabel: "3. 8. 2026 10:00",
            },
          ]}
        />
        <ClaimHistoryTable
          ariaLabel="Historie uplatnění"
          claims={[
            {
              ...claim,
              id: "claim-abandoned",
              releaseReason: "payment_abandoned_after_provider_cutoff",
            },
            {
              ...claim,
              id: "claim-unknown",
              releaseReason: "synthetic_terminal",
            },
          ]}
          subject="promotion-code"
        />
      </RouteLocaleProvider>
    );
    const transactions = within(
      view.getByRole("table", { name: "Historie transakcí zákazníka" })
    );
    const [paidRow, refundedRow] = transactions.getAllByRole("row").slice(1);

    expect(within(paidRow!).getByText("Zaplaceno")).toBeDefined();
    expect(within(refundedRow!).getByText(/^Částečně vráceno /)).toBeDefined();
    expect(refundedRow?.textContent).toContain("před vrácením peněz");
    expect(refundedRow?.textContent).toContain("po vrácení peněz");
    expect(transactions.getAllByText("Vyhrazené místo")).toHaveLength(2);

    const claims = within(
      view.getByRole("table", { name: "Historie uplatnění" })
    );
    expect(
      claims.getByText("Platba nebyla dokončena ve lhůtě pro zaplacení")
    ).toBeDefined();
    expect(claims.getByText("Uvolněno z jiného důvodu")).toBeDefined();
    expect(
      claims.queryByText(/payment_abandoned|synthetic_terminal/)
    ).toBeNull();
  });

  test("shows only explicit and unrestricted customer codes with guarded icon actions", async () => {
    const { CustomerAdministrationDetailPage } = await import(
      "./customer-admin-components"
    );
    const profile: AdminCustomerProfile = {
      customer: {
        id: "dotypos-customer",
        displayName: "Test Customer",
        hasName: true,
        email: testEmailAddressForTest,
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
          discountLabels: {
            "en-US": "Only me discount",
            "cs-CZ": "Only me discount",
          },
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
          discountLabels: {
            "en-US": "Open discount",
            "cs-CZ": "Open discount",
          },
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
          discountLabels: {
            "en-US": "Disabled discount",
            "cs-CZ": "Disabled discount",
          },
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
          discountLabels: {
            "en-US": "Restricted discount",
            "cs-CZ": "Restricted discount",
          },
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
        locale="en-US"
        activity={{
          reservations,
          reservationHistoryTruncated: true,
          transactions: [
            {
              attempt: paidReservation.latestPayment,
              reservation: {
                ...paidReservation,
                product: { kind: "cowork", tier: "basic" },
              },
            },
          ],
          transactionHistoryTruncated: true,
          stats: {
            reservationCount: reservations.length,
            favoriteProduct: "Cowork Basic",
            favoriteReservationProduct: { kind: "cowork", tier: "basic" },
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
      name: "Customer codes and vouchers",
    });
    expect(view.queryAllByRole("table", { name: /eligibility/ })).toEqual([]);
    expect(view.queryByRole("heading", { name: "Vouchers" })).toBeNull();

    const createCodeLink = view.getByRole("link", {
      name: "Create discount code",
    });
    expect(createCodeLink.getAttribute("href")).toBe(
      "/en-US/admin/customers/dotypos-customer/create-code"
    );
    expect(
      view.getByRole("link", { name: "Create voucher" }).getAttribute("href")
    ).toBe("/en-US/admin/customers/dotypos-customer/create-voucher");

    expect(within(table).getByText("ONLYME")).toBeDefined();
    expect(within(table).getByText("OPEN")).toBeDefined();
    expect(within(table).getByText("AADISABLED")).toBeDefined();
    expect(
      within(table).getByRole("link", { name: "GIFT100" }).getAttribute("href")
    ).toBe("/en-US/admin/vouchers/019c91dd-c560-7e55-b9d8-c95065efd55d");
    expect(within(table).getByText(/CZK.?100 credit/)).toBeDefined();
    expect(within(table).getByText(/CZK.?65 remaining/)).toBeDefined();
    expect(within(table).getAllByText("Discount code")).toHaveLength(3);
    expect(within(table).getAllByText("Voucher")).toHaveLength(1);
    expect(
      within(table).getByRole("button", {
        name: "Add Test Customer to GIFT100",
      })
    ).toBeDefined();
    expect(within(table).queryByText("SOMEONEELSE")).toBeNull();
    expect(view.getByText("1 (+ 1)")).toBeDefined();
    expect(
      within(table)
        .getAllByRole("row")
        .slice(1)
        .map((row) => row.textContent)
    ).toEqual([
      expect.stringContaining("ONLYME"),
      expect.stringContaining("GIFT100"),
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
      expect.stringContaining("GIFT100"),
      expect.stringContaining("ONLYME"),
      expect.stringContaining("OPEN"),
    ]);
    fireEvent.click(within(table).getByRole("button", { name: "Type" }));
    expect(
      within(table)
        .getAllByRole("row")
        .slice(1)
        .map((row) => row.textContent)
    ).toEqual([
      expect.stringContaining("Discount code"),
      expect.stringContaining("Discount code"),
      expect.stringContaining("Discount code"),
      expect.stringContaining("GIFT100"),
    ]);
    expect(within(table).getAllByText("Enabled")).toHaveLength(3);
    expect(within(table).getByText("Disabled")).toBeDefined();
    expect(within(table).getByText("Only me discount · 10%")).toBeDefined();
    expect(within(table).getByText("Open discount · CZK 75")).toBeDefined();
    const onlyMeLink = within(table).getByRole("link", { name: "ONLYME" });
    expect(onlyMeLink.getAttribute("href")).toBe(
      `/en-US/admin/codes/${dashboard.codes[0].id}`
    );
    expect(view.getByRole("heading", { name: "Stats" })).toBeDefined();
    expect(view.getByRole("heading", { name: "Consents" })).toBeDefined();
    expect(
      view.getByRole("region", {
        name: "Reservation activity for the past 365 days",
      })
    ).toBeDefined();
    expect(view.getByText("2 reservations on Aug 10, 2026")).toBeDefined();
    expect(
      view.container
        .querySelector('time[datetime="2026-08-10"]')
        ?.getAttribute("title")
    ).toBe("2 reservations on Aug 10, 2026");
    expect(
      view.container
        .querySelector('time[datetime="2026-08-11"]')
        ?.getAttribute("title")
    ).toBe("No reservations on Aug 11, 2026");
    const reservationActivitySection = view
      .getByRole("heading", { name: "Reservation activity" })
      .closest("section");
    if (!reservationActivitySection) {
      throw new Error("Reservation activity section is missing");
    }
    const reservationActivity = within(reservationActivitySection);
    // Tier names come from the product catalog.
    for (const label of [
      "Profi Workstation",
      "Meeting Room",
      "Private office",
      "Basic Day Pass",
      "Cowork Plus",
    ]) {
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
    // The favourite product and the transaction come from the customer
    // catalog's product names, not the API's English labels.
    expect(view.getAllByText("Basic Day Pass").length).toBeGreaterThan(0);
    expect(view.getByText("Granted")).toBeDefined();
    expect(view.queryByText("Declined")).toBeNull();
    expect(view.queryByText("Privacy policy")).toBeNull();
    expect(
      view.container.textContent?.split(testEmailAddressForTest)
    ).toHaveLength(2);
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

  test("formats customer counts in the operator's locale", async () => {
    const { RouteLocaleProvider } = await import(
      "@/features/i18n/route-locale"
    );
    const { CustomerAdministrationDetailPage } = await import(
      "./customer-admin-components"
    );
    const { CustomerPromotionCodeAction } = await import(
      "./customer-admin-client"
    );
    const { m } = await import("@/features/administration/i18n");
    const { formatCount } = await import("@/shared/utils/number");
    const locale = "cs-CZ";
    const view = render(
      <RouteLocaleProvider locale={locale}>
        <CustomerAdministrationDetailPage
          activity={{
            reservations: [],
            reservationHistoryTruncated: false,
            transactions: [],
            transactionHistoryTruncated: false,
            stats: {
              reservationCount: 1250,
              favoriteProduct: null,
              favoriteReservationProduct: null,
              revenue: [],
              discountSavings: [],
            },
            marketingConsent: null,
          }}
          locale={locale}
          profile={{
            customer: {
              id: "dotypos-customer",
              displayName: "Test Customer",
              hasName: true,
              email: testEmailAddressForTest,
              phone: null,
              discountGroupId: null,
            },
            discountGroups: [],
            codes: [
              {
                ...dashboard.codes[0],
                audienceSize: 1250,
                discountAdjustment: { kind: "percentage", basisPoints: 1000 },
                discountLabels: {
                  "en-US": "Summer discount",
                  "cs-CZ": "Letní sleva",
                },
                eligible: true,
              },
            ],
            claims: [],
            vouchers: [],
            voucherClaims: [],
          }}
          reservationActivity={emptyReservationActivity}
        />
      </RouteLocaleProvider>
    );

    const reservationStat = view.getByText(
      m.discountsCustomerStatReservations({}, { locale }),
      { selector: "dt" }
    ).nextElementSibling;
    expect(reservationStat?.textContent).toBe(formatCount(1250, locale));
    const [, codeRow] = within(
      view.getByRole("table", { name: "Kódy a poukazy zákazníka" })
    ).getAllByRole("row");
    expect(codeRow?.textContent).toContain(
      `${formatCount(1250, locale)} vybraných zákazníků`
    );
    cleanup();

    const action = render(
      <RouteLocaleProvider locale={locale}>
        <CustomerPromotionCodeAction
          audienceSize={1000}
          code="SUMMER10"
          customerId="dotypos-customer"
          customerName="Test Customer"
          eligible={false}
          promotion={{ kind: "discount-code", id: dashboard.codes[0].id }}
        />
      </RouteLocaleProvider>
    );
    fireEvent.click(
      action.getByRole("button", {
        name: "Přidat zákazníka Test Customer ke kódu SUMMER10",
      })
    );
    const dialog = await action.findByRole("dialog");
    expect(dialog.textContent).toContain(
      m.discountsCodeAddCustomerDialogDescription(
        {
          code: "SUMMER10",
          customerName: "Test Customer",
          count: 1000,
          total: 1001,
        },
        { locale }
      )
    );
    expect(dialog.textContent).toContain(
      `omezen na ${formatCount(1000, locale)} dalších zákazníků`
    );
    expect(dialog.textContent).toContain(
      `dostupný ${formatCount(1001, locale)} zákazníkům`
    );
  });

  test("names an unnamed customer and the profile sections in Czech", async () => {
    const { RouteLocaleProvider } = await import(
      "@/features/i18n/route-locale"
    );
    const { CustomerAdministrationDetailPage } = await import(
      "./customer-admin-components"
    );
    const { unnamedCustomerDisplayName } = await import(
      "@/features/administration/customer-name"
    );
    const view = render(
      <RouteLocaleProvider locale="cs-CZ">
        <CustomerAdministrationDetailPage
          activity={{
            reservations: [],
            reservationHistoryTruncated: false,
            transactions: [],
            transactionHistoryTruncated: false,
            stats: {
              reservationCount: 0,
              favoriteProduct: null,
              favoriteReservationProduct: null,
              revenue: [],
              discountSavings: [],
            },
            marketingConsent: null,
          }}
          locale="cs-CZ"
          profile={{
            customer: {
              id: "dotypos-customer",
              displayName: unnamedCustomerDisplayName,
              hasName: false,
              email: null,
              phone: null,
              discountGroupId: null,
            },
            discountGroups: [],
            codes: [],
            claims: [],
            vouchers: [],
            voucherClaims: [],
          }}
          reservationActivity={emptyReservationActivity}
        />
      </RouteLocaleProvider>
    );

    expect(
      view.getByRole("heading", { level: 1, name: "Zákazník bez jména" })
    ).toBeTruthy();
    for (const name of ["Statistiky", "Souhlasy"]) {
      expect(view.getByRole("heading", { level: 2, name })).toBeTruthy();
    }
    expect(view.getByText("Tento zákazník nemá žádné platby.")).toBeTruthy();
    for (const english of [
      unnamedCustomerDisplayName,
      "Stats",
      "Consents",
      "This customer has no payments.",
    ]) {
      expect(view.container.textContent).not.toContain(english);
    }
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
    await waitFor(() =>
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
      })
    );

    fireEvent.click(view.getByRole("radio", { name: "Create a new discount" }));
    expect(
      view.getByRole("textbox", { name: "English (en-US)" })
    ).toBeDefined();
    expect(view.queryByRole("combobox", { name: "Discount" })).toBeNull();

    expect(view.queryByRole("radio", { name: "Create a voucher" })).toBeNull();
  });

  test("creates a customer voucher and returns to the customer", async () => {
    const captured = captureWorkspaceActions();
    const { CustomerVoucherCreationForm } = await import(
      "./customer-voucher-creation"
    );
    const view = render(
      <CustomerVoucherCreationForm
        completion="back"
        customer={{ displayName: "Test Customer", id: "dotypos-customer" }}
      />
    );

    expect(
      view.getByText("The new voucher will only be available to Test Customer.")
    ).toBeDefined();
    expect(view.queryByRole("combobox", { name: "Discount" })).toBeNull();
    fireEvent.change(view.getByRole("spinbutton", { name: /Value/ }), {
      target: { value: "25000" },
    });
    fireEvent.change(view.getByRole("textbox", { name: "Code" }), {
      target: { value: "gift250" },
    });
    fireEvent.submit(
      view.getByRole("button", { name: "Create voucher" }).closest("form")!
    );

    const action = captured("create-customer-voucher");
    await waitFor(() =>
      expect(action.execute).toHaveBeenCalledWith({
        kind: "create-customer-voucher",
        voucher: {
          customerId: "dotypos-customer",
          code: "GIFT250",
          credit: { value: 25_000, exponent: 2, currency: "CZK" },
          enabled: true,
          validFrom: null,
          validUntil: null,
        },
      })
    );
    act(() =>
      action.options.onSuccess({
        data: { notice: "Voucher created for this customer." },
      })
    );
    expect(back).toHaveBeenCalledTimes(1);
    expect(replace).not.toHaveBeenCalled();
  });

  test("adds and removes a customer from a voucher audience", async () => {
    const captured = captureWorkspaceActions();
    const { CustomerPromotionCodeAction } = await import(
      "./customer-admin-client"
    );
    const voucherId = "019c91dd-c560-7e55-b9d8-c95065efd56d";
    const renderAction = (audienceSize: number, eligible: boolean) =>
      render(
        <CustomerPromotionCodeAction
          audienceSize={audienceSize}
          code="GIFT100"
          customerId="dotypos-customer"
          customerName="Test Customer"
          eligible={eligible}
          promotion={{ kind: "voucher", id: voucherId }}
        />
      );

    const unrestricted = renderAction(0, false);
    fireEvent.click(
      unrestricted.getByRole("button", {
        name: "Add Test Customer to GIFT100",
      })
    );
    expect(
      await unrestricted.findByRole("heading", {
        name: "Limit GIFT100 to Test Customer?",
      })
    ).toBeDefined();
    fireEvent.click(
      unrestricted.getByRole("button", { name: "Limit to only this user" })
    );
    const action = captured(
      "add-voucher-customer",
      "remove-voucher-customer",
      "delete-voucher",
      "make-voucher-unrestricted"
    );
    expect(action.execute).toHaveBeenLastCalledWith({
      kind: "add-voucher-customer",
      voucherId,
      customerId: "dotypos-customer",
    });
    act(() =>
      action.options.onSuccess({
        data: { notice: "Customer added to the voucher audience." },
      })
    );
    await waitFor(() => expect(unrestricted.queryByRole("dialog")).toBeNull());
    expect(refresh).toHaveBeenCalledTimes(1);
    cleanup();

    const shared = renderAction(2, true);
    fireEvent.click(
      shared.getByRole("button", {
        name: "Remove Test Customer from GIFT100",
      })
    );
    expect(
      await shared.findByText(
        "Test Customer will no longer be able to use GIFT100."
      )
    ).toBeDefined();
    fireEvent.click(shared.getByRole("button", { name: "Remove customer" }));
    expect(action.execute).toHaveBeenLastCalledWith({
      kind: "remove-voucher-customer",
      voucherId,
      customerId: "dotypos-customer",
    });
    act(() =>
      action.options.onError({
        error: {
          serverError: "This customer is no longer in the voucher audience.",
        },
      })
    );
    expect((await shared.findByRole("alert")).textContent).toBe(
      "This customer is no longer in the voucher audience."
    );
    cleanup();

    const onlyCustomer = renderAction(1, true);
    fireEvent.click(
      onlyCustomer.getByRole("button", {
        name: "Remove Test Customer from GIFT100",
      })
    );
    expect(
      await onlyCustomer.findByText(
        "Removing Test Customer would leave GIFT100 without an audience, which makes it available to every customer. Choose whether to delete the voucher or make it available to all."
      )
    ).toBeDefined();
    fireEvent.click(
      onlyCustomer.getByRole("button", { name: "Delete voucher" })
    );
    expect(action.execute).toHaveBeenLastCalledWith({
      kind: "delete-voucher",
      id: voucherId,
    });
    fireEvent.click(
      onlyCustomer.getByRole("button", { name: "Make available to all" })
    );
    expect(action.execute).toHaveBeenLastCalledWith({
      kind: "make-voucher-unrestricted",
      voucherId,
    });
  });

  test("rebases the discount editor onto submitted values after success", async () => {
    const captured = captureWorkspaceActions();
    const { CodesAdministrationCollection } = await import("./components");
    const view = render(
      <CodesAdministrationCollection locale="en-US" dashboard={dashboard} />
    );
    fireEvent.click(view.getByRole("button", { name: "Edit SUMMER10" }));

    const save = view.getByRole("button", { name: "Save discount" });
    expect(save).toHaveProperty("disabled", true);
    fireEvent.input(
      view.container.querySelector(
        "#labelEn-019c91dd-c560-7e55-b9d8-c95065efd51d"
      ) as HTMLInputElement,
      { target: { value: "Updated summer discount" } }
    );
    expect(save).toHaveProperty("disabled", false);

    const { execute, options } = captured("update-discount");
    fireEvent.submit(save.closest("form")!);
    await waitFor(() =>
      expect(execute).toHaveBeenCalledWith({
        kind: "update-discount",
        discount: {
          id: "019c91dd-c560-7e55-b9d8-c95065efd51d",
          labels: {
            "cs-CZ": "Letní sleva",
            "en-US": "Updated summer discount",
          },
          adjustment: { kind: "percentage", basisPoints: 1000 },
          products: [{ kind: "cowork" }],
        },
      })
    );

    act(() => options.onSuccess({ data: { notice: "Discount saved." } }));
    const labelEn = view.container.querySelector(
      "#labelEn-019c91dd-c560-7e55-b9d8-c95065efd51d"
    ) as HTMLInputElement;
    await waitFor(() => {
      expect(labelEn.value).toBe("Updated summer discount");
      expect(save).toHaveProperty("disabled", true);
    });
    expect(view.getByRole("status").textContent).toContain("Discount saved.");

    // A follow-up edit submits the saved values plus the new change instead
    // of resurrecting the stale pre-save defaults.
    fireEvent.input(labelEn, {
      target: { value: "Twice-updated summer discount" },
    });
    expect(view.queryByRole("status")).toBeNull();
    expect(save).toHaveProperty("disabled", false);
    fireEvent.submit(save.closest("form")!);
    await waitFor(() =>
      expect(execute).toHaveBeenLastCalledWith({
        kind: "update-discount",
        discount: {
          id: "019c91dd-c560-7e55-b9d8-c95065efd51d",
          labels: {
            "cs-CZ": "Letní sleva",
            "en-US": "Twice-updated summer discount",
          },
          adjustment: { kind: "percentage", basisPoints: 1000 },
          products: [{ kind: "cowork" }],
        },
      })
    );
  });

  test("keeps edits made during a save in flight dirty after success", async () => {
    const captured = captureWorkspaceActions();
    const { CodesAdministrationCollection } = await import("./components");
    const view = render(
      <CodesAdministrationCollection locale="en-US" dashboard={dashboard} />
    );
    fireEvent.click(view.getByRole("button", { name: "Edit SUMMER10" }));

    const labelEn = () =>
      view.container.querySelector(
        "#labelEn-019c91dd-c560-7e55-b9d8-c95065efd51d"
      ) as HTMLInputElement;
    const saveButton = () =>
      view.getByRole("button", { name: "Save discount" });

    // Submit value A.
    fireEvent.input(labelEn(), { target: { value: "Submitted label" } });
    fireEvent.submit(saveButton().closest("form")!);
    const { execute, options } = captured("update-discount");
    await waitFor(() => expect(execute).toHaveBeenCalledTimes(1));

    // Edit to B while the request is still in flight.
    fireEvent.input(labelEn(), { target: { value: "Edited in flight" } });

    act(() => options.onSuccess({ data: { notice: "Discount saved." } }));

    // B is not treated as saved: it stays visible and the form stays dirty.
    await waitFor(() => {
      expect(labelEn().value).toBe("Edited in flight");
      expect(saveButton()).toHaveProperty("disabled", false);
    });
    expect(view.getByRole("status").textContent).toContain("Discount saved.");

    // The follow-up save submits B on top of the saved snapshot A.
    fireEvent.submit(saveButton().closest("form")!);
    await waitFor(() =>
      expect(execute).toHaveBeenLastCalledWith({
        kind: "update-discount",
        discount: {
          id: "019c91dd-c560-7e55-b9d8-c95065efd51d",
          labels: {
            "cs-CZ": "Letní sleva",
            "en-US": "Edited in flight",
          },
          adjustment: { kind: "percentage", basisPoints: 1000 },
          products: [{ kind: "cowork" }],
        },
      })
    );
  });

  test("keeps a reverted in-flight edit dirty instead of absorbing it into the snapshot", async () => {
    const captured = captureWorkspaceActions();
    const { CodesAdministrationCollection } = await import("./components");
    const view = render(
      <CodesAdministrationCollection locale="en-US" dashboard={dashboard} />
    );
    fireEvent.click(view.getByRole("button", { name: "Edit SUMMER10" }));

    const labelEn = () =>
      view.container.querySelector(
        "#labelEn-019c91dd-c560-7e55-b9d8-c95065efd51d"
      ) as HTMLInputElement;
    const saveButton = () =>
      view.getByRole("button", { name: "Save discount" });

    // Submit value A.
    fireEvent.input(labelEn(), { target: { value: "Submitted label" } });
    fireEvent.submit(saveButton().closest("form")!);
    const { execute, options } = captured("update-discount");
    await waitFor(() => expect(execute).toHaveBeenCalledTimes(1));

    // Revert to the original value O while the request is still in flight.
    fireEvent.input(labelEn(), { target: { value: "Summer discount" } });

    act(() => options.onSuccess({ data: { notice: "Discount saved." } }));

    // O is not overwritten by the snapshot A: it stays visible, the form
    // counts as dirty against the new defaults, and save stays enabled.
    await waitFor(() => {
      expect(labelEn().value).toBe("Summer discount");
      expect(saveButton()).toHaveProperty("disabled", false);
    });

    // The follow-up save submits O, not the saved snapshot A.
    fireEvent.submit(saveButton().closest("form")!);
    await waitFor(() =>
      expect(execute).toHaveBeenLastCalledWith({
        kind: "update-discount",
        discount: {
          id: "019c91dd-c560-7e55-b9d8-c95065efd51d",
          labels: {
            "cs-CZ": "Letní sleva",
            "en-US": "Summer discount",
          },
          adjustment: { kind: "percentage", basisPoints: 1000 },
          products: [{ kind: "cowork" }],
        },
      })
    );
  });

  test("registers product and enabled checkboxes in the update payloads", async () => {
    const captured = captureWorkspaceActions();
    const { CodesAdministrationCollection } = await import("./components");
    const view = render(
      <CodesAdministrationCollection locale="en-US" dashboard={dashboard} />
    );
    fireEvent.click(view.getByRole("button", { name: "Edit SUMMER10" }));

    const discountForm = view
      .getByRole("button", { name: "Save discount" })
      .closest("form")!;
    const meetingRoom = within(discountForm)
      .getAllByRole("checkbox")
      .find(
        (checkbox) =>
          checkbox.closest("label")?.textContent?.trim() === "Meeting room"
      );
    expect(meetingRoom).toBeDefined();
    fireEvent.click(meetingRoom!);
    fireEvent.submit(discountForm);
    const { execute: discountExecute } = captured("update-discount");
    await waitFor(() =>
      expect(discountExecute).toHaveBeenCalledWith({
        kind: "update-discount",
        discount: {
          id: "019c91dd-c560-7e55-b9d8-c95065efd51d",
          labels: {
            "cs-CZ": "Letní sleva",
            "en-US": "Summer discount",
          },
          adjustment: { kind: "percentage", basisPoints: 1000 },
          products: [{ kind: "cowork" }, { kind: "meeting-room" }],
        },
      })
    );

    const codeForm = view
      .getByRole("button", { name: "Save code" })
      .closest("form")!;
    fireEvent.input(
      codeForm.querySelector("#code-019c91dd-c560-7e55-b9d8-c95065efd52d")!,
      { target: { value: "summer11" } }
    );
    fireEvent.submit(codeForm);
    const { execute: codeExecute } = captured("update-code");
    await waitFor(() =>
      expect(codeExecute).toHaveBeenCalledWith({
        kind: "update-code",
        code: {
          id: "019c91dd-c560-7e55-b9d8-c95065efd52d",
          discountId: "019c91dd-c560-7e55-b9d8-c95065efd51d",
          code: "SUMMER11",
          enabled: true,
          validFrom: "2026-08-01T08:00:00Z",
          validUntil: "2026-09-01T08:00:00Z",
          maxUses: 100,
          maxUsesPerCustomer: 2,
        },
      })
    );
  });

  test("keeps create feedback through the reset to defaults until the next edit", async () => {
    const captured = captureWorkspaceActions();
    const { CreateDiscountForm } = await import("./admin-tables");
    const view = render(
      <StrictMode>
        <CreateDiscountForm />
      </StrictMode>
    );
    const labelEn = () =>
      view.getByRole("textbox", {
        name: "English (en-US)",
      }) as HTMLInputElement;
    const { execute, options } = captured("create-discount");

    act(() =>
      options.onError({ error: { serverError: "The discount was rejected." } })
    );
    expect(view.getByRole("alert").textContent).toContain(
      "The discount was rejected."
    );
    fireEvent.input(labelEn(), { target: { value: "Spring promo" } });
    expect(view.queryByRole("alert")).toBeNull();

    fireEvent.input(view.getByRole("textbox", { name: "Czech (cs-CZ)" }), {
      target: { value: "Jarní sleva" },
    });
    fireEvent.submit(labelEn().closest("form")!);
    await waitFor(() => expect(execute).toHaveBeenCalledTimes(1));

    act(() =>
      options.onSuccess({
        data: {
          notice: "Discount created.",
          createdDiscountId: "calendar-discount-id",
        },
      })
    );
    await waitFor(() => expect(labelEn().value).toBe(""));
    expect(view.getByRole("status").textContent).toContain(
      "Discount created. Calendar ID: calendar-discount-id"
    );

    fireEvent.input(labelEn(), { target: { value: "Summer promo" } });
    expect(view.queryByRole("status")).toBeNull();
  });

  test("rejects a carried-over currency outside the catalog with the action's validation banner", async () => {
    const voucherId = "019c91dd-c560-7e55-b9d8-c95065efd55d";
    const captured = captureWorkspaceActions();
    const { VoucherEditor } = await import("./admin-tables");
    const view = render(
      <VoucherEditor
        voucher={{
          id: voucherId as VoucherTableItem["id"],
          code: "GIFT100",
          issuedCredit: { value: 10_000, exponent: 2, currency: "ZZZ" },
          remainingCredit: { value: 10_000, exponent: 2, currency: "ZZZ" },
          enabled: true,
          validFrom: null,
          validUntil: null,
          audienceSize: 0,
          reservedUses: 0,
          redeemedUses: 0,
        }}
      />
    );
    const { execute, options } = captured("update-voucher");
    const codeField = view.getByRole("textbox", { name: "Code" });

    fireEvent.input(codeField, { target: { value: "gift101" } });
    fireEvent.submit(codeField.closest("form")!);
    const rejection = (await view.findByRole("alert")).textContent;
    expect(execute).not.toHaveBeenCalled();
    fireEvent.input(codeField, { target: { value: "gift102" } });
    expect(view.queryByRole("alert")).toBeNull();

    // The same banner the action shows when its input validation rejects a
    // submission.
    act(() => options.onError({ error: { validationErrors: {} } }));
    expect(view.getByRole("alert").textContent).toBe(rejection);
  });

  test("shows the server's failure as sent on a cs-CZ route", async () => {
    const captured = captureWorkspaceActions();
    const { RouteLocaleProvider } = await import(
      "@/features/i18n/route-locale"
    );
    const { CreateDiscountForm } = await import("./admin-tables");
    const view = render(
      <RouteLocaleProvider locale="cs-CZ">
        <CreateDiscountForm />
      </RouteLocaleProvider>
    );
    const { options } = captured("create-discount");

    act(() =>
      options.onError({
        error: { serverError: "Propagační kód s touto hodnotou už existuje." },
      })
    );
    expect(view.getByRole("alert").textContent).toBe(
      "Propagační kód s touto hodnotou už existuje."
    );
  });

  test("targets single cowork tiers and blocks mixing them with all cowork tiers", async () => {
    const execute = mock();
    workspaceUseAction.mockReturnValue({
      execute,
      isExecuting: false,
      result: {},
    });
    const { CreateDiscountForm } = await import("./admin-tables");
    const view = render(<CreateDiscountForm />);
    const form = view
      .getByRole("button", { name: "Create discount" })
      .closest("form")!;

    fireEvent.input(view.getByRole("textbox", { name: "English (en-US)" }), {
      target: { value: "Desk week" },
    });
    fireEvent.input(view.getByRole("textbox", { name: "Czech (cs-CZ)" }), {
      target: { value: "Týden u stolu" },
    });
    fireEvent.click(view.getByRole("checkbox", { name: "Meeting room" }));
    fireEvent.click(view.getByRole("checkbox", { name: "Reserved Desk only" }));
    fireEvent.submit(form);
    await waitFor(() =>
      expect(execute).toHaveBeenCalledWith({
        kind: "create-discount",
        discount: {
          labels: { "cs-CZ": "Týden u stolu", "en-US": "Desk week" },
          adjustment: { kind: "percentage", basisPoints: 1000 },
          products: [
            { kind: "cowork", tier: "reserved-desk" },
            { kind: "meeting-room" },
          ],
        },
      })
    );

    execute.mockClear();
    fireEvent.click(view.getByRole("checkbox", { name: "All cowork tiers" }));
    fireEvent.submit(form);
    await waitFor(() =>
      expect(
        view.getByText(
          "Choose either all cowork tiers or specific cowork tiers, not both."
        )
      ).toBeDefined()
    );
    expect(execute).not.toHaveBeenCalled();

    fireEvent.click(view.getByRole("checkbox", { name: "Reserved Desk only" }));
    fireEvent.submit(form);
    await waitFor(() =>
      expect(execute).toHaveBeenCalledWith({
        kind: "create-discount",
        discount: {
          labels: { "cs-CZ": "Týden u stolu", "en-US": "Desk week" },
          adjustment: { kind: "percentage", basisPoints: 1000 },
          products: [{ kind: "cowork" }, { kind: "meeting-room" }],
        },
      })
    );
  });

  test("shows and edits cowork tier targets in the code table", async () => {
    const captured = captureWorkspaceActions();
    const [discount] = dashboard.discounts;
    const { CodesAdministrationCollection } = await import("./components");
    const view = render(
      <CodesAdministrationCollection
        locale="en-US"
        dashboard={{
          ...dashboard,
          discounts: [
            {
              ...discount,
              products: [
                { kind: "cowork", tier: "open-space" },
                { kind: "office" },
              ],
            },
          ],
        }}
      />
    );

    const row = view.getByRole("link", { name: "SUMMER10" }).closest("tr")!;
    expect(
      within(row).getByText("Open Space only, Private office")
    ).toBeDefined();
    fireEvent.click(view.getByRole("button", { name: "Edit SUMMER10" }));
    const discountForm = view
      .getByRole("button", { name: "Save discount" })
      .closest("form")!;
    expect(
      within(discountForm)
        .getAllByRole("checkbox", { checked: true })
        .map((checkbox) => checkbox.closest("label")?.textContent?.trim())
    ).toEqual(["Open Space only", "Private office"]);

    fireEvent.click(
      within(discountForm).getByRole("checkbox", {
        name: "Reserved Desk only",
      })
    );
    fireEvent.submit(discountForm);
    await waitFor(() =>
      expect(captured("update-discount").execute).toHaveBeenCalledWith({
        kind: "update-discount",
        discount: {
          id: discount.id,
          labels: discount.labels,
          adjustment: discount.adjustment,
          products: [
            { kind: "cowork", tier: "open-space" },
            { kind: "cowork", tier: "reserved-desk" },
            { kind: "office" },
          ],
        },
      })
    );
  });

  test("sets and clears a customer discount group", async () => {
    const captured = captureWorkspaceActions();
    const { CustomerDiscountGroupForm } = await import(
      "./customer-admin-client"
    );
    const view = render(
      <CustomerDiscountGroupForm
        customerId="dotypos-customer"
        currentGroupId={null}
        discountGroups={[{ id: "group-1", name: "Gold", basisPoints: 1000 }]}
      />
    );
    const form = view
      .getByRole("button", { name: "Save group" })
      .closest("form")!;
    const select = view.getByLabelText("Discount group");

    fireEvent.change(select, { target: { value: "group-1" } });
    fireEvent.submit(form);
    const { execute } = captured("set-customer-discount-group");
    await waitFor(() =>
      expect(execute).toHaveBeenCalledWith({
        kind: "set-customer-discount-group",
        customerId: "dotypos-customer",
        discountGroupId: "group-1",
      })
    );

    execute.mockClear();
    fireEvent.change(select, { target: { value: "" } });
    fireEvent.submit(form);
    await waitFor(() =>
      expect(execute).toHaveBeenCalledWith({
        kind: "set-customer-discount-group",
        customerId: "dotypos-customer",
        discountGroupId: null,
      })
    );
  });

  test("creates general codes for both existing and new discounts", async () => {
    const execute = mock();
    workspaceUseAction.mockReturnValue({
      execute,
      isExecuting: false,
      result: {},
    });
    const { DiscountCodeCreationForm } = await import(
      "./customer-code-creation"
    );
    const view = render(
      <DiscountCodeCreationForm discounts={dashboard.discounts} />
    );
    const form = view.getByRole("form", { name: "Create discount code" });
    const expectedCode = {
      code: "PERSONAL10",
      enabled: true,
      validFrom: null,
      validUntil: null,
      maxUses: null,
      maxUsesPerCustomer: null,
    };

    fireEvent.change(view.getByRole("textbox", { name: "Code" }), {
      target: { value: "personal10" },
    });
    fireEvent.submit(form);
    await waitFor(() =>
      expect(execute).toHaveBeenCalledWith({
        kind: "create-code",
        code: expectedCode,
        discount: {
          kind: "existing",
          discountId: dashboard.discounts[0].id,
        },
      })
    );

    execute.mockClear();
    fireEvent.click(view.getByRole("radio", { name: "Create a new discount" }));
    fireEvent.input(view.getByRole("textbox", { name: "English (en-US)" }), {
      target: { value: "Winter discount" },
    });
    fireEvent.input(view.getByRole("textbox", { name: "Czech (cs-CZ)" }), {
      target: { value: "Zimní sleva" },
    });
    const cowork = within(form)
      .getAllByRole("checkbox")
      .find(
        (checkbox) =>
          checkbox.closest("label")?.textContent?.trim() === "All cowork tiers"
      );
    expect(cowork).toBeDefined();
    fireEvent.click(cowork!);
    fireEvent.submit(form);
    await waitFor(() =>
      expect(execute).toHaveBeenCalledWith({
        kind: "create-code",
        code: expectedCode,
        discount: {
          kind: "new",
          discount: {
            labels: { "cs-CZ": "Zimní sleva", "en-US": "Winter discount" },
            adjustment: { kind: "percentage", basisPoints: 1000 },
            products: [{ kind: "cowork" }],
          },
        },
      })
    );
  });

  test("ignores inactive adjustment fields when switching kinds", async () => {
    const execute = mock();
    workspaceUseAction.mockReturnValue({
      execute,
      isExecuting: false,
      result: {},
    });
    const { CreateDiscountForm } = await import("./admin-tables");
    const view = render(<CreateDiscountForm />);
    const form = view
      .getByRole("button", { name: "Create discount" })
      .closest("form")!;

    fireEvent.input(view.getByRole("textbox", { name: "English (en-US)" }), {
      target: { value: "Fixed promo" },
    });
    fireEvent.input(view.getByRole("textbox", { name: "Czech (cs-CZ)" }), {
      target: { value: "Pevná sleva" },
    });
    fireEvent.input(view.getByRole("spinbutton", { name: "Percentage" }), {
      target: { value: "" },
    });
    fireEvent.change(view.getByRole("combobox", { name: "Type" }), {
      target: { value: "fixed" },
    });
    fireEvent.submit(form);
    await waitFor(() =>
      expect(execute).toHaveBeenCalledWith({
        kind: "create-discount",
        discount: {
          labels: { "cs-CZ": "Pevná sleva", "en-US": "Fixed promo" },
          adjustment: {
            kind: "fixed",
            amount: { value: 10000, exponent: 2, currency: "CZK" },
          },
          products: [],
        },
      })
    );

    execute.mockClear();
    fireEvent.input(view.getByRole("spinbutton", { name: "Fixed value" }), {
      target: { value: "" },
    });
    fireEvent.change(view.getByRole("combobox", { name: "Type" }), {
      target: { value: "percentage" },
    });
    fireEvent.input(view.getByRole("spinbutton", { name: "Percentage" }), {
      target: { value: "10" },
    });
    fireEvent.submit(form);
    await waitFor(() =>
      expect(execute).toHaveBeenCalledWith({
        kind: "create-discount",
        discount: {
          labels: { "cs-CZ": "Pevná sleva", "en-US": "Fixed promo" },
          adjustment: { kind: "percentage", basisPoints: 1000 },
          products: [],
        },
      })
    );
    expect(execute).toHaveBeenCalledTimes(1);

    // Flush the deferred form-state update so it does not run after the DOM
    // test environment is torn down.
    await act(() => new Promise<void>((resolve) => setTimeout(resolve, 50)));
  });

  test("skips new-discount definition checks after switching to an existing discount", async () => {
    const execute = mock();
    workspaceUseAction.mockReturnValue({
      execute,
      isExecuting: false,
      result: {},
    });
    const { DiscountCodeCreationForm } = await import(
      "./customer-code-creation"
    );
    const view = render(
      <DiscountCodeCreationForm discounts={dashboard.discounts} />
    );
    const form = view.getByRole("form", { name: "Create discount code" });

    fireEvent.click(view.getByRole("radio", { name: "Create a new discount" }));
    fireEvent.input(view.getByRole("textbox", { name: "English (en-US)" }), {
      target: { value: "Half-defined discount" },
    });
    fireEvent.input(view.getByRole("spinbutton", { name: "Percentage" }), {
      target: { value: "" },
    });
    fireEvent.click(
      view.getByRole("radio", { name: "Use an existing discount" })
    );
    fireEvent.change(view.getByRole("textbox", { name: "Code" }), {
      target: { value: "personal10" },
    });
    fireEvent.submit(form);
    await waitFor(() =>
      expect(execute).toHaveBeenCalledWith({
        kind: "create-code",
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
      })
    );

    // Flush the deferred form-state update so it does not run after the DOM
    // test environment is torn down.
    await act(() => new Promise<void>((resolve) => setTimeout(resolve, 50)));
  });
});
