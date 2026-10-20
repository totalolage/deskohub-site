import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { type Browser, chromium, type Page } from "@playwright/test";
import { type Locale, locales, m } from "@/features/i18n";
import { browserModuleStubPlugin } from "@/shared/testing/browser-module-stubs.test-utils";
import { playwrightChromiumAvailable } from "@/shared/testing/playwright-browser";
import { compileWorkspaceAppStyles } from "@/shared/testing/workspace-app-styles.test-utils";

const appDirectory = resolve(import.meta.dir, "../..");
const mobileViewport = { height: 812, width: 375 } as const;
const desktopViewport = { height: 900, width: 1440 } as const;
const narrowDesktopViewport = { height: 800, width: 1280 } as const;
const shortMobileViewport = { height: 600, width: 375 } as const;
// The narrowest supported phone up to the largest common one.
const phoneWidths = [320, 390, 430] as const;
// Small laptops, the `xl` breakpoint where the full header adds its desktop
// navigation and language switcher, and a common desktop.
const desktopWidths = [1024, 1280, 1440] as const;
const headerVariants = ["full", "minimal"] as const;
type HeaderVariant = (typeof headerVariants)[number];
type AccountSession = "signed-in" | "signed-out";
const desktopHeaders = [
  {
    name: "full header signed out",
    variant: "full",
    session: "signed-out",
    administrator: false,
  },
  {
    name: "full header on the signed-in account page",
    variant: "full",
    session: "signed-in",
    administrator: false,
  },
  {
    name: "full header for an administrator on the account page",
    variant: "full",
    session: "signed-in",
    administrator: true,
  },
  {
    name: "minimal header",
    variant: "minimal",
    session: "signed-out",
    administrator: false,
  },
] as const satisfies readonly {
  readonly administrator: boolean;
  readonly name: string;
  readonly session: AccountSession;
  readonly variant: HeaderVariant;
}[];
const harnessOrigin = "http://site-header.test";

// The harness runs outside a Next.js app, so the router-bound modules render
// plain elements.
const nextModuleStubs: Readonly<Record<string, string>> = {
  "next/image": `
    import { createElement } from "react";
    export default function Image({ src, alt, width, height, priority: _priority, ...props }) {
      return createElement("img", { ...props, alt, height, src, width });
    }
  `,
  "next/link": `
    import { createElement } from "react";
    export default function Link({ href, onNavigate: _onNavigate, prefetch: _prefetch, scroll: _scroll, ...props }) {
      return createElement("a", { ...props, href: String(href) });
    }
  `,
  "next/navigation": `
    export const usePathname = () => window.location.pathname;
    export const useSearchParams = () => new URLSearchParams();
  `,
};

// Static image imports keep their real dimensions.
const svgImagePlugin: Bun.BunPlugin = {
  name: "site-header-svg-images",
  setup(build) {
    build.onLoad({ filter: /\.svg$/ }, async (args) => {
      const svg = await readFile(args.path, "utf8");
      const viewBox = /viewBox="[\d.]+ [\d.]+ ([\d.]+) ([\d.]+)"/.exec(svg);
      if (!viewBox) throw new Error(`${args.path} has no viewBox.`);
      return {
        contents: `export default ${JSON.stringify({
          height: Number(viewBox[2]),
          src: `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`,
          width: Number(viewBox[1]),
        })};`,
        loader: "js",
      };
    });
  },
};

const chromiumAvailable = await playwrightChromiumAvailable();
let browser: Browser | undefined;
let buildDirectory = "";
let browserBundlePath = "";
let appStyles = "";

