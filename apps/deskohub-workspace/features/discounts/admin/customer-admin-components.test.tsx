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
import { loadFixtureReservations } from "@/features/administration/fixtures";
import { m } from "@/features/administration/i18n";
import { workspaceUseAction } from "@/shared/testing/workspace-component-module-mocks";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";
import {
  adminCodeClaim,
  adminCustomer,
  adminCustomerCode,
  adminCustomerProfile,
  adminCustomerVoucher,
  adminVoucherClaim,
} from "./customer-admin-fixtures.test-utils";
import type {
  AdminCustomerProfile,
  AdminDiscountCodeDetail,
  AdminVoucherDetail,
} from "./discount-administration.service";

// react-dom decides how to synthesize change events while it is evaluated, so
// the DOM environment must exist before @testing-library/react loads.
registerWorkspaceComponentTestEnv();
const { cleanup, fireEvent, render, within } = await import(
  "@testing-library/react"
);

const locale = "en-US";

const navigation = await import("next/navigation");
mock.module("next/navigation", () => ({
  ...navigation,
  useParams: () => ({ locale }),
  useRouter: () => ({
    back: mock(),
    push: mock(),
    refresh: mock(),
    replace: mock(),
  }),
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

const execute = mock();
const confirm = mock((_message?: string) => true);
const originalConfirm = globalThis.confirm;

type AudienceCustomer = AdminDiscountCodeDetail["customers"][number];
const reachable: AudienceCustomer = {
  customerId: adminCustomer().id,
  customer: adminCustomer(),
};
const unlisted: AudienceCustomer = {
  customerId: "unlisted-customer" as AudienceCustomer["customerId"],
  customer: null,
};
const withoutContact: AudienceCustomer = {
  customerId: "silent-customer" as AudienceCustomer["customerId"],
  customer: adminCustomer({
    id: "silent-customer" as AudienceCustomer["customerId"],
    displayName: "Silent Customer",
    email: null,
    phone: null,
  }),
};

const codeDetail = (
  overrides: Partial<AdminDiscountCodeDetail> = {}
): AdminDiscountCodeDetail => {
  const {
    discountAdjustment,
    discountLabel,
    discountLabels,
    eligible,
    ...code
  } = adminCustomerCode();
  return {
    code,
    discountLabel,
    discountLabels,
    customers: [],
    claims: [],
    ...overrides,
  };
};

const voucherDetail = (
  overrides: Partial<AdminVoucherDetail> = {}
): AdminVoucherDetail => {
  const { eligible, ...voucher } = adminCustomerVoucher();
  return { voucher, customers: [], claims: [], ...overrides };
};

const audienceSection = (view: ReturnType<typeof render>) => {
  const heading = view.getByRole("heading", {
    name: m.discountsColumnAudience({}, { locale }),
  });
  const section = heading.closest("section");
  if (!section) throw new Error("The audience heading has no section.");
  return within(section);
};

describe("customer administration pages", () => {
  beforeAll(() => {
    registerWorkspaceComponentTestEnv();
    globalThis.confirm = confirm;
  });

  beforeEach(() => {
    execute.mockReset();
    confirm.mockClear();
    workspaceUseAction.mockReset();
    workspaceUseAction.mockReturnValue({
      execute,
      isExecuting: false,
      result: {},
    });
  });

  afterEach(() => {
    cleanup();
  });

  afterAll(async () => {
    globalThis.confirm = originalConfirm;
    await unregisterWorkspaceComponentTestEnv();
  });

  describe("code detail", () => {
    test("shows an unrestricted code's empty audience and claim history", async () => {
      const { CodeAdministrationDetailPage } = await import(
        "./customer-admin-components"
      );
      const view = render(
        <CodeAdministrationDetailPage detail={codeDetail()} locale={locale} />
      );
      const audience = audienceSection(view);
      expect(
        audience.getByText(m.discountsCodeAudienceUnrestricted({}, { locale }))
      ).toBeDefined();
      expect(
        audience.getByText(m.discountsAudienceEmpty({}, { locale }))
      ).toBeDefined();
      expect(
        audience.queryByRole("button", {
          name: m.discountsMakeUnrestricted({}, { locale }),
        })
      ).toBeNull();
      expect(
        view.getByText(m.discountsCodeClaimsEmpty({}, { locale }))
      ).toBeDefined();
      expect(
        view.getByRole("searchbox", {
          name: m.discountsCustomerSearchLabel({}, { locale }),
        })
      ).toBeDefined();
    });

    test("lists each audience customer and removes one after confirmation", async () => {
      const { CodeAdministrationDetailPage } = await import(
        "./customer-admin-components"
      );
      const detail = codeDetail({
        customers: [reachable, unlisted, withoutContact],
        claims: [adminCodeClaim()],
      });
      const view = render(
        <CodeAdministrationDetailPage detail={detail} locale={locale} />
      );
      const audience = audienceSection(view);
      expect(
        audience.getByText(
          m.discountsCodeAudienceCount({ count: 3 }, { locale })
        )
      ).toBeDefined();

      const rows = audience.getAllByRole("listitem");
      expect(rows).toHaveLength(3);
      const [reachableRow, unlistedRow, silentRow] = rows as [
        HTMLElement,
        HTMLElement,
        HTMLElement,
      ];
      expect(
        within(reachableRow)
          .getByRole("link", { name: "Test Customer" })
          .getAttribute("href")
      ).toBe(`/${locale}/admin/customers/${reachable.customerId}`);
      expect(
        within(unlistedRow).getByRole("link", {
          name: m.discountsCustomerDetailsUnavailable({}, { locale }),
        })
      ).toBeDefined();
      expect(within(unlistedRow).getByText(unlisted.customerId)).toBeDefined();
      expect(
        within(silentRow).getByText(
          m.discountsCustomerNoContactDetails({}, { locale })
        )
      ).toBeDefined();

      fireEvent.click(
        within(unlistedRow).getByRole("button", {
          name: m.discountsRemove({}, { locale }),
        })
      );
      expect(confirm).toHaveBeenCalledWith(
        m.discountsCodeRemoveCustomerConfirmation(
          { customerName: unlisted.customerId },
          { locale }
        )
      );
      expect(execute).toHaveBeenCalledWith({
        kind: "remove-code-customer",
        codeId: detail.code.id,
        customerId: unlisted.customerId,
      });

      fireEvent.click(
        within(reachableRow).getByRole("button", {
          name: m.discountsRemove({}, { locale }),
        })
      );
      expect(confirm).toHaveBeenLastCalledWith(
        m.discountsCodeRemoveCustomerConfirmation(
          { customerName: "Test Customer" },
          { locale }
        )
      );

      fireEvent.click(
        audience.getByRole("button", {
          name: m.discountsMakeUnrestricted({}, { locale }),
        })
      );
      expect(confirm).toHaveBeenLastCalledWith(
        m.discountsCodeMakeUnrestrictedConfirmation({}, { locale })
      );
      expect(execute).toHaveBeenLastCalledWith({
        kind: "make-code-unrestricted",
        codeId: detail.code.id,
      });

      const claims = view.getByRole("table", {
        name: m.discountsCodeClaimHistoryLabel({}, { locale }),
      });
      expect(within(claims).getAllByRole("row")).toHaveLength(2);
    });

    test("points the last audience customer to opening the code to everyone", async () => {
      const { CodeAdministrationDetailPage } = await import(
        "./customer-admin-components"
      );
      const view = render(
        <CodeAdministrationDetailPage
          detail={codeDetail({ customers: [reachable] })}
          locale={locale}
        />
      );
      const audience = audienceSection(view);
      expect(
        audience.queryByRole("button", {
          name: m.discountsRemove({}, { locale }),
        })
      ).toBeNull();
      expect(
        audience.getByText(m.discountsUseMakeUnrestricted({}, { locale }))
      ).toBeDefined();
    });
  });

  describe("voucher detail", () => {
    test("shows an unrestricted voucher's empty audience and claim history", async () => {
      const { VoucherAdministrationDetailPage } = await import(
        "./customer-admin-components"
      );
      const view = render(
        <VoucherAdministrationDetailPage
          detail={voucherDetail()}
          locale={locale}
        />
      );
      const audience = audienceSection(view);
      expect(
        audience.getByText(
          m.discountsVoucherAudienceUnrestricted({}, { locale })
        )
      ).toBeDefined();
      expect(
        audience.getByText(m.discountsAudienceEmpty({}, { locale }))
      ).toBeDefined();
      expect(
        view.getByText(m.discountsVoucherClaimsEmpty({}, { locale }))
      ).toBeDefined();
    });

    test("removes a voucher customer and opens a dated voucher to everyone", async () => {
      const { VoucherAdministrationDetailPage } = await import(
        "./customer-admin-components"
      );
      const detail = voucherDetail({
        voucher: {
          ...voucherDetail().voucher,
          validFrom: Temporal.Instant.from("2026-08-01T08:00:00Z"),
          validUntil: Temporal.Instant.from("2026-09-01T08:00:00Z"),
          audienceSize: 2,
        },
        customers: [reachable, withoutContact],
        claims: [adminVoucherClaim()],
      });
      const view = render(
        <VoucherAdministrationDetailPage detail={detail} locale={locale} />
      );
      const audience = audienceSection(view);
      expect(
        audience.getByText(
          m.discountsVoucherAudienceCount({ count: 2 }, { locale })
        )
      ).toBeDefined();

      const [, silentRow] = audience.getAllByRole("listitem") as [
        HTMLElement,
        HTMLElement,
      ];
      fireEvent.click(
        within(silentRow).getByRole("button", {
          name: m.discountsRemove({}, { locale }),
        })
      );
      expect(confirm).toHaveBeenCalledWith(
        m.discountsVoucherRemoveCustomerConfirmation(
          { customerName: "Silent Customer" },
          { locale }
        )
      );
      expect(execute).toHaveBeenCalledWith({
        kind: "remove-voucher-customer",
        voucherId: detail.voucher.id,
        customerId: withoutContact.customerId,
      });

      fireEvent.click(
        audience.getByRole("button", {
          name: m.discountsMakeUnrestricted({}, { locale }),
        })
      );
      expect(confirm).toHaveBeenLastCalledWith(
        m.discountsVoucherMakeUnrestrictedConfirmation({}, { locale })
      );
      expect(execute).toHaveBeenLastCalledWith({
        kind: "make-voucher-unrestricted",
        voucherId: detail.voucher.id,
      });

      const claims = view.getByRole("table", {
        name: m.discountsVoucherClaimHistoryLabel({}, { locale }),
      });
      expect(within(claims).getAllByRole("row")).toHaveLength(2);
    });
  });

  describe("customer detail", () => {
    const reservations = loadFixtureReservations({
      customerId: "customer-alex",
    }).items.map((reservation) => ({ ...reservation, customer: null }));

    const renderCustomerPage = async (
      profile: AdminCustomerProfile,
      overrides: {
        readonly reservations?: typeof reservations;
        readonly reservationHistoryTruncated?: boolean;
        readonly transactionHistoryTruncated?: boolean;
      } = {}
    ) => {
      const { CustomerAdministrationDetailPage } = await import(
        "./customer-admin-components"
      );
      return render(
        <CustomerAdministrationDetailPage
          activity={{
            reservations: overrides.reservations ?? [],
            reservationHistoryTruncated:
              overrides.reservationHistoryTruncated ?? false,
            transactions: [],
            transactionHistoryTruncated:
              overrides.transactionHistoryTruncated ?? false,
            stats: {
              reservationCount: 0,
              favoriteProduct: null,
              favoriteReservationProduct: null,
              revenue: [],
              discountSavings: [],
            },
            marketingConsent: null,
          }}
          locale={locale}
          notice={{ message: "Saved.", status: "success" }}
          profile={profile}
          reservationActivity={{
            from: "2025-08-25",
            to: "2026-08-24",
            dates: [],
          }}
        />
      );
    };

    test("shows a customer without codes, contacts, or history", async () => {
      const view = await renderCustomerPage(
        adminCustomerProfile({
          customer: adminCustomer({ email: null, phone: null }),
        })
      );
      expect(
        view.getByText(m.discountsCustomerCodesEmpty({}, { locale }))
      ).toBeDefined();
      expect(
        view.getByText(m.discountsCustomerGroupNone({}, { locale }))
      ).toBeDefined();
      expect(view.getAllByText("—").length).toBeGreaterThanOrEqual(2);
      expect(
        view.queryByText(
          m.discountsCustomerTransactionsTruncated({}, { locale })
        )
      ).toBeNull();
      expect(
        view.queryByRole("link", {
          name: m.discountsCustomerViewAllReservations({}, { locale }),
        })
      ).toBeNull();
      expect(
        view.getByText(
          m.discountsCustomerCurrentReservationsEmpty({}, { locale })
        )
      ).toBeDefined();
      expect(
        view.getByText(m.discountsCustomerClaimsEmpty({}, { locale }))
      ).toBeDefined();
    });

    test("links truncated reservations, lists undated ones, and shows the customer's claims", async () => {
      const [dated] = reservations;
      if (!dated) throw new Error("The fixture has no reservations.");
      const profile = adminCustomerProfile({
        codes: [adminCustomerCode()],
        claims: [adminCodeClaim()],
      });
      const view = await renderCustomerPage(profile, {
        reservations: [dated, { ...dated, id: "undated", endsAt: null }],
        reservationHistoryTruncated: true,
        transactionHistoryTruncated: true,
      });

      expect(
        view
          .getByRole("link", {
            name: m.discountsCustomerViewAllReservations({}, { locale }),
          })
          .getAttribute("href")
      ).toBe(
        `/${locale}/admin/reservations?customerId=${encodeURIComponent(profile.customer.id)}`
      );
      expect(
        view.getByText(
          m.discountsCustomerUnavailableDateReservations(
            { count: "1" },
            { locale }
          )
        )
      ).toBeDefined();
      expect(
        view.getByText(m.discountsCustomerTransactionsTruncated({}, { locale }))
      ).toBeDefined();
      expect(
        view.getByRole("table", {
          name: m.discountsCustomerCodesTableLabel({}, { locale }),
        })
      ).toBeDefined();
      const claims = view.getByRole("table", {
        name: m.discountsCustomerClaimHistoryLabel({}, { locale }),
      });
      expect(
        within(claims).getByRole("link", { name: profile.codes[0]?.code })
      ).toBeDefined();
    });
  });
});
