import "@/shared/polyfills/temporal";

import { afterAll, beforeAll, expect, test } from "bun:test";
import { type Browser, chromium, type Page } from "@playwright/test";
import { Effect, Schema } from "effect";
import { workspaceReservationIdSchema } from "@/features/reservation/persistence-contracts";
import { playwrightChromiumAvailable } from "@/shared/testing/playwright-browser";
import type { E2EBrowserSession } from "../browser-session";
import {
  failedStepAnnotation,
  runBrowserStep,
} from "../case-runner.browser.test-utils";
import { makeCoworkCheckoutData } from "../checkout/data";
import type { HostedPaymentPage } from "../checkout/nexi-hosted-payment";
import { toPrefilledReservation } from "../checkout/prefilled-reservation";
import { workspaceE2ETimeouts } from "../timeouts";
import { leaveRejectedHostedPayment } from "./checkout";
import {
  assertReturnedTerminalStatusPage,
  assertTerminalStatusPage,
  getPaymentTerminalScenarios,
  retryReservation,
} from "./payment-terminal";

const available = await playwrightChromiumAvailable();
const browserTest = test.skipIf(!available);
let browser: Browser | undefined;
const documents = new Map<string, string>();
const requests: string[] = [];
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch: (request) => {
    const url = new URL(request.url);
    requests.push(url.pathname);
    return new Response(documents.get(url.pathname) ?? "<main></main>", {
      headers: { "content-type": "text/html" },
    });
  },
});
beforeAll(async () => {
  if (available) browser = await chromium.launch({ headless: true });
});
afterAll(async () => {
  await browser?.close();
  server.stop(true);
});
const requireBrowser = () => {
  if (!browser) throw new Error("Chromium is not running");
  return browser;
};
const orderId = Schema.decodeUnknownSync(workspaceReservationIdSchema)(
  "019f7082-1bec-7ab4-8fcd-2f0fdfd9dd71"
);
const statusPath = `/en-US/reservation/status/${orderId}`;
const timeouts = {
  ...workspaceE2ETimeouts,
  browserAction: 1_500,
  browserNavigation: 5_000,
  uiTransition: 1_500,
};
const config = {
  baseUrl: server.url.origin,
  bypassSecret: undefined,
  timeouts,
};
const open = (path: string) => (session: E2EBrowserSession) =>
  session.use("open synthetic checkout page", async (page) => {
    await page.goto(new URL(path, server.url).href);
  });
type Result = Awaited<ReturnType<typeof runBrowserStep>>;
const passed = (result: Result) => {
  expect(result.succeeded).toBe(true);
  expect(result.annotations).toEqual([]);
  expect(result.failures).toEqual([]);
};
const failed = (result: Result, kind: "error" | "timeout") => {
  expect(result.succeeded).toBe(false);
  expect(result.annotations).toEqual(failedStepAnnotation(kind));
  expect(result.failures.map(({ timeout }) => timeout)).toEqual([
    kind === "timeout",
  ]);
};

for (const scenario of getPaymentTerminalScenarios()) {
  const body = `<main>${scenario.state === "failed" ? "Payment was not completed." : "Payment was cancelled."} <a href="/retry">Try again</a></main>`;
  browserTest(
    `opens and validates the ${scenario.state} status page`,
    async () => {
      documents.set(statusPath, body);
      const result = await runBrowserStep({
        browser: requireBrowser(),
        prepare: () => Effect.void,
        drive: ({ session }) =>
          assertTerminalStatusPage({ config, orderId, scenario, session }),
      });
      passed(result);
    }
  );
  browserTest(
    `validates the returned ${scenario.state} page without reloading`,
    async () => {
      documents.set(statusPath, body);
      const before = requests.length;
      const result = await runBrowserStep({
        browser: requireBrowser(),
        prepare: open(statusPath),
        drive: ({ session }) =>
          assertReturnedTerminalStatusPage({
            orderId,
            scenario,
            session,
            timeouts,
          }),
      });
      passed(result);
      expect(requests.slice(before)).toEqual([statusPath]);
    }
  );
}

browserTest("rejects a return to another order", async () => {
  const result = await runBrowserStep({
    browser: requireBrowser(),
    prepare: open("/en-US/reservation/status/another-order"),
    drive: ({ session }) =>
      assertReturnedTerminalStatusPage({
        orderId,
        scenario: getPaymentTerminalScenarios()[0]!,
        session,
        timeouts,
      }),
  });
  failed(result, "error");
});