beforeAll(async () => {
  if (!chromiumAvailable) return;
  buildDirectory = await mkdtemp(join(tmpdir(), "site-header-browser-"));
  const build = await Bun.build({
    entrypoints: [join(import.meta.dir, "site-header.browser-harness.tsx")],
    format: "iife",
    minify: true,
    naming: "site-header-harness.js",
    outdir: buildDirectory,
    plugins: [browserModuleStubPlugin(nextModuleStubs), svgImagePlugin],
    target: "browser",
  });
  if (!build.success) {
    throw new Error(build.logs.map(({ message }) => message).join("\n"));
  }
  browserBundlePath = join(buildDirectory, "site-header-harness.js");

  const brandFont = await readFile(
    join(appDirectory, "assets/fonts/Sculpin/regular.woff2")
  );
  // Production text widths come from the brand font that next/font injects.
  appStyles = `@font-face { font-family: "Sculpin"; font-weight: 400; src: url(data:font/woff2;base64,${brandFont.toString("base64")}) format("woff2"); }
:root { --font-sculpin: "Sculpin"; }
${await compileWorkspaceAppStyles()}`;

  // Desktop cases need classic scrollbars, which headless Chromium hides.
  browser = await chromium.launch({
    headless: true,
    ignoreDefaultArgs: ["--hide-scrollbars"],
  });
});

afterAll(async () => {
  await browser?.close();
  if (buildDirectory)
    await rm(buildDirectory, { force: true, recursive: true });
});

type SiteHeaderPageOptions = {
  // A signed-in administrator also gets the admin entry.
  readonly administrator?: boolean;
  // A long desktop page reserves a classic scrollbar, so the header is
  // narrower than the media queries' viewport width.
  readonly scrollbar?: boolean;
  // A signed-in customer is shown on their account page, where the header
  // marks the account link as the current page.
  readonly session?: AccountSession;
  readonly variant?: HeaderVariant;
};

const openSiteHeader = async (
  locale: Locale,
  viewport: { readonly height: number; readonly width: number },
  {
    administrator = false,
    scrollbar = false,
    session = "signed-out",
    variant = "full",
  }: SiteHeaderPageOptions = {}
) => {
  if (!browser) throw new Error("The SiteHeader browser has not launched.");
  const page = await browser.newPage({ reducedMotion: "reduce", viewport });
  // The header reads the current page from the URL, so the harness is served
  // at the page it stands in for.
  await page.route(`${harnessOrigin}/**`, (route) =>
    route.fulfill({
      body: `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="site-header-test-root" data-locale="${locale}" data-administrator="${administrator}" data-session="${session}" data-variant="${variant}"></div></body></html>`,
      contentType: "text/html",
    })
  );
  await page.goto(
    `${harnessOrigin}/${locale}${session === "signed-in" ? "/account" : ""}`
  );
  await page.addStyleTag({ content: appStyles });
  if (scrollbar) {
    await page.addStyleTag({ content: "html { overflow-y: scroll; }" });
  }
  await page.addScriptTag({ path: browserBundlePath });
  await page.getByRole("banner").waitFor();
  if (administrator) {
    // The mobile layouts hide both admin links until the menu opens.
    await page
      .locator(`a[href="/${locale}/admin"]`)
      .first()
      .waitFor({ state: "attached" });
  }
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(
      Array.from(document.images, (image) => image.decode().catch(() => {}))
    );
  });
  return page;
};

// The header is fixed, so its overflow would not widen the document; every
// rendered header element has to fit inside the viewport, which excludes a
// classic scrollbar, instead. A squeezed desktop row pushes its controls into
// its padding before they leave the viewport, so desktop checks keep them
// inside the padding too.
const readHorizontalOverflow = (page: Page) =>
  page.evaluate(() => {
    const viewportWidth = document.documentElement.clientWidth;
    const header = document.querySelector("header");
    const row = header?.firstElementChild;
    if (!(header && row)) throw new Error("The site header is missing.");
    const rowStyle = getComputedStyle(row);
    const rowRect = row.getBoundingClientRect();
    const rowContentLeft =
      rowRect.left + Number.parseFloat(rowStyle.paddingLeft);
    const rowContentRight =
      rowRect.right - Number.parseFloat(rowStyle.paddingRight);
    const overflowingElements = (
      elements: Iterable<Element>,
      left: number,
      right: number
    ) =>
      Array.from(elements)
        .filter((element) =>
          element.checkVisibility({ visibilityProperty: true })
        )
        .filter((element) => {
          const rect = element.getBoundingClientRect();
          return (
            rect.width > 0 && (rect.left < left - 1 || rect.right > right + 1)
          );
        })
        .map((element) => element.outerHTML.slice(0, 120));
    return {
      documentOverflow:
        document.documentElement.scrollWidth - window.innerWidth,
      outsideRowPadding: overflowingElements(
        row.querySelectorAll("*"),
        rowContentLeft,
        rowContentRight
      ),
      outsideViewport: overflowingElements(
        [header, ...header.querySelectorAll("*")],
        0,
        viewportWidth
      ),
    };
  });

