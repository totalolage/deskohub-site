import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  mock,
  test,
} from "bun:test";
import { m } from "@/features/administration/i18n";
import "@/shared/testing/workspace-component-module-mocks";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";
import { toClaimHistoryItem } from "./claim-history-item";
import { adminCodeClaim } from "./customer-admin-fixtures.test-utils";

// react-dom decides how to synthesize change events while it is evaluated, so
// the DOM environment must exist before @testing-library/react loads.
registerWorkspaceComponentTestEnv();
const { cleanup, fireEvent, render, waitFor, within } = await import(
  "@testing-library/react"
);

const locale = "en-US";

mock.module("./actions", () => ({
  mutateDiscountAdmin: mock(),
  searchDiscountAdminCustomers: mock(),
}));

describe("claim history table", () => {
  beforeAll(() => {
    registerWorkspaceComponentTestEnv();
  });

  afterEach(() => {
    cleanup();
  });

  afterAll(async () => {
    await unregisterWorkspaceComponentTestEnv();
  });

  test("sorts claims by completion, open claims first", async () => {
    const { RouteLocaleProvider } = await import(
      "@/features/i18n/route-locale"
    );
    const { ClaimHistoryTable } = await import("./customer-admin-tables");
    type ClaimId = ReturnType<typeof adminCodeClaim>["id"];
    const claims = [
      adminCodeClaim({
        id: "redeemed" as ClaimId,
        redeemedAt: Temporal.Instant.from("2026-08-12T08:00:00Z"),
        state: "redeemed",
      }),
      adminCodeClaim({
        id: "released" as ClaimId,
        releasedAt: Temporal.Instant.from("2026-08-11T08:00:00Z"),
        state: "released",
      }),
      adminCodeClaim({ id: "reserved" as ClaimId }),
    ].map((claim) => toClaimHistoryItem(claim, locale));
    const view = render(
      <RouteLocaleProvider locale={locale}>
        <ClaimHistoryTable
          ariaLabel="Claims"
          claims={claims}
          subject="customer"
        />
      </RouteLocaleProvider>
    );
    const table = within(view.getByRole("table", { name: "Claims" }));
    const states = () =>
      table
        .getAllByRole("row")
        .slice(1)
        .map((row) => row.querySelector("td:nth-child(2)")?.textContent);
    expect(states()).toEqual([
      m.discountsClaimStateRedeemed({}, { locale }),
      m.discountsClaimStateReleased({}, { locale }),
      m.discountsClaimStateReserved({}, { locale }),
    ]);

    fireEvent.click(
      table.getByRole("button", {
        name: m.discountsColumnCompleted({}, { locale }),
      })
    );
    await waitFor(() => {
      expect(states()).toEqual([
        m.discountsClaimStateReserved({}, { locale }),
        m.discountsClaimStateReleased({}, { locale }),
        m.discountsClaimStateRedeemed({}, { locale }),
      ]);
    });
  });
});