browserTest("fails terminal copy that never offers a retry", async () => {
  documents.set(statusPath, "<main>Payment was not completed.</main>");
  const result = await runBrowserStep({
    browser: requireBrowser(),
    prepare: open(statusPath),
    drive: ({ session }) =>
      assertReturnedTerminalStatusPage({
        orderId,
        scenario: getPaymentTerminalScenarios()[0]!,
        session,
        timeouts,
      }),
  });
  failed(result, "timeout");
});

for (const problem of ["none", "contact-in-url", "wrong-selection"] as const) {
  browserTest(
    `follows a contact-free retry with the original selection: ${problem}`,
    async () => {
      const data = makeCoworkCheckoutData(
        server.url.origin,
        "2099-09-01",
        `terminal-${problem}`
      );
      const expected = toPrefilledReservation(data);
      if (expected.kind !== "cowork") throw new Error("expected cowork data");
      const reservationPath = "/en-US/reservation/cowork";
      const query = new URLSearchParams({
        entryTier: expected.entryTier,
        date: data.date,
      });
      if (problem === "contact-in-url") query.set("customer", "contact");
      documents.set(
        statusPath,
        `<a id="checkout-status-reserve-again" href="${reservationPath}?${query}">Try again</a>
      <script>document.querySelector('a').__reactProps$test = { onClick() {} };</script>`
      );
      documents.set(
        reservationPath,
        `<main>
      <input name="entryTier" type="radio" value="${expected.entryTier}" checked>
      <input name="date" value="${problem === "wrong-selection" ? "2099-09-02" : data.date}">
      <button role="switch" aria-checked="${expected.coffee}">${expected.coffeeSwitchLabel}</button>
    </main>`
      );
      const result = await runBrowserStep({
        browser: requireBrowser(),
        prepare: open(statusPath),
        drive: ({ session }) =>
          retryReservation({
            data,
            reservationPath,
            scenario: getPaymentTerminalScenarios()[0]!,
            session,
            timeouts,
          }),
      });
      if (problem === "none") passed(result);
      else failed(result, problem === "contact-in-url" ? "error" : "timeout");
    }
  );
}

for (const mode of [
  "popup",
  "same-tab",
  "closed-popup",
  "stuck-close",
] as const) {
  browserTest(
    `leaves a rejected hosted payment with ${mode}`,
    async () => {
      const payPath = `/checkout/pay/${mode}`;
      documents.set(payPath, "<main>Checkout pay page</main>");
      let hosted: HostedPaymentPage | undefined;
      let activeAfter: Page | undefined;
      const before = requests.length;
      const result = await runBrowserStep({
        browser: requireBrowser(),
        prepare: (session) =>
          session.use("open rejected payment", async (checkoutPage) => {
            await checkoutPage.goto(new URL(statusPath, server.url).href);
            let page = checkoutPage;
            if (mode !== "same-tab") {
              const popup = checkoutPage.waitForEvent("popup", {
                timeout: 5_000,
              });
              await checkoutPage.evaluate(() =>
                window.open("/hpp/nexi/rejected", "_blank")
              );
              page = await popup;
              await page.waitForLoadState("load", { timeout: 5_000 });
            } else
              await page.goto(new URL("/hpp/nexi/rejected", server.url).href);
            hosted = {
              checkoutPage,
              checkoutPageUrl: new URL(payPath, server.url).href,
              page,
              url: page.url(),
            };
            if (mode === "closed-popup") await page.close();
            if (mode === "stuck-close")
              page.close = () => new Promise<void>(() => {});
          }),
        drive: ({ session }) => {
          if (!hosted) throw new Error("missing hosted page");
          return leaveRejectedHostedPayment({
            config,
            hostedPaymentPage: hosted,
            session,
          });
        },
        afterStep: ({ session }) =>
          session.use("read active page after restart", async (page) => {
            activeAfter = page;
          }),
      });
      if (mode === "closed-popup" || mode === "stuck-close") {
        failed(result, mode === "stuck-close" ? "timeout" : "error");
        expect(requests.slice(before)).not.toContain(payPath);
      } else {
        passed(result);
        expect(activeAfter).toBe(hosted?.checkoutPage);
        expect(
          requests.slice(before).filter((path) => path === payPath)
        ).toHaveLength(1);
        if (mode === "popup") expect(hosted?.page.isClosed()).toBe(true);
      }
    },
    25_000
  );
}
