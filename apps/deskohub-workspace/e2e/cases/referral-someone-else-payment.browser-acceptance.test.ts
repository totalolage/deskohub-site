import "@/shared/polyfills/temporal";

import { afterAll, beforeAll, expect, spyOn, test } from "bun:test";
import { type Browser, chromium } from "@playwright/test";
import { Effect } from "effect";
import { playwrightChromiumAvailable } from "@/shared/testing/playwright-browser";
import { WorkspaceE2EHostedPaymentPermitService } from "../coordination/hosted-payment-permit.service";
import { WorkspaceE2EProviderVerificationPermitService } from "../coordination/provider-verification-permit.service";
import type { WorkspaceE2EStepRunner } from "../case-runner";
import { runBrowserStep } from "../case-runner.browser.test-utils";
import { makeCoworkCheckoutData } from "../checkout/data";
import * as payment from "../checkout/payment";
import * as configuration from "../config";
import { makeWorkspaceE2EEnvironment } from "../e2e-env";
import { validE2ERuntimeEnvironment } from "../e2e-env.test-fixture";
import { workspaceE2EError } from "../errors";
import { E2EDatabase } from "../integrations/database.service";
import { workspaceE2ERunIdSchema } from "../run-identifiers";
import type { WorkspaceE2ECase } from "../types";
import {
  bindReferralSomeoneElsePaymentCase,
  referralSomeoneElsePaymentCaseId,
} from "./referral-someone-else-payment";

const chromiumAvailable = await playwrightChromiumAvailable();
let browser: Browser | undefined;
beforeAll(async () => {
  if (chromiumAvailable) browser = await chromium.launch({ headless: true });
});
afterAll(async () => {
  await browser?.close();
});

const environment = makeWorkspaceE2EEnvironment({
  ...validE2ERuntimeEnvironment,
  WORKSPACE_E2E_BETTER_AUTH_SECRETS:
    "1:synthetic-signing-secret-for-advertisement-test",
});
const config = configuration.getConfig(environment);
const data = makeCoworkCheckoutData(config.baseUrl, "2099-09-01");

// No backend is contacted. Each document is a synthetic ready reservation
// form, and submission is intercepted before it can create any state.
const form = (hasCalendar: boolean, hasPrice: boolean) => `<!doctype html><body>
  <input name="date" value="${data.date}" />
  ${hasPrice ? '<button data-reservation-type-price="open-space" data-reservation-type-price-ready="true"></button>' : ""}
  <input id="reservation-entry-tier-open-space" type="radio" checked />
  <button id="reservation-continue" data-reservation-price-loading="false" data-reservation-price-error="false">Continue</button>
  <button data-checkout-discount-details aria-describedby="sale">Discounts</button>
  <div id="sale" role="tooltip">${hasCalendar ? "E2E Calendar sale 20%" : "No discounts"}</div>
  <script>document.querySelector('[data-checkout-discount-details]').__reactProps$test = { onFocus() {} };</script>
</body>`;

