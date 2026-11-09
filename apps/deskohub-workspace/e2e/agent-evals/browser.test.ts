import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createServer, type Server } from "node:http";
import { chromium } from "@playwright/test";
import { Effect } from "effect";
import { playwrightChromiumAvailable } from "../../shared/testing/playwright-browser";
import { launchAgentEvalBrowser } from "./browser";
import { observeAgentEvalBrowser } from "./observations";

const chromiumAvailable = await playwrightChromiumAvailable();

// One server answers as two hosts: `localhost` plays the preview and
// `127.0.0.1` the hosted payment page.
let server: Server;
let port = 0;
const siteOrigin = () => `http://localhost:${port}`;
const providerUrl = () => `http://127.0.0.1:${port}/hosted-payment`;

beforeAll(async () => {
  server = createServer((request, response) => {
    response.writeHead(200, { "content-type": "text/html" });
    if (request.url?.startsWith("/hosted-payment")) {
      response.end('<label>Card number <input name="card"></label>');
      return;
    }
    response.end(
      `<a id="new-tab" href="${providerUrl()}" target="_blank">Pay</a> <a id="same-tab" href="${providerUrl()}">Pay here</a>`
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("no port");
  port = address.port;
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

describe.skipIf(!chromiumAvailable)("agent eval browser", () => {
  test("observes tabs a harness opens and drives over CDP", async () => {
    const browser = await Effect.runPromise(
      launchAgentEvalBrowser({
        headless: true,
        launchOptions: {},
        locale: "en-US",
      })
    );
    const harness = await chromium.connectOverCDP(browser.cdpEndpoint);
    try {
      const startPage =
        browser.context.pages()[0] ?? (await browser.context.newPage());
      await startPage.goto(`${siteOrigin()}/en-US`);
      const observer = await observeAgentEvalBrowser(
        browser.context,
        startPage,
        {
          paymentProviderHost: "127.0.0.1",
          siteOrigin: siteOrigin(),
        }
      );

      // The harness sees the run's tab in the default context and works in it.
      const [harnessContext] = harness.contexts();
      const harnessPage = harnessContext
        ?.pages()
        .find((page) => page.url().startsWith(siteOrigin()));
      if (!harnessContext || !harnessPage) throw new Error("no shared tab");
      await harnessPage.goto(`${siteOrigin()}/en-US/checkout/pay?payState=x`);
      const [paymentTab] = await Promise.all([
        harnessContext.waitForEvent("page"),
        harnessPage.click("#new-tab"),
      ]);
      await paymentTab.waitForLoadState();
      await paymentTab.fill("input[name=card]", "4111");
      // The input report reaches the runner through a page binding.
      for (let attempt = 0; attempt < 50; attempt += 1) {
        if (observer.snapshot().paymentPage?.actedIn) break;
        await Bun.sleep(100);
      }

      const observations = observer.snapshot();
      expect(observations.routes).toEqual(["pay", "payment-provider"]);
      expect(observations.timeToPayUrlMs).toBeNumber();
      expect(observations.paymentPage).toMatchObject({
        actedIn: true,
        inNewTab: true,
      });
      expect(observations.tabCount).toBe(2);
    } finally {
      await harness.close();
      await Effect.runPromise(browser.close);
    }
  });

  test("tells a same-tab handoff the agent only looked at", async () => {
    const browser = await Effect.runPromise(
      launchAgentEvalBrowser({
        headless: true,
        launchOptions: {},
        locale: "cs-CZ",
      })
    );
    try {
      const page =
        browser.context.pages()[0] ?? (await browser.context.newPage());
      await page.goto(`${siteOrigin()}/cs-CZ`);
      const observer = await observeAgentEvalBrowser(browser.context, page, {
        paymentProviderHost: "127.0.0.1",
        siteOrigin: siteOrigin(),
      });
      await Promise.all([
        page.waitForURL(providerUrl()),
        page.click("#same-tab"),
      ]);

      expect(observer.snapshot()).toMatchObject({
        paymentPage: { actedIn: false, inNewTab: false },
        routes: ["payment-provider"],
        timeToPayUrlMs: null,
      });
    } finally {
      await Effect.runPromise(browser.close);
    }
  });
});
