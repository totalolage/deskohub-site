import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  mock,
  test,
} from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { m } from "@/features/i18n";
import { workspaceRouterPush } from "@/shared/testing/workspace-component-module-mocks";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";

mock.module("@/features/account/auth.client", () => ({
  authClient: {
    signOut: mock(() => Promise.resolve({ error: null })),
  },
}));

mock.module("@/features/account/components/legal/legal-screen", () => ({
  LegalScreen: ({
    strings,
  }: {
    readonly strings: { readonly title: string };
  }) => <h2>{strings.title}</h2>,
}));

describe("PublicAccountLegal", () => {
  beforeAll(registerWorkspaceComponentTestEnv);

  afterEach(() => {
    cleanup();
    workspaceRouterPush.mockClear();
  });

  afterAll(unregisterWorkspaceComponentTestEnv);

  test.each(["en-US", "cs-CZ"] as const)(
    "renders legal content for anonymous %s visitors without account access",
    async (locale) => {
      const { PublicAccountLegal } = await import("./public-account-legal");
      const view = render(
        <PublicAccountLegal locale={locale} signedIn={false} />
      );

      expect(
        view.getByRole("heading", {
          level: 1,
          name: m.accountTitle({}, { locale }),
        })
      ).toBeTruthy();
      expect(
        view.getByRole("heading", {
          level: 2,
          name: m.accountLegalTitle({}, { locale }),
        })
      ).toBeTruthy();
      expect(
        view.queryByRole("button", {
          name: m.accountSignOut({}, { locale }),
        })
      ).toBeNull();

      const sectionLabels = {
        billing: m.accountSectionBilling({}, { locale }),
        danger: m.accountSectionDanger({}, { locale }),
        profile: m.accountSectionProfile({}, { locale }),
        reservations: m.accountSectionReservations({}, { locale }),
      } as const;

      for (const section of [
        "reservations",
        "profile",
        "billing",
        "danger",
      ] as const) {
        const label = sectionLabels[section];
        expect(
          (view.getByRole("button", { name: label }) as HTMLButtonElement)
            .disabled
        ).toBe(true);
        expect(
          (view.getByRole("option", { name: label }) as HTMLOptionElement)
            .disabled
        ).toBe(true);
      }

      const legalLabel = m.accountSectionLegal({}, { locale });
      expect(
        (view.getByRole("button", { name: legalLabel }) as HTMLButtonElement)
          .disabled
      ).toBe(false);
      expect(workspaceRouterPush).not.toHaveBeenCalled();
    }
  );

  test.each(["en-US", "cs-CZ"] as const)(
    "routes signed-in %s visitors to the private account sections",
    async (locale) => {
      const { PublicAccountLegal } = await import("./public-account-legal");
      const view = render(<PublicAccountLegal locale={locale} signedIn />);

      expect(
        view.getByRole("button", { name: m.accountSignOut({}, { locale }) })
      ).toBeTruthy();

      fireEvent.click(
        view.getByRole("button", {
          name: m.accountSectionProfile({}, { locale }),
        })
      );
      fireEvent.change(
        view.getByRole("combobox", {
          name: m.accountSectionLabel({}, { locale }),
        }),
        { target: { value: "billing" } }
      );

      expect(workspaceRouterPush.mock.calls).toEqual([
        [`/${locale}/account?section=profile`],
        [`/${locale}/account?section=billing`],
      ]);

      fireEvent.click(
        view.getByRole("button", {
          name: m.accountSectionLegal({}, { locale }),
        })
      );
      expect(workspaceRouterPush).toHaveBeenCalledTimes(2);
    }
  );
});
