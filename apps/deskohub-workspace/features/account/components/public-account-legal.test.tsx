import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  mock,
  test,
} from "bun:test";
import { cleanup, render } from "@testing-library/react";
import { m } from "@/features/i18n";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";

mock.module("@/features/account/components/legal/legal-screen", () => ({
  LegalScreen: ({
    accountsEnabled,
    locale,
    marketingPreferences,
    strings,
  }: {
    readonly accountsEnabled?: boolean;
    readonly locale: string;
    readonly marketingPreferences?: { readonly status: string };
    readonly strings: { readonly title: string };
  }) => (
    <>
      <h2>{strings.title}</h2>
      <output data-testid="public-account-legal-accounts-enabled">
        {String(accountsEnabled)}
      </output>
      <output data-testid="public-account-legal-locale">{locale}</output>
      <output data-testid="public-account-marketing-preferences">
        {marketingPreferences?.status ?? "unavailable"}
      </output>
    </>
  ),
}));

const publicAccountLegalSource = await Bun.file(
  new URL("./public-account-legal.tsx", import.meta.url)
).text();

describe("PublicAccountLegal", () => {
  beforeAll(registerWorkspaceComponentTestEnv);

  afterEach(cleanup);

  afterAll(unregisterWorkspaceComponentTestEnv);

  test("renders the content-only legal screen without a duplicate account shell", () => {
    expect(publicAccountLegalSource).toContain(
      "readonly accountsEnabled: boolean"
    );
    expect(publicAccountLegalSource).toContain("readonly locale: Locale");
    expect(publicAccountLegalSource).toContain(
      "readonly marketingPreferences?: MarketingPreferencesState"
    );
    expect(publicAccountLegalSource).toContain(
      "accountsEnabled={accountsEnabled}"
    );
    expect(publicAccountLegalSource).toContain(
      "marketingPreferences={marketingPreferences}"
    );

    for (const forbiddenReference of [
      "AccountShell",
      "AccountSection",
      "SignOutButton",
      "useRouter",
      "onSectionChange",
      "signedIn",
    ]) {
      expect(publicAccountLegalSource).not.toContain(forbiddenReference);
    }
  });

  test.each(["en-US", "cs-CZ"] as const)(
    "renders localized legal content without navigation for %s",
    async (locale) => {
      const { PublicAccountLegal } = await import("./public-account-legal");
      const view = render(
        <PublicAccountLegal accountsEnabled={true} locale={locale} />
      );

      expect(
        view.getByRole("heading", {
          level: 2,
          name: m.accountLegalTitle({}, { locale }),
        })
      ).toBeTruthy();
      expect(view.getByTestId("public-account-legal-locale").textContent).toBe(
        locale
      );
      expect(view.container.querySelector("main")).toBeNull();
      expect(view.container.querySelector("nav")).toBeNull();
      expect(view.queryByRole("button", { name: /sign out/i })).toBeNull();
    }
  );

  test("forwards a disabled account flag to the legal screen", async () => {
    const { PublicAccountLegal } = await import("./public-account-legal");
    const view = render(
      <PublicAccountLegal accountsEnabled={false} locale="en-US" />
    );

    expect(
      view.getByTestId("public-account-legal-accounts-enabled").textContent
    ).toBe("false");
  });

  test("forwards rendered marketing preferences to the legal screen", async () => {
    const { PublicAccountLegal } = await import("./public-account-legal");
    const view = render(
      <PublicAccountLegal
        accountsEnabled={true}
        locale="en-US"
        marketingPreferences={{
          context: "synthetic-account-context",
          source: "account",
          status: "active",
        }}
      />
    );

    expect(
      view.getByTestId("public-account-marketing-preferences").textContent
    ).toBe("active");
  });
});