const expectNoHorizontalOverflow = async (
  page: Page,
  { insideRowPadding = false } = {}
) => {
  const overflow = await readHorizontalOverflow(page);
  expect(overflow.outsideViewport).toEqual([]);
  if (insideRowPadding) expect(overflow.outsideRowPadding).toEqual([]);
  expect(overflow.documentOverflow).toBeLessThanOrEqual(1);
};

// Each desktop navigation label has to stay on one line.
const readWrappedNavigationLabels = (page: Page, navigationLabel: string) =>
  page.evaluate((navigationLabel) => {
    const navigation = document.querySelector(
      `nav[aria-label="${navigationLabel}"]`
    );
    if (!navigation) throw new Error("The primary navigation is missing.");
    return Array.from(navigation.querySelectorAll("a"))
      .filter(
        (link) =>
          link.getBoundingClientRect().height >
          Number.parseFloat(getComputedStyle(link).lineHeight) * 1.5
      )
      .map((link) => link.textContent);
  }, navigationLabel);

// The horizontal logo's resolved zoom and its box against the home link's.
const readHorizontalLogoLayout = (page: Page) =>
  page.evaluate(() => {
    const link = document.querySelector(
      'header a[aria-label="Deskohub Workspace"]'
    );
    const logo = link?.querySelector(":scope > span:last-child > div");
    if (!(link && logo instanceof HTMLElement)) {
      throw new Error("The horizontal site header logo is missing.");
    }
    const linkBox = link.getBoundingClientRect();
    const logoBox = logo.getBoundingClientRect();
    return {
      linkLeft: linkBox.left,
      linkWidth: linkBox.width,
      logoLeft: logoBox.left,
      logoWidth: logoBox.width,
      zoom: getComputedStyle(logo).zoom,
    };
  });

const readHeaderHeights = (page: Page) =>
  page.evaluate(() => {
    const header = document.querySelector("header");
    if (!header) throw new Error("The site header is missing.");
    const probe = document.createElement("div");
    probe.style.height = "var(--site-header-height)";
    document.body.append(probe);
    const variable = probe.getBoundingClientRect().height;
    probe.remove();
    return { header: header.getBoundingClientRect().height, variable };
  });

