import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  expect,
  mock,
  test,
} from "bun:test";
import { cleanup, render } from "@testing-library/react";
import type { ComponentProps, ReactNode } from "react";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";

type CapturedLink = {
  readonly href: string;
  readonly prefetch: boolean | null | undefined;
};

type CapturedLogo = {
  readonly alt: string | undefined;
  readonly height: number | undefined;
  readonly styling: {
    readonly color: string;
    readonly variant: string;
  };
};

const capturedLinks: CapturedLink[] = [];
const capturedGuardedLinkHrefs: string[] = [];
const capturedLogos: CapturedLogo[] = [];
let currentPathname = "/en-US";

mock.module("next/link", () => ({
  default: ({
    children,
    href,
    prefetch,
    scroll: _scroll,
    ...props
  }: Omit<ComponentProps<"a">, "href"> & {
    readonly children?: ReactNode;
    readonly href: string | URL;
    readonly prefetch?: boolean | null;
    readonly scroll?: boolean;
  }) => {
    const stringHref = href.toString();
    capturedLinks.push({ href: stringHref, prefetch });

    return (
      <a href={stringHref} {...props}>
        {children}
      </a>
    );
  },
}));

mock.module("@/shared/components/guarded-link", () => ({
  GuardedLink: ({
    children,
    href,
    prefetch: _prefetch,
    ...props
  }: Omit<ComponentProps<"a">, "href"> & {
    readonly href: string | URL;
    readonly prefetch?: boolean | "auto" | null;
  }) => {
    const stringHref = href.toString();
    capturedGuardedLinkHrefs.push(stringHref);

    return (
      <a href={stringHref} {...props}>
        {children}
      </a>
    );
  },
}));

mock.module("next/navigation", () => ({
  usePathname: () => currentPathname,
  useSearchParams: () => new URLSearchParams(),
}));

mock.module("@/shared/components/logo", () => ({
  HorizontalLogo: () => (
    <span data-testid="horizontal-logo">Deskohub Workspace</span>
  ),
  Logo: ({
    alt,
    height,
    styling,
  }: {
    readonly alt?: string;
    readonly height?: number;
    readonly styling: CapturedLogo["styling"];
  }) => {
    capturedLogos.push({ alt, height, styling });
    return <span data-testid="small-logo" />;
  },
}));

beforeAll(() => {
  registerWorkspaceComponentTestEnv();
});

beforeEach(() => {
  capturedLinks.length = 0;
  capturedGuardedLinkHrefs.length = 0;
  capturedLogos.length = 0;
  currentPathname = "/en-US";
});

afterEach(() => {
  cleanup();
});

afterAll(() => {
  unregisterWorkspaceComponentTestEnv();
});

test("reserves both language labels before request-aware links resolve", async () => {
  const { LocaleSwitcherLabels } = await import("./locale-switcher-links");
  const view = render(
    <LocaleSwitcherLabels
      currentLocale="en-US"
      languageLabels={{ "cs-CZ": "Czech", "en-US": "English" }}
    />
  );

  expect(view.getByText("English").tagName).toBe("STRONG");
  expect(view.getByText("Czech").tagName).toBe("SPAN");
  expect(view.container.querySelectorAll("a")).toHaveLength(0);
});

test("uses document navigation for every alternate-locale full-header link", async () => {
  const { SiteHeader } = await import("./site-header");

  for (const { alternateHref, contactHref, currentLocale, pathname } of [
    {
      alternateHref: "/cs-CZ",
      contactHref: "/en-US/contact",
      currentLocale: "en-US",
      pathname: "/en-US",
    },
    {
      alternateHref: "/en-US",
      contactHref: "/cs-CZ/contact",
      currentLocale: "cs-CZ",
      pathname: "/cs-CZ",
    },
  ] as const) {
    currentPathname = pathname;
    capturedLinks.length = 0;
    const view = render(
      <SiteHeader
        accountHref={`/${currentLocale}/account`}
        accountLabel="Account"
        contactHref={contactHref}
        contactLabel="Contact"
        currentLocale={currentLocale}
        languageLabels={{ "cs-CZ": "Czech", "en-US": "English" }}
        links={[]}
      />
    );

    expect(
      view.container.querySelectorAll(`a[href="${alternateHref}"]`)
    ).toHaveLength(2);
    expect(capturedLinks.filter(({ href }) => href === alternateHref)).toEqual(
      []
    );
    expect(
      view.container.querySelectorAll(`a[href="/${currentLocale}/account"]`)
    ).toHaveLength(2);
    view.unmount();
  }
});

