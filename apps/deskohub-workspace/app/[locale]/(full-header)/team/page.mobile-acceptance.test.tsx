import { afterAll, beforeAll, expect, mock, test } from "bun:test";
import { mkdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { type Browser, chromium } from "@playwright/test";
import tailwindcss from "@tailwindcss/postcss";
import postcss from "postcss";
import { createElement, type ReactElement, type ReactNode } from "react";
import { renderToReadableStream } from "react-dom/server";
import type { Locale } from "@/features/i18n";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";

const screenshotDirectory = "/tmp/opencode";
const appDirectory = resolve(import.meta.dir, "../../../..");
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
mock.module("@/features/account/server/account-feature-flag.server", () => ({
  areAccountsEnabled: async () => false,
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
  await mkdir(screenshotDirectory, { recursive: true });

  const teamPage = await LocalizedTeamPage();
  const layout = await FullHeaderLayout({ children: teamPage });
  const stream = await renderToReadableStream(layout as ReactElement);
  pageMarkup = await new Response(stream).text();

  const stylesPath = join(appDirectory, "app/globals.css");
  const sourceStyles = await readFile(stylesPath, "utf8");
  appStyles = (
    await postcss([tailwindcss()]).process(sourceStyles, { from: stylesPath })
  ).css;

  browser = await chromium.launch({ headless: true });
});

afterAll(async () => {
  await browser?.close();
  await unregisterWorkspaceComponentTestEnv();
});

test("the Czech Team route heading clears the fixed mobile site header", async () => {
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
    name: "Náš tým",
  });
  expect(await heading.isVisible()).toBe(true);
  expect(
    await header.evaluate((element) => getComputedStyle(element).position)
  ).toBe("fixed");

  const headerBounds = await header.boundingBox();
  const headingBounds = await heading.boundingBox();
  if (!headerBounds || !headingBounds) {
    throw new Error("The Team header or page heading has no rendered bounds.");
  }
  expect(headerBounds.y).toBe(0);
  expect(headingBounds.y).toBeGreaterThanOrEqual(
    headerBounds.y + headerBounds.height
  );
  expect(headingBounds.y + headingBounds.height).toBeLessThanOrEqual(844);

  await page.screenshot({
    clip: { height: 240, width: 390, x: 0, y: 0 },
    path: join(screenshotDirectory, "deskohub-team-mobile-fixed-header-h1.png"),
  });
  await page.close();
});
