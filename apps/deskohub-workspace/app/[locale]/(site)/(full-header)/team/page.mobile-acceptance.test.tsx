import { afterAll, beforeAll, expect, mock, test } from "bun:test";
import { type Browser, chromium } from "@playwright/test";
import { createElement, type ReactElement, type ReactNode } from "react";
import { renderToReadableStream } from "react-dom/server";
import { type Locale, m } from "@/features/i18n";
import { playwrightChromiumAvailable } from "@/shared/testing/playwright-browser";
import { compileWorkspaceAppStyles } from "@/shared/testing/workspace-app-styles.test-utils";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";

const chromiumAvailable = await playwrightChromiumAvailable();
const requestLocale: Locale = "cs-CZ";
let browser: Browser | undefined;
let pageMarkup = "";
let appStyles = "";

function getRequestLocale() {
  return Promise.resolve(requestLocale);
}

function runWithRequestLocale<A>(resolve: (locale: Locale) => A) {
  return Promise.resolve(resolve(requestLocale));
}

mock.module("@/features/i18n/server/request-locale", () => ({
  getRequestLocale,
  runWithRequestLocale,
}));
mock.module("@/features/account/server/customer-session.server", () => ({
  isCustomerSignedIn: async () => false,
}));
mock.module("@/features/account/actions", () => ({
  updateLocalePreference: async () => undefined,
}));
mock.module(
  "@/features/meeting-room/backend/meeting-room-page-feature-flag",
  () => ({
    isMeetingRoomPageEnabled: async () => false,
  })
);
mock.module(
  "@/features/office/backend/office-reservation-feature-flag.server",
  () => ({
    isOfficePageEnabled: async () => false,
  })
);
mock.module("next/navigation", () => ({
  usePathname: () => "/cs-CZ/team",
  useRouter: () => ({ bfcacheId: "synthetic-team-page" }),
  useSearchParams: () => new URLSearchParams(),
  useSelectedLayoutSegment: () => "team",
}));
mock.module("next/cache", () => ({ cacheLife: () => undefined }));
const syntheticLogoSource =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 320 96'%3E%3Crect x='8' y='12' width='72' height='72' rx='18' fill='%23f57c00'/%3E%3Cpath d='M28 60 44 28 60 60' fill='none' stroke='white' stroke-width='7'/%3E%3Ctext x='96' y='61' fill='white' font-family='Arial,sans-serif' font-size='34' font-weight='700'%3EDeskohub%3C/text%3E%3C/svg%3E";
mock.module("next/link", () => ({
  default: ({
    children,
    href,
  }: {
    readonly children: ReactNode;
    readonly href: string;
  }) => createElement("a", { href }, children),
}));
mock.module("next/image", () => ({
  default: ({ alt }: { readonly alt: string }) =>
    createElement("img", {
      alt,
      height: 48,
      src: syntheticLogoSource,
      width: 120,
    }),
}));
mock.module("@deskohub/cloudinary-image", () => ({
  CloudinaryImage: () => null,
}));

const { default: FullHeaderLayout } = await import("../layout");
const { default: LocalizedTeamPage } = await import("./page");

beforeAll(async () => {
  registerWorkspaceComponentTestEnv();
  if (!chromiumAvailable) return;

  const teamPage = await LocalizedTeamPage();
  const layout = await FullHeaderLayout({ children: teamPage });
  const stream = await renderToReadableStream(layout as ReactElement);
  pageMarkup = await new Response(stream).text();

  appStyles = await compileWorkspaceAppStyles();

  browser = await chromium.launch({ headless: true });
});

afterAll(async () => {
  await browser?.close();
  await unregisterWorkspaceComponentTestEnv();
});

test.skipIf(!chromiumAvailable)(
  "the Czech Team route heading clears the fixed mobile site header",
  async () => {
    if (!browser)
      throw new Error("The Team acceptance browser was not launched.");
    const page = await browser.newPage({
      reducedMotion: "reduce",
      viewport: { height: 844, width: 390 },
    });

    await page.setContent(
      `<!doctype html><html lang="cs-CZ"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>${appStyles}</style></head><body>${pageMarkup}</body></html>`
    );

    const header = page.locator("header");
    const heading = page.getByRole("heading", {
      exact: true,
      level: 1,
      name: m.landingFoundersTitle({}, { locale: requestLocale }),
    });
    expect(await heading.isVisible()).toBe(true);
    expect(
      await header.evaluate((element) => getComputedStyle(element).position)
    ).toBe("fixed");

    const headerBounds = await header.boundingBox();
    const headingBounds = await heading.boundingBox();
    if (!headerBounds || !headingBounds) {
      throw new Error(
        "The Team header or page heading has no rendered bounds."
      );
    }
    expect(headerBounds.y).toBe(0);
    expect(headingBounds.y).toBeGreaterThanOrEqual(
      headerBounds.y + headerBounds.height
    );
    expect(headingBounds.y + headingBounds.height).toBeLessThanOrEqual(844);
    await page.close();
  }
);
