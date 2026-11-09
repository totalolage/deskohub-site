import { afterAll, afterEach, beforeAll, expect, mock, test } from "bun:test";
import {
  act,
  cleanup,
  fireEvent,
  render,
  waitFor,
  within,
} from "@testing-library/react";
import type { ReactNode } from "react";
import type { Locale } from "@/features/i18n";
import { RouteLocaleProvider } from "@/features/i18n/route-locale";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";

let currentPathname = "/en-US/admin";

mock.module("next/navigation", () => ({
  usePathname: () => currentPathname,
  useSearchParams: () => new URLSearchParams("status=paid"),
}));

beforeAll(() => {
  registerWorkspaceComponentTestEnv();
});

afterEach(() => {
  cleanup();
});

afterAll(async () => {
  await unregisterWorkspaceComponentTestEnv();
});

// The root layout provides the locale of the current route.
const renderInRoute = (ui: ReactNode) =>
  render(
    <RouteLocaleProvider locale={currentPathname.split("/")[1] as Locale}>
      {ui}
    </RouteLocaleProvider>
  );

const renderShell = async (pathname: string) => {
  currentPathname = pathname;
  const { AdminShell } = await import("./admin-shell");
  const { AdministrationLocaleSwitcher } = await import(
    "./administration-locale-switcher"
  );
  return renderInRoute(
    <AdminShell
      breadcrumb={null}
      localeSwitcher={<AdministrationLocaleSwitcher />}
    >
      <main id="main-content">Page</main>
    </AdminShell>
  );
};

// Each navigation section as its heading and its links' labels and hrefs.
const navigationSections = (navigation: HTMLElement) =>
  within(navigation)
    .getAllByRole("list")
    .map((list) => [
      document.getElementById(list.getAttribute("aria-labelledby") ?? "")
        ?.textContent,
      within(list)
        .getAllByRole("link")
        .map((link) => [link.textContent, link.getAttribute("href")]),
    ]);

test("groups the navigation into sections in both locales", async () => {
  const czech = await renderShell("/cs-CZ/admin/cli/sessions");
  const czechSections = [
    [
      "Provoz",
      [
        ["Přehled", "/cs-CZ/admin"],
        ["Rezervace", "/cs-CZ/admin/reservations"],
        ["Zákazníci", "/cs-CZ/admin/customers"],
      ],
    ],
    [
      "Slevy",
      [
        ["Kódy", "/cs-CZ/admin/codes"],
        ["Poukazy", "/cs-CZ/admin/vouchers"],
        ["Akce", "/cs-CZ/admin/sales"],
      ],
    ],
    [
      "E-mail",
      [
        ["Kampaně", "/cs-CZ/admin/email-campaigns"],
        ["Okruhy příjemců", "/cs-CZ/admin/email-audiences"],
      ],
    ],
    [
      "Administrace",
      [
        ["Faktury", "/cs-CZ/admin/invoices"],
        ["Přístupové kódy", "/cs-CZ/admin/access-codes"],
        ["Administrátoři", "/cs-CZ/admin/administrators"],
        ["Relace CLI", "/cs-CZ/admin/cli/sessions"],
      ],
    ],
  ];
  const desktop = czech.getByRole("navigation", { name: "Administrace" });

  expect(navigationSections(desktop)).toEqual(czechSections);
  expect(
    within(desktop)
      .getByRole("list", { name: "Administrace" })
      .querySelector('[aria-current="page"]')?.textContent
  ).toBe("Relace CLI");

  fireEvent.click(czech.getByRole("button", { name: "Otevřít navigaci" }));
  const sheet = await czech.findByRole("dialog");

  expect(
    navigationSections(
      within(sheet).getByRole("navigation", { name: "Administrace" })
    )
  ).toEqual(czechSections);
  cleanup();

  const english = await renderShell("/en-US/admin/sales");
  const englishNavigation = english.getByRole("navigation", {
    name: "Administration",
  });

  expect(navigationSections(englishNavigation)).toEqual([
    [
      "Operations",
      [
        ["Overview", "/en-US/admin"],
        ["Reservations", "/en-US/admin/reservations"],
        ["Customers", "/en-US/admin/customers"],
      ],
    ],
    [
      "Discounts",
      [
        ["Codes", "/en-US/admin/codes"],
        ["Vouchers", "/en-US/admin/vouchers"],
        ["Sales", "/en-US/admin/sales"],
      ],
    ],
    [
      "Email",
      [
        ["Campaigns", "/en-US/admin/email-campaigns"],
        ["Audiences", "/en-US/admin/email-audiences"],
      ],
    ],
    [
      "Administration",
      [
        ["Invoices", "/en-US/admin/invoices"],
        ["Access codes", "/en-US/admin/access-codes"],
        ["Administrators", "/en-US/admin/administrators"],
        ["CLI sessions", "/en-US/admin/cli/sessions"],
      ],
    ],
  ]);
  expect(
    within(englishNavigation)
      .getByRole("list", { name: "Discounts" })
      .querySelector('[aria-current="page"]')?.textContent
  ).toBe("Sales");
});

