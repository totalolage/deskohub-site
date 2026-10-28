import "@/shared/polyfills/temporal";

import { afterAll, beforeAll, expect, test } from "bun:test";
import { type Browser, chromium, type Page } from "@playwright/test";
import { Effect } from "effect";
import { playwrightChromiumAvailable } from "@/shared/testing/playwright-browser";
import type { E2EBrowserSession } from "../browser-session";
import {
  type BrowserStepDriver,
  failedStepAnnotation,
  runBrowserStep,
} from "../case-runner.browser.test-utils";
import type { WorkspaceE2EConfig } from "../config";
import { E2EDatabase } from "../integrations/database.service";
import { workspaceE2ETimeouts } from "../timeouts";
import type { CheckoutData, CheckoutRow } from "../types";
import {
  assertFulfilledStatusPage,
  findFulfilledStatusPageProblem,
  findFulfillmentSupportLinkProblem,
  isFreshReservationFormSettled,
} from "./checkout";

const chromiumAvailable = await playwrightChromiumAvailable();
let browser: Browser | undefined;
let page: Page | undefined;

const pages = new Map<string, string>();
const requests: string[] = [];
const server = Bun.serve({
  fetch: (request) => {
    const { pathname } = new URL(request.url);
    requests.push(pathname);
    return new Response(pages.get(pathname) ?? "<!doctype html><body></body>", {
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  },
  port: 0,
});

beforeAll(async () => {
  if (!chromiumAvailable) return;
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage();
});

afterAll(async () => {
  await browser?.close();
  server.stop(true);
});

const requirePage = () => {
  if (!page) throw new Error("Chromium is not running");
  return page;
};

const requireBrowser = () => {
  if (!browser) throw new Error("Chromium is not running");
  return browser;
};

const statusCopy =
  "<p>Your reservation is confirmed. Your payment is complete and we've emailed you the secure access link.</p>";

test.skipIf(!chromiumAvailable)(
  "accepts only the canonical fulfilled checkout status page",
  async () => {
    const problemOn = async (body: string) => {
      await requirePage().setContent(body);
      return requirePage().evaluate(findFulfilledStatusPageProblem);
    };

    expect(
      await problemOn(
        `<main>${statusCopy}</main><div role="dialog">Cookie settings</div>`
      )
    ).toBeNull();
    expect(
      await problemOn(
        `<main>${statusCopy}<div data-reservation-access=""></div></main>`
      )
    ).toBe("reservation access rendered on checkout status page");
    expect(await problemOn(`<div role="dialog">${statusCopy}</div>`)).toBe(
      "checkout status rendered in a reservation dialog"
    );
    expect(await problemOn("<main>Loading</main>")).toBe(
      "fulfilled checkout status copy not visible"
    );
  }
);

test.skipIf(!chromiumAvailable)(
  "accepts only a support link for the order on the locale's contact page",
  async () => {
    const expected = { locale: "en-US", orderId: "order-id" };
    const problemOn = async (href: string, copy = true) => {
      await requirePage().setContent(
        `<p>${copy ? "We couldn't deliver your confirmation." : "Done."}</p>
        <a href="${href}">Send support request</a>`
      );
      return requirePage().evaluate(
        findFulfillmentSupportLinkProblem,
        expected
      );
    };
    const contact = "https://workspace.example.test/en-US/contact";

    expect(await problemOn(`${contact}?message=About+order-id`)).toBeNull();
    expect(await problemOn(`${contact}?message=About+order-id`, false)).toBe(
      "fulfillment failed status copy not visible"
    );
    expect(
      await problemOn(
        "https://workspace.example.test/cs-CZ/contact?message=order-id"
      )
    ).toBe("support contact link points at unexpected path");
    expect(await problemOn(`${contact}?message=Another+order`)).toBe(
      "support contact message missing order id"
    );
  }
);

test.skipIf(!chromiumAvailable)(
  "waits a second on the fresh reservation form and forgets it once the page leaves",
  async () => {
    const form = requirePage();
    await form.goto(new URL("/en-US/reservation/cowork", server.url).href);
    const startedAt = Date.now();
    await form.waitForFunction(
      isFreshReservationFormSettled,
      { reservationPath: "/en-US/reservation/cowork" },
      { timeout: 5000 }
    );
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(1000);

    // Another path is not the fresh form, and resets the first sighting.
    expect(
      await form.evaluate(isFreshReservationFormSettled, {
        reservationPath: "/en-US/reservation/office",
      })
    ).toBe(false);
    expect(
      await form.evaluate(
        () => document.documentElement.dataset.checkoutRestartReadyAt
      )
    ).toBeUndefined();
  },
  15_000
);

// The status page the payment return left open: the checkout reads it in
// place, as server and runner whitespace render it.
const statusPath = "/en-US/reservation/status/order-id";
const statusPage = (extra = "") =>
  `<!doctype html><body><main>Your reservation is confirmed. Your payment is complete and we've emailed you the secure access link. Tuesday, August 25, 2026 10:00 AM – 2:00 PM CZK 0</main>${extra}</body>`;

const assertStatusPage = ({ id, run }: BrowserStepDriver) =>
  assertFulfilledStatusPage({
    checkoutRow: {
      amount_exponent: 2,
      amount_value: 0,
      currency: "CZK",
    } as CheckoutRow,
    config: {
      expectedHost: server.url.host,
      timeouts: workspaceE2ETimeouts,
    } as WorkspaceE2EConfig,
    data: { locale: "en-US", meetingRoom: {} } as CheckoutData,
    dotyposReservation: {
      reservedFrom: Temporal.Instant.from("2026-08-25T08:00:00Z"),
      reservedUntil: Temporal.Instant.from("2026-08-25T12:00:00Z"),
    } as never,
    orderId: "order-id" as CheckoutRow["reservation_id"],
    run,
    session: id,
  }).pipe(
    Effect.provideService(E2EDatabase, E2EDatabase.of({ db: {} as never }))
  );

const openStatusPage = (extra: string) => {
  pages.set(statusPath, statusPage(extra));
  return (session: E2EBrowserSession) =>
    session.use("open the status page", async (statusTab) => {
      await statusTab.goto(
        new URL(`${statusPath}?outcome=success`, server.url).href
      );
    });
};

test.skipIf(!chromiumAvailable)(
  "validates the fulfilled status page in place across whitespace variants",
  async () => {
    const before = requests.length;
    const result = await runBrowserStep({
      browser: requireBrowser(),
      drive: assertStatusPage,
      prepare: openStatusPage(""),
    });

    expect(result.succeeded).toBe(true);
    expect(result.annotations).toEqual([]);
    // Only the step's own page load: the check never reloads or navigates.
    expect(requests.slice(before)).toEqual([statusPath]);
  },
  60_000
);

test.skipIf(!chromiumAvailable)(
  "fails the status step with the page check's problem",
  async () => {
    const result = await runBrowserStep({
      browser: requireBrowser(),
      drive: assertStatusPage,
      prepare: openStatusPage(
        '<div role="dialog">Your reservation is confirmed.</div>'
      ),
    });

    expect(result.annotations).toEqual(failedStepAnnotation("error"));
    expect(result.failures).toEqual([
      {
        message:
          "assert fulfilled checkout status page failed: checkout status rendered in a reservation dialog",
        timeout: false,
      },
    ]);
  },
  60_000
);
