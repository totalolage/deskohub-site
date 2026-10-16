import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  mock,
  test,
} from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import { cleanup, render, within } from "@testing-library/react";
import { customerAccountIdSchema } from "@/features/account/customer-account";
import { RouteLocaleProvider } from "@/features/i18n/route-locale";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";
import type { AdministratorsPageData } from "./page-data.server";

mock.module("./actions", () => ({
  grantAdministrator: async () => ({}),
  revokeAdministrator: async () => ({}),
}));

beforeAll(() => {
  registerWorkspaceComponentTestEnv();
});

afterEach(() => {
  cleanup();
});

afterAll(async () => {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await unregisterWorkspaceComponentTestEnv();
});

const actorAccountId = customerAccountIdSchema.make("fixture-actor");
const actorEmail = testEmailAddress("roster-view-actor");
const otherEmail = testEmailAddress("roster-view-other");

const pageData: AdministratorsPageData = {
  actorAccountId,
  administrators: [
    {
      accountId: actorAccountId,
      email: actorEmail,
      grantedByEmail: null,
      grantedAt: "2026-10-01T08:00:00Z",
      grantedAtLabel: "1. 10. 2026 10:00",
    },
    {
      accountId: customerAccountIdSchema.make("fixture-other"),
      email: otherEmail,
      grantedByEmail: actorEmail,
      grantedAt: "2026-10-02T08:00:00Z",
      grantedAtLabel: "2. 10. 2026 10:00",
    },
  ],
};

const renderRoster = async (locale: "en-US" | "cs-CZ") => {
  const { AdministratorRoster } = await import("./administrator-roster");
  return render(
    <RouteLocaleProvider locale={locale}>
      <AdministratorRoster {...pageData} />
    </RouteLocaleProvider>
  );
};

const rowOf = (
  view: Awaited<ReturnType<typeof renderRoster>>,
  email: string
) => {
  const row = view
    .getAllByRole("row")
    .find((candidate) => within(candidate).queryByText(email) !== null);
  if (!row) throw new Error(`No row shows ${email}.`);
  return row;
};

describe("AdministratorRoster", () => {
  test("offers revocation for other administrators but not the acting one", async () => {
    const view = await renderRoster("en-US");

    expect(
      within(rowOf(view, actorEmail)).queryByRole("button", { name: /revoke/i })
    ).toBeNull();
    expect(
      within(rowOf(view, otherEmail)).getByRole("button", {
        name: `Revoke the administrator role from ${otherEmail}`,
      })
    ).toBeDefined();
  });

  test("labels a bootstrap grant as the system's in the route locale", async () => {
    const view = await renderRoster("cs-CZ");

    expect(
      within(rowOf(view, actorEmail)).getByText("Systém (počáteční nastavení)")
    ).toBeDefined();
    expect(within(rowOf(view, otherEmail)).getByText(actorEmail)).toBeDefined();
    expect(
      within(rowOf(view, otherEmail)).getByText("2. 10. 2026 10:00")
    ).toBeDefined();
    expect(
      within(rowOf(view, otherEmail)).getByRole("button", {
        name: `Odebrat roli administrátora účtu ${otherEmail}`,
      })
    ).toBeDefined();
  });
});