test("renders the shell in the route locale with localized navigation", async () => {
  const view = await renderShell("/cs-CZ/admin/reservations/reservation-id");
  const navigation = view.getByRole("navigation", { name: "Administrace" });

  expect(
    within(navigation)
      .getByRole("link", { name: "Rezervace" })
      .getAttribute("href")
  ).toBe("/cs-CZ/admin/reservations");
  expect(
    within(navigation)
      .getByRole("link", { name: "Rezervace" })
      .getAttribute("aria-current")
  ).toBe("page");
  expect(
    within(navigation)
      .getByRole("link", { name: "Přehled" })
      .hasAttribute("aria-current")
  ).toBe(false);
  view.getByText("Provoz");
  view.getByRole("link", { name: "Přejít na hlavní obsah" });
  expect(view.getAllByText("Administrace Workspace")).not.toHaveLength(0);
  view.getByRole("button", { name: "Otevřít navigaci" });
});

test("renders English copy on English administration routes", async () => {
  const view = await renderShell("/en-US/admin");
  const navigation = view.getByRole("navigation", { name: "Administration" });

  expect(
    within(navigation)
      .getByRole("link", { name: "Overview" })
      .getAttribute("aria-current")
  ).toBe("page");
  expect(
    within(navigation)
      .getByRole("link", { name: "CLI sessions" })
      .getAttribute("href")
  ).toBe("/en-US/admin/cli/sessions");
});

test("switches the current administration page to the other locale", async () => {
  const view = await renderShell("/cs-CZ/admin/reservations");
  const switcher = view.getByRole("navigation", {
    name: "Jazyk administrace",
  });

  expect(
    within(switcher).getByText("Čeština").getAttribute("aria-current")
  ).toBe("true");
  expect(
    within(switcher)
      .getByRole("link", { name: "Angličtina" })
      .getAttribute("href")
  ).toBe("/en-US/admin/reservations?status=paid");
});

test("a signed-in switch saves the preference before navigating", async () => {
  currentPathname = "/en-US/admin/codes";
  window.location.href = "http://localhost/en-US/admin/codes";
  const saves: { readonly locale: string }[] = [];
  const signedIn = Promise.resolve(true);
  const { AdministrationLocaleSwitcher } = await import(
    "./administration-locale-switcher"
  );
  const view = renderInRoute(
    <AdministrationLocaleSwitcher
      localePreference={{
        signedIn,
        save: async (input) => {
          saves.push(input);
        },
      }}
    />
  );
  await act(() => signedIn);

  fireEvent.click(view.getByRole("link", { name: "Czech" }));

  await waitFor(() => expect(saves).toEqual([{ locale: "cs-CZ" }]));
  await waitFor(() =>
    expect(window.location.pathname).toBe("/cs-CZ/admin/codes")
  );
});

test("labels and links breadcrumbs in the route locale", async () => {
  currentPathname = "/cs-CZ/admin/reservations/reservation-id";
  const { AdministrationBreadcrumbs } = await import("./admin-shell");
  const view = renderInRoute(
    <AdministrationBreadcrumbs segments={["reservations", "reservation-id"]} />
  );
  const breadcrumbs = view.getByRole("navigation", {
    name: "Drobečková navigace",
  });

  expect(
    within(breadcrumbs)
      .getByRole("link", { name: "Přehled" })
      .getAttribute("href")
  ).toBe("/cs-CZ/admin");
  expect(
    within(breadcrumbs)
      .getByRole("link", { name: "Rezervace" })
      .getAttribute("href")
  ).toBe("/cs-CZ/admin/reservations");
  expect(within(breadcrumbs).getAllByText("Rezervace")).toHaveLength(2);
});
