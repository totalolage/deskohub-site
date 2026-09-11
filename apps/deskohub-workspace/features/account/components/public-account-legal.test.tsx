import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  mock,
  test,
} from "bun:test";
import { cleanup, fireEvent, render, within } from "@testing-library/react";
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
    marketingPreferences,
    strings,
  }: {
    readonly marketingPreferences?: {
      readonly status: string;
    };
    readonly strings: { readonly title: string };
  }) => (
    <>
      <h2>{strings.title}</h2>
      <output data-testid="public-account-marketing-preferences">
        {marketingPreferences?.status ?? "unavailable"}
      </output>
    </>
  ),
}));

function getDesktopSectionNavigation(view: {
  readonly container: HTMLElement;
}) {
  const navigation = view.container.querySelector<HTMLDivElement>("div.hidden");
  if (!navigation)
    throw new Error("Desktop account navigation was not rendered");
  return within(navigation);
}

function getMobileSectionNavigation(
  view: { readonly container: HTMLElement },
  locale: "en-US" | "cs-CZ"
) {
  return within(
    view.getByRole("group", {
      name: m.accountSectionLabel({}, { locale }),
    })
  );
}

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
      const mobileSectionNavigation = getMobileSectionNavigation(view, locale);
      const desktopSectionNavigation = getDesktopSectionNavigation(view);

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
          (
            mobileSectionNavigation.getByRole("button", {
              name: label,
            }) as HTMLButtonElement
          ).disabled
        ).toBe(true);
        expect(
          (
            desktopSectionNavigation.getByRole("button", {
              name: label,
            }) as HTMLButtonElement
          ).disabled
        ).toBe(true);

        fireEvent.click(
          mobileSectionNavigation.getByRole("button", { name: label })
        );
        fireEvent.click(
          desktopSectionNavigation.getByRole("button", { name: label })
        );
      }

      const legalLabel = m.accountSectionLegal({}, { locale });
      expect(
        (
          mobileSectionNavigation.getByRole("button", {
            name: legalLabel,
          }) as HTMLButtonElement
        ).disabled
      ).toBe(false);
      expect(
        (
          desktopSectionNavigation.getByRole("button", {
            name: legalLabel,
          }) as HTMLButtonElement
        ).disabled
      ).toBe(false);
      fireEvent.click(
        mobileSectionNavigation.getByRole("button", { name: legalLabel })
      );
      fireEvent.click(
        desktopSectionNavigation.getByRole("button", { name: legalLabel })
      );
      expect(workspaceRouterPush).not.toHaveBeenCalled();
    }
  );

  test("passes an optional marketing preference state to LegalScreen", async () => {
    const { PublicAccountLegal } = await import("./public-account-legal");
    const view = render(
      <PublicAccountLegal
        locale="en-US"
        marketingPreferences={{
          context: "synthetic-account-context",
          source: "account",
          status: "active",
        }}
        signedIn
      />
    );

    expect(
      view.getByTestId("public-account-marketing-preferences").textContent
    ).toBe("active");
  });

  test.each(["en-US", "cs-CZ"] as const)(
    "routes signed-in %s visitors to the private account sections",
    async (locale) => {
      const { PublicAccountLegal } = await import("./public-account-legal");
      const view = render(<PublicAccountLegal locale={locale} signedIn />);
      const mobileSectionNavigation = getMobileSectionNavigation(view, locale);
      const desktopSectionNavigation = getDesktopSectionNavigation(view);

      expect(
        view.getByRole("button", { name: m.accountSignOut({}, { locale }) })
      ).toBeTruthy();

      const sectionLabels = {
        billing: m.accountSectionBilling({}, { locale }),
        danger: m.accountSectionDanger({}, { locale }),
        legal: m.accountSectionLegal({}, { locale }),
        profile: m.accountSectionProfile({}, { locale }),
        reservations: m.accountSectionReservations({}, { locale }),
      } as const;
      for (const section of [
        "reservations",
        "profile",
        "billing",
        "legal",
        "danger",
      ] as const) {
        const label = sectionLabels[section];
        expect(
          (
            mobileSectionNavigation.getByRole("button", {
              name: label,
            }) as HTMLButtonElement
          ).disabled
        ).toBe(false);
        expect(
          (
            desktopSectionNavigation.getByRole("button", {
              name: label,
            }) as HTMLButtonElement
          ).disabled
        ).toBe(false);
      }

      fireEvent.click(
        mobileSectionNavigation.getByRole("button", {
          name: m.accountSectionProfile({}, { locale }),
        })
      );
      fireEvent.click(
        desktopSectionNavigation.getByRole("button", {
          name: m.accountSectionBilling({}, { locale }),
        })
      );

      expect(workspaceRouterPush.mock.calls).toEqual([
        [`/${locale}/account?section=profile`],
        [`/${locale}/account?section=billing`],
      ]);

      fireEvent.click(
        mobileSectionNavigation.getByRole("button", {
          name: m.accountSectionLegal({}, { locale }),
        })
      );
      fireEvent.click(
        desktopSectionNavigation.getByRole("button", {
          name: m.accountSectionLegal({}, { locale }),
        })
      );
      expect(workspaceRouterPush).toHaveBeenCalledTimes(2);
    }
  );
});
