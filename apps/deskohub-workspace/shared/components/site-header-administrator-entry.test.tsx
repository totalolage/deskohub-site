import { afterAll, afterEach, beforeAll, expect, mock, test } from "bun:test";
import {
  act,
  cleanup,
  type RenderResult,
  render,
} from "@testing-library/react";
import type { ComponentProps } from "react";
import { m } from "@/features/i18n";
import type { SiteHeaderAdministratorEntry } from "@/shared/components/site-header-config";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";

mock.module("@/shared/components/guarded-link", () => ({
  GuardedLink: ({
    href,
    prefetch: _prefetch,
    ...props
  }: Omit<ComponentProps<"a">, "href"> & {
    readonly href: string | URL;
    readonly prefetch?: boolean | "auto" | null;
  }) => <a href={href.toString()} {...props} />,
}));

// Keeps the real exports: the mock replaces the module for the whole run.
const navigation = await import("next/navigation");
mock.module("next/navigation", () => ({
  ...navigation,
  usePathname: () => "/cs-CZ",
  useSearchParams: () => new URLSearchParams(),
}));

mock.module("@/shared/components/logo", () => ({
  HorizontalLogo: () => <span />,
  Logo: () => <span />,
}));

const locale = "cs-CZ";

const administratorEntry = (
  visible: Promise<boolean>
): SiteHeaderAdministratorEntry => ({
  visible,
  href: `/${locale}/admin`,
  label: m.siteHeaderAdminLabel({}, { locale }),
});

const siteHeaderProps = {
  closeNavigationMenuLabel: "Close navigation menu",
  contactHref: `/${locale}/reservation/cowork`,
  contactLabel: "Book",
  currentLocale: locale,
  languageLabels: { "cs-CZ": "Czech", "en-US": "English" },
  languageSwitcherLabel: "Language switcher",
  links: [],
  mobilePrimaryNavigationLabel: "Mobile primary navigation",
  openNavigationMenuLabel: "Open navigation menu",
  primaryNavigationLabel: "Primary navigation",
} as const;

const renderSiteHeader = async (
  administrator?: SiteHeaderAdministratorEntry
) => {
  const { SiteHeader } = await import("./site-header");
  let view!: RenderResult;
  await act(async () => {
    view = render(
      <SiteHeader {...siteHeaderProps} administrator={administrator} />
    );
    // Lets a settled check reveal the entry; a pending one stays pending.
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return view;
};

const adminLinks = (view: RenderResult) =>
  view.container.querySelectorAll(`a[href="/${locale}/admin"]`);

beforeAll(() => {
  registerWorkspaceComponentTestEnv();
});

afterEach(() => {
  cleanup();
});

afterAll(() => {
  unregisterWorkspaceComponentTestEnv();
});

test("shows an administrator the header button and the menu button", async () => {
  const view = await renderSiteHeader(
    administratorEntry(Promise.resolve(true))
  );

  expect(adminLinks(view)).toHaveLength(2);
  expect(view.getAllByRole("link", { name: "Admin" })).toHaveLength(2);
});

test("shows a customer who is not an administrator no admin entry", async () => {
  const view = await renderSiteHeader(
    administratorEntry(Promise.resolve(false))
  );

  expect(adminLinks(view)).toHaveLength(0);
});

test("shows no admin entry while the administrator check is pending", async () => {
  const view = await renderSiteHeader(
    administratorEntry(new Promise<boolean>(() => {}))
  );

  expect(adminLinks(view)).toHaveLength(0);
});

test("shows no admin entry in a header without accounts", async () => {
  const view = await renderSiteHeader();

  expect(adminLinks(view)).toHaveLength(0);
});
