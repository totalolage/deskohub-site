import { afterAll, beforeAll, expect, test } from "bun:test";
import { type Browser, chromium, type Page } from "@playwright/test";
import { Effect, Schema } from "effect";
import { workspaceReservationIdSchema } from "@/features/reservation/persistence-contracts";
import { playwrightChromiumAvailable } from "@/shared/testing/playwright-browser";
import { readActiveBrowserTabId, waitForPageUrl } from "../browser";
import {
  failedStepAnnotation,
  runBrowserStep,
} from "../case-runner.browser.test-utils";
import type { WorkspaceE2EConfig } from "../config";
import { redact } from "../redaction";
import { addRedaction } from "../runtime";
import { workspaceE2ETimeouts } from "../timeouts";
import { makeCoworkCheckoutData } from "./data";
import {
  continueToReservationContactStep,
  prepareCheckoutPaymentAttempt,
  submitCheckoutPayment,
  submitPaymentAndWaitForHostedPage,
  submitReservationForPayPage,
  waitForReservationPayPage,
} from "./payment";
import { toReservationStep } from "./reservation-form-preparation";

const chromiumAvailable = await playwrightChromiumAvailable();
let browser: Browser | undefined;

beforeAll(async () => {
  if (chromiumAvailable) browser = await chromium.launch({ headless: true });
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
const redactedOrderId = "39a8d46a-8636-42d1-bc7a-b15a2945c720";
const diagnosticSecret = "synthetic-diagnostic-secret-739182";
const syntheticIdSecret = "reservation-submit";
const date = "2099-09-01";

type Submission = {
  readonly email: string;
  readonly emailConfirmation: string;
  readonly name: string;
  readonly phone: string;
};

type ScenarioState = {
  busyPriceStarts: number;
  readonly submissions: Submission[];
  readonly paymentHandlers: string[];
};

const states = new Map<string, ScenarioState>();
const resetScenario = (scenario: string) => {
  const state: ScenarioState = {
    busyPriceStarts: 0,
    paymentHandlers: [],
    submissions: [],
  };
  states.set(scenario, state);
  return state;
};

const stateFor = (scenario: string) => {
  let state = states.get(scenario);
  if (!state) {
    state = { busyPriceStarts: 0, paymentHandlers: [], submissions: [] };
    states.set(scenario, state);
  }
  return state;
};

const json = (body: unknown) =>
  new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json; charset=utf-8" },
  });

