import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  test,
} from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import { customerAccountIdSchema } from "@/features/account/customer-account";
import { m } from "@/features/administration/i18n";
import { RouteLocaleProvider } from "@/features/i18n/route-locale";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";
import type { grantAdministrator as grantAdministratorAction } from "./actions";
import type { AdministratorsPageData } from "./page-data.server";

type GrantResult = Awaited<ReturnType<typeof grantAdministratorAction>>;

const grantAdministrator = mock<typeof grantAdministratorAction>(
  async () => ({})
);

mock.module("./actions", () => ({
  grantAdministrator,
  revokeAdministrator: async () => ({}),
}));

registerWorkspaceComponentTestEnv();
// React DOM, which @testing-library/react loads, must load after the
// happy-dom registration to handle input events.
const { act, cleanup, fireEvent, render, waitFor, within } = await import(
  "@testing-library/react"
);

beforeEach(() => {
  grantAdministrator.mockReset();
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

  describe("granting the administrator role", () => {
    const grantedEmail = testEmailAddress("roster-view-granted");

    const submitGrant = async (result: GrantResult) => {
      grantAdministrator.mockResolvedValue(result);
      const view = await renderRoster("en-US");
      const input = view.getByPlaceholderText(
        m.administratorsGrantEmailLabel({}, { locale: "en-US" })
      ) as HTMLInputElement;
      fireEvent.change(input, { target: { value: grantedEmail } });
      await act(async () => {
        fireEvent.click(
          view.getByRole("button", {
            name: m.administratorsGrantSubmit({}, { locale: "en-US" }),
          })
        );
      });
      await waitFor(() => expect(grantAdministrator).toHaveBeenCalledTimes(1));
      return { input, view };
    };

    test.each([
      [true, m.administratorsGrantGranted],
      [false, m.administratorsGrantAlreadyAdministrator],
    ] as const)(
      "confirms the grant (changed: %p) and clears the field",
      async (changed, message) => {
        const { input, view } = await submitGrant({
          data: { changed, email: grantedEmail },
        });

        expect(grantAdministrator.mock.calls[0]?.[0]).toEqual({
          email: grantedEmail,
        });
        await waitFor(() =>
          expect(view.getByRole("status").textContent).toBe(
            message({ email: grantedEmail }, { locale: "en-US" })
          )
        );
        expect(input.value).toBe("");
      }
    );

    test("shows the server's refusal as an error and keeps the address", async () => {
      const { input, view } = await submitGrant({
        serverError: "The account has no verified sign-in.",
      });

      await waitFor(() =>
        expect(view.getByRole("alert").textContent).toBe(
          "The account has no verified sign-in."
        )
      );
      expect(input.value).toBe(grantedEmail);
    });

    test("reports nothing and keeps the address when the action returns no result", async () => {
      const { input, view } = await submitGrant({});

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      expect(view.queryByRole("status")).toBeNull();
      expect(view.queryByRole("alert")).toBeNull();
      expect(input.value).toBe(grantedEmail);
    });
  });
});
