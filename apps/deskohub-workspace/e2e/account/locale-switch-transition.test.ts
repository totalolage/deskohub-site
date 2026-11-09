import { expect, test } from "bun:test";
import { createServer } from "node:http";
import { chromium, type Page } from "@playwright/test";
import { playwrightChromiumAvailable } from "../../shared/testing/playwright-browser";
import { languageMenuMarkup } from "../language-menu.test-utils";
import {
  activateHeaderSwitcher,
  localeSwitchErrorPageKey,
  watchLocaleSwitchErrorPage,
} from "./locale-switch-transition";

const chromiumAvailable = playwrightChromiumAvailable();
const errorTitle = "Something went wrong.";
const watch = { key: localeSwitchErrorPageKey, titles: [errorTitle] };

// The old page flashes the error page and then leaves for the new locale,
// like a save whose response re-renders the page before the locale switch's
// document navigation replaces it.
const flashThenLeave = `<!doctype html><title>old</title><button id="switch">switch</button>
<script>
  document.getElementById("switch").addEventListener("click", () => {
    const heading = document.createElement("h1");
    heading.textContent = ${JSON.stringify(errorTitle)};
    setTimeout(() => document.body.append(heading), 50);
    setTimeout(() => location.assign("/cs-CZ/account/profile"), 300);
  });
</script>`;

const leave = `<!doctype html><title>old</title><button id="switch">switch</button>
<script>
  document.getElementById("switch").addEventListener("click", () => {
    setTimeout(() => location.assign("/cs-CZ/account/profile"), 300);
  });
</script>`;

// The header's language menu, whose trigger sits in the bar at every width.
const header = `<!doctype html><title>header</title>
${languageMenuMarkup({ links: [{ href: "/en-US/landed", label: "EN" }] })}`;

const pages: Record<string, string> = {
  "/cs-CZ/header": header,
  "/en-US/landed": "<!doctype html><title>landed</title>",
  "/en-US/account": flashThenLeave,
  "/en-US/account/clean": leave,
  "/cs-CZ/account": "<!doctype html><title>new</title><p>profile</p>",
  "/cs-CZ/account/profile": "<!doctype html><title>new</title><p>profile</p>",
  "/cs-CZ/account/broken": `<!doctype html><title>new</title><h1>${errorTitle}</h1>`,
};

const startServer = async () => {
  const server = createServer((request, response) => {
    const { pathname } = new URL(request.url ?? "/", "http://localhost");
    const body = pages[pathname];
    response.writeHead(body === undefined ? 404 : 200, {
      "content-type": "text/html",
    });
    response.end(body ?? "");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("test server has no port");
  }
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
};

const withPage = async (
  run: (page: Page, baseUrl: string) => Promise<void>
) => {
  const server = await startServer();
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.addInitScript(watchLocaleSwitchErrorPage, watch);
    await run(page, server.baseUrl);
  } finally {
    await browser.close();
    await server.close();
  }
};

const arm = (page: Page) =>
  page.evaluate((key) => {
    window.sessionStorage.setItem(key, "");
  }, localeSwitchErrorPageKey);

const readRecord = (page: Page) =>
  page.evaluate(
    (key) => window.sessionStorage.getItem(key),
    localeSwitchErrorPageKey
  );

const switchAndLand = async (page: Page) => {
  await page.click("#switch");
  await page.waitForURL((url) => url.pathname === "/cs-CZ/account/profile");
};

test.skipIf(!chromiumAvailable)(
  "keeps a record of an error page the old page showed before the switch left it",
  () =>
    withPage(async (page, baseUrl) => {
      await page.goto(`${baseUrl}/en-US/account`);
      await arm(page);
      await page.evaluate(watchLocaleSwitchErrorPage, watch);

      await switchAndLand(page);

      expect(await readRecord(page)).toBe("/en-US/account");
    })
);

test.skipIf(!chromiumAvailable)(
  "records nothing for a switch that never shows the error page",
  () =>
    withPage(async (page, baseUrl) => {
      await page.goto(`${baseUrl}/en-US/account/clean`);
      await arm(page);
      await page.evaluate(watchLocaleSwitchErrorPage, watch);

      await switchAndLand(page);

      expect(await readRecord(page)).toBe("");
    })
);

test.skipIf(!chromiumAvailable)(
  "watches the new document while armed and ignores it once disarmed",
  () =>
    withPage(async (page, baseUrl) => {
      await page.goto(`${baseUrl}/cs-CZ/account`);
      await arm(page);
      await page.goto(`${baseUrl}/cs-CZ/account/broken`);
      expect(await readRecord(page)).toBe("/cs-CZ/account/broken");

      await page.evaluate((key) => {
        window.sessionStorage.removeItem(key);
      }, localeSwitchErrorPageKey);
      await page.reload();
      expect(await readRecord(page)).toBeNull();
    })
);

test.skipIf(!chromiumAvailable)(
  "opens the header language menu and clicks its link",
  () =>
    withPage(async (page, baseUrl) => {
      await page.setViewportSize({ height: 800, width: 390 });
      await page.goto(`${baseUrl}/cs-CZ/header`);

      await activateHeaderSwitcher(page, "en-US");
      await page.waitForURL((url) => url.pathname === "/en-US/landed");
    })
);