const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(request) {
    const url = new URL(request.url);
    const scenario = url.searchParams.get("scenario") ?? "default";
    const state = stateFor(scenario);

    if (url.pathname.endsWith("/reservation/cowork")) {
      return new Response(reservationPage(scenario), {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }

    if (url.pathname === "/submit" && request.method === "POST") {
      const form = await request.formData();
      state.submissions.push({
        email: String(form.get("email") ?? ""),
        emailConfirmation: String(form.get("emailConfirmation") ?? ""),
        name: String(form.get("name") ?? ""),
        phone: String(form.get("phone") ?? ""),
      });

      if (scenario === "retry-once" && state.submissions.length === 1) {
        return json({ retryable: true });
      }
      if (scenario === "retry-always") {
        return json({
          errorUrl: `/en-US/reservation/cowork?scenario=${scenario}&orderId=${orderId}`,
          retryable: true,
        });
      }
      if (scenario === "no-pay-navigation") return json({ stay: true });

      const payUrl = new URL("/checkout/pay", server.url.origin);
      payUrl.searchParams.set("scenario", scenario);
      if (
        scenario !== "order-in-body" &&
        scenario !== "order-read-overrun" &&
        scenario !== "order-redaction"
      )
        payUrl.searchParams.set("orderId", orderId);
      return json({ redirect: payUrl.toString() });
    }

    if (url.pathname === "/checkout/pay") {
      let id = url.searchParams.get("orderId") ?? orderId;
      if (scenario === "order-redaction") id = redactedOrderId;
      if (scenario === "order-read-overrun") id = "";
      return new Response(payPage(scenario, id), {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }

    if (url.pathname === "/payment-click" && request.method === "POST") {
      state.paymentHandlers.push(url.searchParams.get("handler") ?? "unknown");
      return new Response(null, { status: 204 });
    }

    if (url.pathname === "/busy-price" && request.method === "POST") {
      state.busyPriceStarts += 1;
      return new Response(null, { status: 204 });
    }

    if (url.pathname.startsWith("/hpp/nexi/")) {
      return new Response("<main>Hosted payment</main>", {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }

    if (url.pathname.includes("/reservation/status/")) {
      return new Response("<main>Reservation status</main>", {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }

    return new Response("Not found", { status: 404 });
  },
});

function reservationPage(scenario: string) {
  const stateSecret =
    scenario === "no-pay-navigation" ? `<div>${diagnosticSecret}</div>` : "";
  return `<!doctype html><html lang="en-US"><body>
    ${stateSecret}
    <form id="reservation-form" action="/submit?scenario=${scenario}">
      <div id="selection-slot">
        <input name="date" value="${date}" />
        <button type="button" data-reservation-type-price="open-space" data-reservation-type-price-ready="true">Price</button>
        <input id="reservation-entry-tier-open-space" type="radio" checked />
        <button id="reservation-continue" type="button">Continue</button>
      </div>
      <div id="contact-slot"></div>
    </form>
    <script>
      const scenario = ${JSON.stringify(scenario)};
      const tier = document.querySelector('[data-reservation-type-price="open-space"]');
      const selectedTier = document.querySelector('#reservation-entry-tier-open-space');
      tier.addEventListener('click', () => {
        selectedTier.checked = true;
        if (scenario === 'busy-price') {
          void fetch('/busy-price?scenario=' + scenario, { method: 'POST' });
          setTimeout(() => {
            const until = Date.now() + 40000;
            while (Date.now() < until) {}
          }, 0);
        }
      });
      const hydrate = (element) => { element.__reactProps$test = { onClick: () => {} }; };
      const continueButton = document.querySelector('#reservation-continue');
      if (scenario !== 'never-hydrate') hydrate(continueButton);
      continueButton.addEventListener('click', () => {
        document.querySelector('#selection-slot').remove();
        document.querySelector('#contact-slot').innerHTML = \`
          <input name="name" value="" />
          <input name="email" value="" />
          <input name="emailConfirmation" value="" />
          <input name="phone" value="" />
          <button id="reservation-submit" type="submit">Submit reservation</button>\`;
        const form = document.querySelector('#reservation-form');
        const submit = document.querySelector('#reservation-submit');
        if (scenario !== 'never-hydrate' && scenario !== 'contact-never-hydrate') hydrate(submit);
        if (['preparation-fails', 'preparation-pending', 'step-deadline'].includes(scenario)) submit.disabled = true;
        if (scenario === 'delayed-action') {
          submit.disabled = true;
          setTimeout(() => { submit.disabled = false; }, 2500);
        }
        form.addEventListener('submit', async (event) => {
          event.preventDefault();
          document.querySelector('[data-checkout-error]')?.remove();
          const response = await fetch(form.action, { method: 'POST', body: new FormData(form) });
          const result = await response.json();
          if (result.retryable) {
            const error = document.createElement('div');
            error.dataset.checkoutError = 'true';
            error.textContent = 'Checkout could not be started.';
            document.body.append(error);
            if (result.errorUrl) history.replaceState(null, '', result.errorUrl);
          } else if (result.redirect) {
            location.assign(result.redirect);
          }
        });
      });
      setTimeout(() => {
        if (scenario === 'automatic-pay') location.assign('/checkout/pay?scenario=automatic-pay&orderId=${orderId}');
      }, 100);
    </script>
  </body></html>`;
}

function payPage(scenario: string, id: string) {
  const consent =
    scenario === "consent-missing"
      ? '<div id="checkout-pay-legal-consent"></div>'
      : '<input id="checkout-pay-legal-consent" type="checkbox" /><label for="checkout-pay-legal-consent">I agree to the terms</label>';
  let buttons: string;
  if (scenario === "exact-name") {
    buttons =
      '<button type="button" data-handler="similar">Order and pay 100 Kč</button><button type="button" data-handler="exact">Order and pay</button>';
  } else if (scenario === "pay-link") {
    buttons = `<a href="/payment-click?scenario=${scenario}&handler=link" data-handler="link">Order and pay</a>`;
  } else if (scenario === "exact-name-across-roles") {
    buttons = `<button type="button" data-handler="similar">Order and pay 100 Kč</button><a href="/payment-click?scenario=${scenario}&handler=exact" data-handler="exact">Order and pay</a>`;
  } else {
    buttons = `<button id="checkout-pay-submit" type="button" data-handler="pay"${scenario === "disabled-pay" || scenario === "disabled-pay-step-deadline" ? " disabled" : ""}>Order and pay</button>`;
  }
  return `<!doctype html><html lang="en-US"><body>
    <main>${id}</main>
    ${consent}
    ${buttons}
    <script>
      const scenario = ${JSON.stringify(scenario)};
      const consent = document.querySelector('#checkout-pay-legal-consent');
      if (consent && scenario !== 'consent-never-hydrated') consent.__reactProps$test = {};
      for (const control of document.querySelectorAll('[data-handler]')) {
        control.addEventListener('click', (event) => {
          if (control instanceof HTMLAnchorElement) event.preventDefault();
          if (window.paymentClicks !== undefined) window.paymentClicks++;
          const handler = control.dataset.handler;
          void fetch('/payment-click?scenario=' + scenario + '&handler=' + handler, { method: 'POST' });
          if (scenario === 'hosted-popup' || scenario === 'popup-status') {
            window.open('/hpp/nexi/${id}?scenario=' + scenario, '_blank');
            setTimeout(() => location.assign('/reservation/status/${id}?scenario=' + scenario), 100);
          } else if (scenario === 'hosted-same-tab') {
            location.assign('/hpp/nexi/${id}?scenario=' + scenario);
          }
        });
      }
      if (scenario === 'order-read-overrun') {
        Object.defineProperty(document.body, 'innerText', {
          configurable: true,
          get() {
            const until = Date.now() + 31_000;
            while (Date.now() < until) {}
            return '';
          }
        });
      }
      if (scenario === 'disabled-pay-step-deadline') {
        window.paymentClicks = 0;
        window.paymentButtonFocuses = 0;
        const button = document.querySelector('[data-handler="pay"]');
        button.addEventListener('focus', () => window.paymentButtonFocuses++);
      }
    </script>
  </body></html>`;
}

const shortTimeouts = {
  ...workspaceE2ETimeouts,
  browserAction: 1_000,
  browserNavigation: 4_000,
  checkoutPayControl: 1_000,
  checkoutStart: 4_500,
  providerTransition: 5_000,
  uiTransition: 1_500,
};
const config = {
  baseUrl: server.url.origin,
  timeouts: shortTimeouts,
} as WorkspaceE2EConfig;

const dataFor = (scenario: string) => {
  const data = makeCoworkCheckoutData(
    server.url.origin,
    date,
    `payment-browser-${scenario}`
  );
  const checkoutUrl = new URL(data.checkoutUrl);
  checkoutUrl.searchParams.set("scenario", scenario);
  return { ...data, checkoutUrl: checkoutUrl.toString() };
};

const reservationUrlFor = (scenario: string) => dataFor(scenario).checkoutUrl;
const payUrlFor = (scenario: string) => {
  const url = new URL("/checkout/pay", server.url.origin);
  url.searchParams.set("scenario", scenario);
  url.searchParams.set("orderId", orderId);
  return url.toString();
};
const showReservation =
  (scenario: string) =>
  (session: Parameters<typeof submitReservationForPayPage>[0]["session"]) =>
    session
      .use("show synthetic reservation form", (page) =>
        page.goto(reservationUrlFor(scenario))
      )
      .pipe(Effect.asVoid);
const showPayPage =
  (scenario: string) =>
  (session: Parameters<typeof submitCheckoutPayment>[0]) =>
    session
      .use("show synthetic pay page", (page) => page.goto(payUrlFor(scenario)))
      .pipe(Effect.asVoid);
const preparationFor = (
  data: ReturnType<typeof dataFor>,
  actionTimeoutMs = 5_000
) => ({
  ...toReservationStep(data),
  actionTimeoutMs,
});

const expectSucceeded = (
  result: Awaited<ReturnType<typeof runBrowserStep>>
) => {
  expect(result.succeeded).toBe(true);
  expect(result.annotations).toEqual([]);
  expect(result.failures).toEqual([]);
};

const expectOutcome = (
  result: Awaited<ReturnType<typeof runBrowserStep>>,
  failureKind: "error" | "timeout"
) => {
  expect(result.succeeded).toBe(false);
  expect(result.annotations).toEqual(failedStepAnnotation(failureKind));
  if (failureKind === "error") {
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]?.timeout).toBe(false);
  } else {
    expect(result.failures.length).toBeLessThanOrEqual(1);
    if (result.failures[0]) expect(result.failures[0].timeout).toBe(true);
  }
};

test.skipIf(!chromiumAvailable)(
  "submits the prepared reservation form and reads the order id once",
  async () => {
    const scenario = "reservation-success";
    const state = resetScenario(scenario);
    const data = dataFor(scenario);
    const receivedOrderIds: string[] = [];
    const result = await runBrowserStep({
      browser: requireBrowser(),
      prepare: showReservation(scenario),
      drive: ({ session }) =>
        submitReservationForPayPage({
          onOrderId: (value) => receivedOrderIds.push(value),
          preparation: preparationFor(data),
          session,
          timeouts: shortTimeouts,
        }),
    });

    expectSucceeded(result);
    expect(result.value).toBe(orderId);
    expect(receivedOrderIds).toEqual([orderId]);
    expect(state.submissions).toEqual([
      {
        email: data.email,
        emailConfirmation: data.email,
        name: data.name,
        phone: data.phone,
      },
    ]);
  }
);

test.skipIf(!chromiumAvailable)(
  "reads the order id from the pay page when its URL has none",
  async () => {
    const scenario = "order-in-body";
    resetScenario(scenario);
    const data = dataFor(scenario);
    const result = await runBrowserStep({
      browser: requireBrowser(),
      prepare: showReservation(scenario),
      drive: ({ session }) =>
        submitReservationForPayPage({
          preparation: preparationFor(data),
          session,
          timeouts: shortTimeouts,
        }),
    });

    expectSucceeded(result);
    expect(result.value).toBe(orderId);
  }
);

test.skipIf(!chromiumAvailable)(
  "redacts an order id read from pay page text",
  async () => {
    const scenario = "order-redaction";
    resetScenario(scenario);
    const data = dataFor(scenario);
    const receivedOrderIds: string[] = [];
    const result = await runBrowserStep({
      browser: requireBrowser(),
      prepare: showReservation(scenario),
      drive: ({ session }) => {
        addRedaction(redactedOrderId);
        return submitReservationForPayPage({
          onOrderId: (value) => receivedOrderIds.push(value),
          preparation: preparationFor(data),
          session,
          timeouts: shortTimeouts,
        });
      },
    });

    expectSucceeded(result);
    expect(String(result.value)).not.toBe(redactedOrderId);
    expect(String(result.value)).toBe(redact(redactedOrderId));
    expect(receivedOrderIds).toEqual([redact(redactedOrderId)]);
  }
);

test.skipIf(!chromiumAvailable)(
  "classifies a pay page order id read overrun as a failure",
  async () => {
    const scenario = "order-read-overrun";
    resetScenario(scenario);
    const data = dataFor(scenario);
    const result = await runBrowserStep({
      browser: requireBrowser(),
      prepare: showReservation(scenario),
      drive: ({ session }) =>
        submitReservationForPayPage({
          preparation: preparationFor(data),
          session,
          timeouts: shortTimeouts,
        }),
      stepTimeoutMs: 55_000,
    });

    expectOutcome(result, "error");
    expect(
      result.failures[0]?.message.startsWith("read pay page order id failed")
    ).toBe(true);
  },
  75_000
);

test.skipIf(!chromiumAvailable)(
  "classifies a preparation kickoff overrun as a failure",
  async () => {
    const scenario = "preparation-kickoff-overrun";
    resetScenario(scenario);
    const data = dataFor(scenario);
    const result = await runBrowserStep({
      browser: requireBrowser(),
      prepare: (session) =>
        showReservation(scenario)(session).pipe(
          Effect.andThen(
            session.evaluate(
              "block preparation kickoff",
              () => {
                Object.defineProperty(
                  globalThis,
                  "__deskohubWorkspaceE2EPreparation",
                  {
                    configurable: true,
                    set() {
                      const until = Date.now() + 3_000;
                      while (Date.now() < until) {}
                    },
                  }
                );
              },
              undefined
            )
          )
        ),
      drive: ({ session }) =>
        submitReservationForPayPage({
          preparation: preparationFor(data),
          session,
          timeouts: shortTimeouts,
        }),
      stepTimeoutMs: 10_000,
    });

    expectOutcome(result, "error");
    expect(
      result.failures[0]?.message.startsWith(
        "start checkout reservation preparation failed"
      )
    ).toBe(true);
  }
);

test.skipIf(!chromiumAvailable)(
  "retries one retryable reservation start error",
  async () => {
    const scenario = "retry-once";
    const state = resetScenario(scenario);
    const data = dataFor(scenario);
    const result = await runBrowserStep({
      browser: requireBrowser(),
      prepare: showReservation(scenario),
      drive: ({ session }) =>
        submitReservationForPayPage({
          preparation: preparationFor(data),
          session,
          timeouts: shortTimeouts,
        }),
    });

    expectSucceeded(result);
    expect(result.value).toBe(orderId);
    expect(state.submissions).toHaveLength(2);
    expect(state.submissions).toEqual([
      {
        email: data.email,
        emailConfirmation: data.email,
        name: data.name,
        phone: data.phone,
      },
      {
        email: data.email,
        emailConfirmation: data.email,
        name: data.name,
        phone: data.phone,
      },
    ]);
  }
);

test.skipIf(!chromiumAvailable)(
  "fails after one retryable reservation start error retry and reports its order id",
  async () => {
    const scenario = "retry-always";
    const state = resetScenario(scenario);
    const data = dataFor(scenario);
    const receivedOrderIds: string[] = [];
    const result = await runBrowserStep({
      browser: requireBrowser(),
      prepare: showReservation(scenario),
      drive: ({ session }) =>
        submitReservationForPayPage({
          onOrderId: (value) => receivedOrderIds.push(value),
          preparation: preparationFor(data),
          session,
          timeouts: shortTimeouts,
        }),
    });

    expectOutcome(result, "error");
    expect(result.failures[0]?.message).toContain("after one retry");
    expect(state.submissions).toHaveLength(2);
    expect(receivedOrderIds).toEqual([orderId]);
  }
);

test.skipIf(!chromiumAvailable)(
  "waits for detached reservation preparation beyond one evaluation",
  async () => {
    const scenario = "delayed-action";
    resetScenario(scenario);
    const data = dataFor(scenario);
    const result = await runBrowserStep({
      browser: requireBrowser(),
      prepare: showReservation(scenario),
      drive: ({ session }) =>
        submitReservationForPayPage({
          preparation: preparationFor(data, 6_000),
          session,
          timeouts: shortTimeouts,
        }),
    });

    expectSucceeded(result);
    expect(result.value).toBe(orderId);
  }
);

test.skipIf(!chromiumAvailable)(
  "reports a redacted preparation failure without submitting",
  async () => {
    const scenario = "preparation-fails";
    const state = resetScenario(scenario);
    const data = dataFor(scenario);
    const result = await runBrowserStep({
      browser: requireBrowser(),
      prepare: showReservation(scenario),
      drive: ({ session }) => {
        addRedaction(syntheticIdSecret);
        return submitReservationForPayPage({
          preparation: preparationFor(data, 500),
          session,
          timeouts: shortTimeouts,
        });
      },
    });

    expectOutcome(result, "error");
    expect(result.failures[0]?.message).toContain("button stayed disabled");
    expect(result.failures[0]?.message).not.toContain(syntheticIdSecret);
    expect(state.submissions).toEqual([]);
  }
);

test.skipIf(!chromiumAvailable)(
  "times out checkout start while preparation is still pending",
  async () => {
    const scenario = "preparation-pending";
    resetScenario(scenario);
    const data = dataFor(scenario);
    const result = await runBrowserStep({
      browser: requireBrowser(),
      prepare: showReservation(scenario),
      drive: ({ session }) =>
        submitReservationForPayPage({
          preparation: preparationFor(data, 8_000),
          session,
          timeouts: { ...shortTimeouts, checkoutStart: 1_200 },
        }),
      stepTimeoutMs: 7_000,
    });

    expectOutcome(result, "timeout");
  }
);

test.skipIf(!chromiumAvailable)(
  "times out when the reservation action never hydrates",
  async () => {
    const scenario = "never-hydrate";
    resetScenario(scenario);
    const data = dataFor(scenario);
    const result = await runBrowserStep({
      browser: requireBrowser(),
      prepare: showReservation(scenario),
      drive: ({ session }) =>
        submitReservationForPayPage({
          preparation: preparationFor(data),
          session,
          timeouts: shortTimeouts,
        }),
      stepTimeoutMs: 5_000,
    });

    expectOutcome(result, "timeout");
  }
);

test.skipIf(!chromiumAvailable)(
  "classifies an overlong page state read as a failure",
  async () => {
    const scenario = "busy-price";
    const state = resetScenario(scenario);
    const data = dataFor(scenario);
    const result = await runBrowserStep({
      browser: requireBrowser(),
      prepare: showReservation(scenario),
      drive: ({ session }) =>
        submitReservationForPayPage({
          preparation: preparationFor(data, 48_000),
          session,
          timeouts: { ...shortTimeouts, checkoutStart: 52_000 },
        }),
      stepTimeoutMs: 55_000,
    });

    expectOutcome(result, "error");
    expect(result.failures[0]?.message).toContain(
      "read checkout reservation preparation state failed"
    );
    expect(state.busyPriceStarts).toBe(1);
  },
  90_000
);

test.skipIf(!chromiumAvailable)(
  "fails with redacted diagnostics when reservation submission never reaches pay",
  async () => {
    const scenario = "no-pay-navigation";
    const state = resetScenario(scenario);
    const data = dataFor(scenario);
    const result = await runBrowserStep({
      browser: requireBrowser(),
      prepare: showReservation(scenario),
      drive: ({ session }) => {
        addRedaction(diagnosticSecret);
        return submitReservationForPayPage({
          preparation: preparationFor(data),
          session,
          timeouts: { ...shortTimeouts, checkoutStart: 1_200 },
        });
      },
    });

    expectOutcome(result, "error");
    expect(result.failures[0]?.message).toContain(
      "Timed out waiting for checkout pay page"
    );
    expect(result.failures[0]?.message).toContain("Browser diagnostics:");
    expect(result.failures[0]?.message).not.toContain(diagnosticSecret);
    expect(state.submissions).toHaveLength(1);
  }
);

test.skipIf(!chromiumAvailable)(
  "stops a pending preparation at the step deadline without submitting later",
  async () => {
    const scenario = "step-deadline";
    const state = resetScenario(scenario);
    const data = dataFor(scenario);
    const result = await runBrowserStep({
      browser: requireBrowser(),
      prepare: showReservation(scenario),
      drive: ({ session }) =>
        submitReservationForPayPage({
          preparation: preparationFor(data, 8_000),
          session,
          timeouts: { ...shortTimeouts, checkoutStart: 10_000 },
        }),
      stepTimeoutMs: 1_500,
      afterStep: () =>
        Effect.promise(
          () => new Promise<void>((resolve) => setTimeout(resolve, 1_000))
        ).pipe(
          Effect.tap(() =>
            Effect.sync(() => expect(state.submissions).toEqual([]))
          )
        ),
    });

    expectOutcome(result, "timeout");
    expect(state.submissions).toEqual([]);
  }
);

test.skipIf(!chromiumAvailable)(
  "waits for a reservation page that navigates to pay on its own",
  async () => {
    const scenario = "automatic-pay";
    resetScenario(scenario);
    const result = await runBrowserStep({
      browser: requireBrowser(),
      prepare: showReservation(scenario),
      drive: ({ session }) =>
        waitForReservationPayPage({ session, timeouts: shortTimeouts }),
    });

    expectSucceeded(result);
    expect(result.value).toBe(orderId);
  }
);

test.skipIf(!chromiumAvailable)(
  "times out when the reservation contact step never hydrates",
  async () => {
    const scenario = "contact-never-hydrate";
    resetScenario(scenario);
    const result = await runBrowserStep({
      browser: requireBrowser(),
      prepare: showReservation(scenario),
      drive: ({ session }) =>
        continueToReservationContactStep({ session, timeouts: shortTimeouts }),
      stepTimeoutMs: 5_000,
    });

    expectOutcome(result, "timeout");
  }
);

test.skipIf(!chromiumAvailable)(
  "opens the checkout URL and submits the synthetic reservation",
  async () => {
    const scenario = "open-checkout-url";
    const state = resetScenario(scenario);
    const data = dataFor(scenario);
    const result = await runBrowserStep({
      browser: requireBrowser(),
      prepare: () => Effect.void,
      drive: ({ session }) =>
        prepareCheckoutPaymentAttempt({
          config,
          data,
          preparation: preparationFor(data),
          session,
        }),
    });

    expectSucceeded(result);
    expect(result.value).toBe(orderId);
    expect(state.submissions).toHaveLength(1);
  }
);

test.skipIf(!chromiumAvailable)(
  "uses Space consent and exact accessible-name preference for payment",
  async () => {
    const scenario = "exact-name";
    const state = resetScenario(scenario);
    let initialPage: Page | undefined;
    const result = await runBrowserStep({
      browser: requireBrowser(),
      prepare: (session) =>
        session
          .use("show synthetic pay page", async (page) => {
            initialPage = page;
            await page.goto(payUrlFor(scenario));
          })
          .pipe(Effect.asVoid),
      drive: ({ session }) =>
        Effect.gen(function* () {
          const returnedPage = yield* submitCheckoutPayment(
            session,
            shortTimeouts
          );
          const wasChecked = yield* session.use(
            "read synthetic consent state",
            (page) => page.locator("#checkout-pay-legal-consent").isChecked()
          );
          return { returnedPage, wasChecked };
        }),
    });

    expectSucceeded(result);
    expect(result.value?.returnedPage).toBe(initialPage);
    expect(result.value?.wasChecked).toBe(true);
    expect(state.paymentHandlers).toEqual(["exact"]);
  }
);

test.skipIf(!chromiumAvailable)(
  "activates a pay link named like the pay button",
  async () => {
    const scenario = "pay-link";
    const state = resetScenario(scenario);
    const result = await runBrowserStep({
      browser: requireBrowser(),
      prepare: showPayPage(scenario),
      drive: ({ session }) => submitCheckoutPayment(session, shortTimeouts),
    });

    expectSucceeded(result);
    expect(state.paymentHandlers).toEqual(["link"]);
  }
);

test.skipIf(!chromiumAvailable)(
  "prefers the exact accessible name across payment control roles",
  async () => {
    const scenario = "exact-name-across-roles";
    const state = resetScenario(scenario);
    const result = await runBrowserStep({
      browser: requireBrowser(),
      prepare: showPayPage(scenario),
      drive: ({ session }) => submitCheckoutPayment(session, shortTimeouts),
    });

    expectSucceeded(result);
    expect(state.paymentHandlers).toEqual(["exact"]);
  }
);

test.skipIf(!chromiumAvailable)(
  "times out when focusing payment consent exceeds its browser-action deadline",
  async () => {
    const scenario = "payment-focus-deadline";
    const state = resetScenario(scenario);
    let consentChecked: boolean | undefined;
    const result = await runBrowserStep({
      browser: requireBrowser(),
      prepare: showPayPage(scenario),
      drive: ({ session }) =>
        submitCheckoutPayment(session, { ...shortTimeouts, browserAction: 1 }),
      afterStep: ({ session }) =>
        session
          .use("read consent after payment step", (page) =>
            page.locator("#checkout-pay-legal-consent").isChecked()
          )
          .pipe(
            Effect.tap((checked) =>
              Effect.sync(() => {
                consentChecked = checked;
              })
            ),
            Effect.asVoid
          ),
    });

    expectOutcome(result, "timeout");
    expect(consentChecked).toBe(false);
    expect(state.paymentHandlers).toEqual([]);
  }
);

test.skipIf(!chromiumAvailable)(
  "fails when payment legal consent is absent",
  async () => {
    const scenario = "consent-missing";
    const state = resetScenario(scenario);
    const result = await runBrowserStep({
      browser: requireBrowser(),
      prepare: showPayPage(scenario),
      drive: ({ session }) => submitCheckoutPayment(session, shortTimeouts),
    });

    expectOutcome(result, "error");
    expect(result.failures[0]?.message).toContain(
      "payment legal consent failed"
    );
    expect(state.paymentHandlers).toEqual([]);
  }
);

test.skipIf(!chromiumAvailable)(
  "times out when payment legal consent never hydrates",
  async () => {
    const scenario = "consent-never-hydrated";
    resetScenario(scenario);
    const result = await runBrowserStep({
      browser: requireBrowser(),
      prepare: showPayPage(scenario),
      drive: ({ session }) => submitCheckoutPayment(session, shortTimeouts),
      stepTimeoutMs: 5_000,
    });

    expectOutcome(result, "timeout");
  }
);

test.skipIf(!chromiumAvailable)(
  "fails when the payment submit button stays disabled",
  async () => {
    const scenario = "disabled-pay";
    const state = resetScenario(scenario);
    const result = await runBrowserStep({
      browser: requireBrowser(),
      prepare: showPayPage(scenario),
      drive: ({ session }) => submitCheckoutPayment(session, shortTimeouts),
    });

    expectOutcome(result, "error");
    expect(result.failures[0]?.message).toContain(
      "enabled payment submit button failed"
    );
    expect(state.paymentHandlers).toEqual([]);
  }
);

test.skipIf(!chromiumAvailable)(
  "does not activate or focus a pay button enabled after the step deadline",
  async () => {
    const scenario = "disabled-pay-step-deadline";
    resetScenario(scenario);
    let afterDeadline:
      | {
          activeElementId: string;
          clickCount: number;
          focusCount: number;
        }
      | undefined;
    const result = await runBrowserStep({
      browser: requireBrowser(),
      prepare: showPayPage(scenario),
      drive: ({ session }) =>
        submitCheckoutPayment(session, {
          ...shortTimeouts,
          checkoutPayControl: 15_000,
        }),
      stepTimeoutMs: 2_500,
      afterStep: ({ session }) =>
        session
          .use("observe delayed payment button", async (page) => {
            await page.evaluate(() => {
              setTimeout(() => {
                const button = document.querySelector<HTMLButtonElement>(
                  '[data-handler="pay"]'
                );
                if (button) button.disabled = false;
              }, 100);
            });
            await page.waitForTimeout(1_000);
            afterDeadline = await page.evaluate(() => ({
              activeElementId:
                (document.activeElement as HTMLElement | null)?.id ?? "",
              clickCount: (window as typeof window & { paymentClicks: number })
                .paymentClicks,
              focusCount: (
                window as typeof window & { paymentButtonFocuses: number }
              ).paymentButtonFocuses,
            }));
          })
          .pipe(Effect.asVoid),
    });

    expectOutcome(result, "timeout");
    expect(afterDeadline?.activeElementId).not.toBe("checkout-pay-submit");
    expect(afterDeadline?.clickCount).toBe(0);
    expect(afterDeadline?.focusCount).toBe(0);
  }
);

test.skipIf(!chromiumAvailable)(
  "reactivates the checkout page after payment opens a popup and status navigation",
  async () => {
    const scenario = "popup-status";
    resetScenario(scenario);
    let checkoutPage: Page | undefined;
    let popupFollowed = false;
    const result = await runBrowserStep({
      browser: requireBrowser(),
      prepare: showPayPage(scenario),
      drive: ({ session }) =>
        submitCheckoutPayment(session, shortTimeouts).pipe(
          Effect.tap((page) =>
            Effect.sync(() => {
              checkoutPage = page;
            })
          )
        ),
      afterStep: ({ session }) =>
        Effect.gen(function* () {
          const opener = checkoutPage;
          if (!opener) throw new Error("checkout page was not returned");
          // Playwright reports the popup some time after the pay handler
          // opened it, and the session makes it active only then. Activating
          // the checkout page before that lets the late popup take over.
          const popup = yield* session.use(
            "wait for the payment popup",
            async () => {
              const context = opener.context();
              return (
                context.pages().find((page) => page !== opener) ??
                (await context.waitForEvent("page", {
                  timeout: shortTimeouts.providerTransition,
                }))
              );
            }
          );
          popupFollowed = yield* session.use(
            "read the active page",
            async (page) => page === popup
          );
          yield* session.activate(opener);
          yield* waitForPageUrl({
            description: "checkout status page in original tab",
            matches: (url) => url.includes("/reservation/status/"),
            session,
            timeoutMs: shortTimeouts.providerTransition,
          });
        }),
    });

    expectSucceeded(result);
    expect(popupFollowed).toBe(true);
    expect(checkoutPage?.url()).toContain("/reservation/status/");
  }
);

const runHostedCrossing = (scenario: string) => {
  return runBrowserStep({
    browser: requireBrowser(),
    prepare: showPayPage(scenario),
    drive: ({ id, run }) =>
      Effect.gen(function* () {
        const hosted = yield* submitPaymentAndWaitForHostedPage({
          run,
          session: id,
          timeouts: shortTimeouts,
        });
        const activeTabId = yield* readActiveBrowserTabId(run, id);
        return { ...hosted, activeTabId };
      }),
  });
};

test.skipIf(!chromiumAvailable)(
  "tracks hosted payment in a popup and checkout status in its original tab",
  async () => {
    const scenario = "hosted-popup";
    const state = resetScenario(scenario);
    const result = await runHostedCrossing(scenario);

    expectSucceeded(result);
    expect(result.value?.checkoutTabId).not.toBe(
      result.value?.hostedPaymentTabId
    );
    expect(result.value?.activeTabId).toBe(result.value?.hostedPaymentTabId);
    expect(result.value?.checkoutPageUrl).toBe(payUrlFor(scenario));
    expect(result.value?.url).toContain("/hpp/nexi/");
    expect(result.value?.hostedPaymentTabId).toBeTruthy();
    expect(state.paymentHandlers).toEqual(["pay"]);
  }
);

test.skipIf(!chromiumAvailable)(
  "tracks hosted payment when checkout navigates in the same tab",
  async () => {
    const scenario = "hosted-same-tab";
    const state = resetScenario(scenario);
    const result = await runHostedCrossing(scenario);

    expectSucceeded(result);
    expect(result.value?.checkoutTabId).toBe(result.value?.hostedPaymentTabId);
    expect(result.value?.activeTabId).toBe(result.value?.hostedPaymentTabId);
    expect(result.value?.checkoutPageUrl).toBe(payUrlFor(scenario));
    expect(result.value?.url).toContain("/hpp/nexi/");
    expect(result.value?.hostedPaymentTabId).toBeTruthy();
    expect(state.paymentHandlers).toEqual(["pay"]);
  }
);

test.skipIf(!chromiumAvailable)(
  "fails when the active browser tab is closed before payment",
  async () => {
    const scenario = "closed-active-page";
    resetScenario(scenario);
    const result = await runBrowserStep({
      browser: requireBrowser(),
      prepare: showPayPage(scenario),
      drive: ({ session }) =>
        Effect.gen(function* () {
          yield* session.use("close active page", (page) => page.close());
          return yield* submitCheckoutPayment(session, shortTimeouts);
        }),
    });

    expectOutcome(result, "error");
    expect(result.failures[0]?.message).toContain(
      "read active browser tab failed"
    );
  }
);
