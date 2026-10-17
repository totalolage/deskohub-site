import { afterAll, beforeAll, expect, test } from "bun:test";
import { type Browser, chromium } from "@playwright/test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { getAccountScreenCopy } from "@/features/account/components/account-screen-copy";
import { getAccountSectionPath } from "@/features/account/routes";
import type { AccountSection } from "@/features/account/sections";
import { m } from "@/features/i18n";
import { playwrightChromiumAvailable } from "@/shared/testing/playwright-browser";
import { compileWorkspaceAppStyles } from "@/shared/testing/workspace-app-styles.test-utils";
import { AccountShell } from "./shell/account-shell";
import { SignInLoading } from "./sign-in-loading";

const locale = "en-US" as const;
const chromiumAvailable = await playwrightChromiumAvailable();
let browser: Browser | undefined;
let appStyles = "";

beforeAll(async () => {
  if (!chromiumAvailable) return;
  appStyles = await compileWorkspaceAppStyles();

  browser = await chromium.launch({ headless: true });
});

afterAll(async () => {
  await browser?.close();
});

// An anonymous visitor waiting on the sign-in handoff sees the account shell
// around SignInLoading. The site header and footer come from the server
// layout, so stand-ins keep their flow: a fixed header of the site header
// height, then the footer after the main content.
const renderSignInHandoffPage = () =>
  renderToStaticMarkup(
    createElement(
      AccountShell,
      {
        activeSection: "reservations",
        labels: getAccountScreenCopy(locale).shell,
        onSectionChange: () => undefined,
        sectionHref: (section: AccountSection) =>
          getAccountSectionPath(locale, section),
        signOut: null,
        title: m.accountTitle({}, { locale }),
      },
      createElement(SignInLoading, { locale })
    )
  );

test.skipIf(!chromiumAvailable)(
  "keeps the sign-in handoff content between the fixed site header and the footer",
  async () => {
    if (!browser)
      throw new Error("The SignInLoading browser has not launched.");
    const page = await browser.newPage({
      reducedMotion: "reduce",
      viewport: { height: 720, width: 1280 },
    });
    try {
      await page.setContent(
        `<!doctype html><html lang="en"><head><meta charset="utf-8"></head><body><header class="fixed inset-x-0 top-0 z-50 h-(--site-header-height)"></header><div id="main-content">${renderSignInHandoffPage()}</div><footer class="py-10">Synthetic footer</footer></body></html>`
      );
      await page.addStyleTag({ content: appStyles });
      await page
        .getByRole("status", {
          name: m.accountSignInLoading({}, { locale }),
        })
        .waitFor();

      const layout = await page.evaluate(() => {
        const header = document.querySelector("body > header");
        const main = document.querySelector("main");
        const status = document.querySelector('[data-slot="sign-in-loading"]');
        const footer = document.querySelector("footer");
        if (!header || !main || !status || !footer) return null;

        const mainRect = main.getBoundingClientRect();
        return {
          footerTop: footer.getBoundingClientRect().top,
          headerBottom: header.getBoundingClientRect().bottom,
          mainBottom: mainRect.bottom,
          mainHeight: mainRect.height,
          statusTop: status.getBoundingClientRect().top,
        };
      });
      if (!layout) throw new Error("Sign-in handoff landmarks are missing");

      expect(layout.headerBottom).toBeGreaterThan(0);
      expect(layout.mainHeight).toBeGreaterThan(0);
      expect(layout.statusTop).toBeGreaterThanOrEqual(layout.headerBottom);
      expect(layout.footerTop).toBeGreaterThanOrEqual(layout.mainBottom);
      expect(layout.footerTop).toBeGreaterThanOrEqual(layout.headerBottom);
    } finally {
      await page.close();
    }
  }
);