const exerciseReservationStart = async ({
  showFromLoad,
  hasPrice = true,
}: {
  readonly showFromLoad: number;
  readonly hasPrice?: boolean;
}) => {
  if (!browser) throw new Error("Chromium is not running");
  let loads = 0;
  const submittedWithCalendar: boolean[] = [];
  const prematureRequests: string[] = [];
  const stopped = workspaceE2EError(
    "stopped before synthetic reservation submission"
  );
  const configured = spyOn(configuration, "getConfig").mockReturnValue({
    ...config,
    timeouts: {
      ...config.timeouts,
      browserAction: 1000,
      calendarSaleAdvertisement: 10_000,
      calendarSaleAdvertisementAttempt: 300,
    },
  });
  const submission = spyOn(
    payment,
    "submitReservationForPayPage"
  ).mockImplementation(({ session }) =>
    session
      .evaluate("observe advertised price before submission", () =>
        (document.getElementById("sale")?.textContent ?? "").includes(
          "E2E Calendar sale 20%"
        )
      )
      .pipe(
        Effect.tap((advertised) =>
          Effect.sync(() => {
            submittedWithCalendar.push(advertised);
          })
        ),
        Effect.andThen(Effect.fail(stopped))
      )
  );
  const output = spyOn(process.stdout, "write").mockImplementation(() => true);
  try {
    const planned: WorkspaceE2ECase = {
      id: referralSomeoneElsePaymentCaseId,
      checkoutStates: [{ data }],
      execute: () => Effect.void,
      timeoutMs: config.timeouts.checkoutCase,
    };
    const bound = await bindReferralSomeoneElsePaymentCase({
      browser,
      environment,
      runId: workspaceE2ERunIdSchema.make("synthetic-advertisement-regression"),
      testCase: planned,
    });
    const runStep = ((step) => {
      if (step.id === "seed-synthetic-referrer")
        return Effect.succeed({
          code: "SYNTHETIC_REFERRAL",
          customerId: "referrer",
        });
      if (step.id === "seed-synthetic-booker")
        return Effect.succeed({ customerId: "booker" });
      if (step.id === "sign-in-synthetic-booker") return Effect.void;
      return step.execute;
    }) as WorkspaceE2EStepRunner;
    const result = await runBrowserStep({
      browser,
      prepare: (session) =>
        session.use("serve synthetic pricing", async (page) => {
          await page.context().route("**/*", async (route) => {
            if (
              !route.request().isNavigationRequest() ||
              route.request().method() !== "GET"
            ) {
              prematureRequests.push(route.request().method());
              return route.abort();
            }
            loads += 1;
            await route.fulfill({
              contentType: "text/html",
              body: form(loads >= showFromLoad, hasPrice),
            });
          });
        }),
      drive: ({ id, run }) =>
        bound.execute({ run, runStep, session: id }).pipe(
          Effect.provideService(
            E2EDatabase,
            E2EDatabase.of({ db: {} as never })
          ),
          Effect.provideService(WorkspaceE2EHostedPaymentPermitService, {
            withPermit: () =>
              Effect.fail(workspaceE2EError("unexpected payment")),
          }),
          Effect.provideService(WorkspaceE2EProviderVerificationPermitService, {
            withPermit: () =>
              Effect.fail(
                workspaceE2EError("unexpected provider verification")
              ),
          })
        ),
      stepTimeoutMs: 15_000,
    });
    return { loads, submittedWithCalendar, prematureRequests, result };
  } finally {
    submission.mockRestore();
    configured.mockRestore();
    output.mockRestore();
  }
};

test.skipIf(!chromiumAvailable)(
  "requires advertised Calendar 20% before submitting the someone-else referral reservation",
  async () => {
    const { loads, submittedWithCalendar, prematureRequests, result } =
      await exerciseReservationStart({ showFromLoad: 3 });
    expect(submittedWithCalendar).toEqual([true]);
    expect(loads).toBe(3);
    expect(prematureRequests).toEqual([]);
    expect(result.failures).toEqual([
      {
        message: "stopped before synthetic reservation submission",
        timeout: false,
      },
    ]);
  },
  30_000
);

test.skipIf(!chromiumAvailable)(
  "does not submit or retry a broken reservation preparation",
  async () => {
    const { loads, submittedWithCalendar, prematureRequests, result } =
      await exerciseReservationStart({ showFromLoad: 1, hasPrice: false });
    expect(submittedWithCalendar).toEqual([]);
    expect(loads).toBe(2);
    expect(prematureRequests).toEqual([]);
    expect(result.succeeded).toBe(false);
  },
  30_000
);

test.skipIf(!chromiumAvailable)(
  "keeps submission blocked when Calendar never becomes advertised",
  async () => {
    const { submittedWithCalendar, prematureRequests, result } =
      await exerciseReservationStart({
        showFromLoad: Number.POSITIVE_INFINITY,
      });
    expect(submittedWithCalendar).toEqual([]);
    expect(prematureRequests).toEqual([]);
    expect(result.succeeded).toBe(false);
    expect(result.failures[0]?.timeout).toBe(true);
  },
  30_000
);