for (const locale of locales) {
  for (const variant of headerVariants) {
    for (const width of phoneWidths) {
      test.skipIf(!chromiumAvailable)(
        `fits the ${variant} header on a ${width}px phone (${locale})`,
        async () => {
          const page = await openSiteHeader(
            locale,
            { height: 844, width },
            { variant }
          );
          try {
            await expectNoHorizontalOverflow(page);
          } finally {
            await page.close();
          }
        }
      );
    }
  }

  for (const { administrator, name, session, variant } of desktopHeaders) {
    for (const width of desktopWidths) {
      test.skipIf(!chromiumAvailable)(
        `fits the ${name} on a ${width}px desktop with a scrollbar (${locale})`,
        async () => {
          const page = await openSiteHeader(
            locale,
            { height: 900, width },
            { administrator, scrollbar: true, session, variant }
          );
          try {
            if (session === "signed-in") {
              // The mobile menu's copy has a visible label instead.
              const currentPageLink = page.locator(
                'header a[aria-current="page"][aria-label]'
              );
              await currentPageLink.waitFor();
              expect(await currentPageLink.getAttribute("aria-label")).toBe(
                m.accountNavLabel({}, { locale })
              );
            }
            if (administrator) {
              expect(
                await page
                  .getByRole("link", {
                    exact: true,
                    name: m.siteHeaderAdminLabel({}, { locale }),
                  })
                  .first()
                  .isVisible()
              ).toBe(true);
            }
            await expectNoHorizontalOverflow(page, { insideRowPadding: true });
          } finally {
            await page.close();
          }
        }
      );
    }
  }

  test.skipIf(!chromiumAvailable)(
    `shows the primary navigation without a menu button on desktop (${locale})`,
    async () => {
      const page = await openSiteHeader(locale, desktopViewport);
      try {
        await expectNoHorizontalOverflow(page, { insideRowPadding: true });
        expect(
          await page
            .getByRole("navigation", {
              exact: true,
              name: m.primaryNavigationLabel({}, { locale }),
            })
            .isVisible()
        ).toBe(true);
        expect(
          await page
            .getByRole("button", {
              exact: true,
              name: m.openNavigationMenuLabel({}, { locale }),
            })
            .isVisible()
        ).toBe(false);
      } finally {
        await page.close();
      }
    }
  );

  test.skipIf(!chromiumAvailable)(
    `fits the mobile header and toggles the menu it controls (${locale})`,
    async () => {
      const page = await openSiteHeader(locale, mobileViewport);
      try {
        const primaryNavigation = page.getByRole("navigation", {
          exact: true,
          name: m.primaryNavigationLabel({}, { locale }),
        });
        const mobileNavigation = page.getByRole("navigation", {
          exact: true,
          name: m.mobilePrimaryNavigationLabel({}, { locale }),
        });
        const menuButton = page.getByRole("button", {
          exact: true,
          name: m.openNavigationMenuLabel({}, { locale }),
        });

        await expectNoHorizontalOverflow(page);
        expect(await primaryNavigation.isVisible()).toBe(false);
        expect(await menuButton.isVisible()).toBe(true);
        expect(await menuButton.getAttribute("aria-expanded")).toBe("false");
        expect(await mobileNavigation.isVisible()).toBe(false);

        const controlledId = await menuButton.getAttribute("aria-controls");
        expect(controlledId).toBeTruthy();
        const controlledMenu = page.locator(`[id="${controlledId}"]`);
        expect(await controlledMenu.count()).toBe(1);

        await menuButton.click();
        const closeButton = page.getByRole("button", {
          exact: true,
          name: m.closeNavigationMenuLabel({}, { locale }),
        });
        await closeButton.waitFor();
        expect(await closeButton.getAttribute("aria-expanded")).toBe("true");
        expect(await closeButton.getAttribute("aria-controls")).toBe(
          controlledId
        );
        await controlledMenu.getByRole("navigation").waitFor();
        expect(
          await controlledMenu
            .getByRole("navigation", {
              exact: true,
              name: m.mobilePrimaryNavigationLabel({}, { locale }),
            })
            .isVisible()
        ).toBe(true);
        await expectNoHorizontalOverflow(page);

        await closeButton.click();
        await menuButton.waitFor();
        expect(await menuButton.getAttribute("aria-expanded")).toBe("false");
        await mobileNavigation.waitFor({ state: "hidden" });
      } finally {
        await page.close();
      }
    }
  );

  test.skipIf(!chromiumAvailable)(
    `hides the admin entry from a customer (${locale})`,
    async () => {
      const page = await openSiteHeader(locale, desktopViewport);
      try {
        expect(
          await page
            .getByRole("link", { name: m.siteHeaderAdminLabel({}, { locale }) })
            .count()
        ).toBe(0);
        expect(await readHeaderHeights(page)).toEqual({
          header: 96,
          variable: 96,
        });
      } finally {
        await page.close();
      }
    }
  );

  for (const viewport of [narrowDesktopViewport, desktopViewport]) {
    for (const administrator of [false, true]) {
      const state = administrator ? "an administrator" : "a customer";
      test.skipIf(!chromiumAvailable)(
        `keeps every desktop label on one line for ${state} at ${viewport.width}px (${locale})`,
        async () => {
          const page = await openSiteHeader(locale, viewport, {
            administrator,
          });
          try {
            await expectNoHorizontalOverflow(page);
            expect(
              await readWrappedNavigationLabels(
                page,
                m.primaryNavigationLabel({}, { locale })
              )
            ).toEqual([]);
            if (administrator) {
              // The desktop button comes first and keeps its visible label.
              const adminButton = page
                .getByRole("link", {
                  exact: true,
                  name: m.siteHeaderAdminLabel({}, { locale }),
                })
                .first();
              expect(await adminButton.isVisible()).toBe(true);
              expect((await adminButton.innerText()).trim().toLowerCase()).toBe(
                m.siteHeaderAdminLabel({}, { locale }).toLowerCase()
              );
            }
          } finally {
            await page.close();
          }
        }
      );
    }
  }

  for (const viewport of [narrowDesktopViewport, desktopViewport]) {
    for (const variant of headerVariants) {
      // Only the full header shrinks its logo further beside the navigation,
      // and only below 2xl.
      const zoom = variant === "full" && viewport.width < 1536 ? "0.7" : "0.8";
      test.skipIf(!chromiumAvailable)(
        `zooms the ${variant} header logo to ${zoom} at ${viewport.width}px (${locale})`,
        async () => {
          const page = await openSiteHeader(locale, viewport, { variant });
          try {
            const layout = await readHorizontalLogoLayout(page);
            expect(layout.zoom).toBe(zoom);
            // The zoomed logo reserves no width beyond what it draws.
            expect(layout.logoWidth).toBeCloseTo(layout.linkWidth, 1);
            expect(layout.logoLeft).toBeCloseTo(layout.linkLeft, 1);
          } finally {
            await page.close();
          }
        }
      );
    }
  }

  test.skipIf(!chromiumAvailable)(
    `keeps the administrator's header at the bar height (${locale})`,
    async () => {
      const page = await openSiteHeader(locale, desktopViewport, {
        administrator: true,
      });
      try {
        expect(await readHeaderHeights(page)).toEqual({
          header: 96,
          variable: 96,
        });
      } finally {
        await page.close();
      }
    }
  );

  test.skipIf(!chromiumAvailable)(
    `scrolls the administrator's mobile menu to the language switcher (${locale})`,
    async () => {
      const page = await openSiteHeader(locale, shortMobileViewport, {
        administrator: true,
      });
      try {
        await expectNoHorizontalOverflow(page);

        await page
          .getByRole("button", {
            exact: true,
            name: m.openNavigationMenuLabel({}, { locale }),
          })
          .click();
        const menu = page.locator("#site-header-mobile-menu");
        const menuAdminButton = menu.getByRole("link", {
          exact: true,
          name: m.siteHeaderAdminLabel({}, { locale }),
        });
        await menuAdminButton.waitFor();

        const menuBox = await menu.boundingBox();
        expect(menuBox).not.toBeNull();
        expect((menuBox?.y ?? 0) + (menuBox?.height ?? 0)).toBeLessThanOrEqual(
          shortMobileViewport.height + 1
        );
        expect(
          await menu.evaluate(
            (element) => element.scrollHeight > element.clientHeight
          )
        ).toBe(true);

        const switcher = menu.locator("[data-locale-switcher]");
        await switcher.scrollIntoViewIfNeeded();
        const switcherBox = await switcher.boundingBox();
        expect(
          (switcherBox?.y ?? 0) + (switcherBox?.height ?? 0)
        ).toBeLessThanOrEqual(shortMobileViewport.height + 1);
        expect(switcherBox?.y ?? 0).toBeGreaterThanOrEqual(140);
      } finally {
        await page.close();
      }
    }
  );
}