test("renders only the configured full-header items without reserved slots", async () => {
  const { SiteHeader } = await import("./site-header");
  const galleryHref = "/en-US/gallery";
  const view = render(
    <SiteHeader
      accountHref="/en-US/account"
      accountLabel="Account"
      closeNavigationMenuLabel="Close navigation menu"
      contactHref="/en-US/reservation/cowork"
      contactLabel="Book"
      currentLocale="en-US"
      languageSwitcherLabel="Language switcher"
      languageLabels={{ "cs-CZ": "Czech", "en-US": "English" }}
      links={[
        {
          id: "gallery",
          href: galleryHref,
          label: "Gallery",
        },
      ]}
      mobilePrimaryNavigationLabel="Mobile primary navigation"
      openNavigationMenuLabel="Open navigation menu"
      primaryNavigationLabel="Primary navigation"
    />
  );

  const desktopNavigation = view.container.querySelector(
    'nav[aria-label="Primary navigation"]'
  );
  expect(desktopNavigation?.getAttribute("class")).toContain("gap-6");
  expect(desktopNavigation?.getAttribute("class")).toContain("xl:flex");
  expect(desktopNavigation?.getAttribute("class")).not.toContain("grid");
  expect(
    desktopNavigation
      ?.querySelector(`a[href="${galleryHref}"]`)
      ?.getAttribute("class")
  ).not.toContain("col-start");
  expect(capturedGuardedLinkHrefs).toEqual([
    "/en-US",
    galleryHref,
    "/en-US/account",
    "/en-US/reservation/cowork",
    "/en-US/account",
    galleryHref,
  ]);
});

test("keeps the full-header home link compact and controls usable on mobile", async () => {
  const { SiteHeader } = await import("./site-header");
  const view = render(
    <SiteHeader
      accountHref="/en-US/account"
      accountLabel="Account"
      closeNavigationMenuLabel="Close navigation menu"
      contactHref="/en-US/reservation/cowork"
      contactLabel="Get access"
      currentLocale="en-US"
      languageSwitcherLabel="Language switcher"
      languageLabels={{ "cs-CZ": "Czech", "en-US": "English" }}
      links={[]}
      mobilePrimaryNavigationLabel="Mobile primary navigation"
      openNavigationMenuLabel="Open navigation menu"
      primaryNavigationLabel="Primary navigation"
    />
  );

  const header = view.container.querySelector("header");
  const headerInner = header?.firstElementChild;
  const homeLink = view.getByRole("link", { name: "Deskohub Workspace" });
  const smallLogo = homeLink.querySelector('[data-testid="small-logo"]');
  const horizontalLogo = homeLink.querySelector(
    '[data-testid="horizontal-logo"]'
  );
  const accountLink = view.container.querySelector('a[href="/en-US/account"]');
  const actionGroup = accountLink?.parentElement;
  const contactLink = view.getByRole("link", { name: "Get access" });
  const menuButton = view.getByRole("button", {
    name: "Open navigation menu",
  });

  expect(header?.className).toContain("h-(--site-header-height)");
  expect(headerInner?.className).toContain("gap-3");
  expect(headerInner?.className).toContain("sm:gap-4");
  expect(headerInner?.className).toContain("px-3");
  expect(headerInner?.className).toContain("sm:px-6");
  expect(headerInner?.className).toContain("lg:px-8");
  expect(homeLink.getAttribute("aria-label")).toBe("Deskohub Workspace");
  expect(smallLogo?.parentElement?.className).toBe("block sm:hidden");
  expect(horizontalLogo?.parentElement?.className).toBe("hidden sm:block");
  expect(capturedLogos).toEqual([
    {
      alt: "",
      height: 48,
      styling: { color: "dark", variant: "color" },
    },
  ]);
  expect(actionGroup?.className).toContain("shrink-0");
  expect(accountLink?.className).toContain("size-10");
  expect(contactLink.className).toContain("whitespace-nowrap");
  expect(contactLink.className).toContain("shrink-0");
  expect(menuButton.className).toContain("h-10");
  expect(menuButton.className).toContain("w-10");
});

test("uses document navigation for the alternate-locale minimal-header link", async () => {
  const { MinimalSiteHeader } = await import("./minimal-site-header");

  for (const { alternateHref, currentLocale, pathname } of [
    {
      alternateHref: "/cs-CZ",
      currentLocale: "en-US",
      pathname: "/en-US",
    },
    {
      alternateHref: "/en-US",
      currentLocale: "cs-CZ",
      pathname: "/cs-CZ",
    },
  ] as const) {
    currentPathname = pathname;
    capturedLinks.length = 0;
    const view = render(
      <MinimalSiteHeader
        currentLocale={currentLocale}
        languageLabels={{ "cs-CZ": "Czech", "en-US": "English" }}
      />
    );

    expect(
      view.container.querySelectorAll(`a[href="${alternateHref}"]`)
    ).toHaveLength(1);
    expect(capturedLinks.filter(({ href }) => href === alternateHref)).toEqual(
      []
    );
    expect(capturedLinks).toContainEqual({
      href: `/${currentLocale}`,
      prefetch: false,
    });
    view.unmount();
  }
});
