import type { Page } from "@playwright/test";
import type { BrowserStepDriver } from "../case-runner.browser.test-utils";
import { workspaceE2ETimeouts } from "../timeouts";
import { makeCoworkCheckoutData } from "./data";
import {
  completeNexiHostedPayment,
  type HostedPaymentPage,
  type NexiChallengeOutcome,
} from "./nexi-hosted-payment";
import { nexiSandboxTestCard } from "./nexi-sandbox-test-card";

export type HostedScenario = {
  readonly fallback?: boolean;
  readonly continueOutcome?: "reject" | "error" | "failure" | "stall";
  readonly directReturn?: boolean;
  readonly snapshotGap?: boolean;
  readonly rejectionBaseline?: boolean;
  readonly returnActivation?: "navigate-and-reject" | "reject";
  readonly popup?: boolean;
  readonly keepPopup?: boolean;
  readonly disabledChallenge?: boolean;
};

type HostedState = {
  readonly options: HostedScenario;
  readonly actions: string[];
  readonly authorizationActions: string[][];
  readonly fields: Map<
    string,
    { nonempty: boolean; typed: boolean; correct: boolean }
  >;
  gaps: number;
};

const fieldNames = [
  ["card_number", "Card number"],
  ["expiration_date", "Expiration date"],
  ["security_code", "CVV"],
  ["cardholder_name", "First Name"],
  ["cardholder_email", "Email"],
] as const;
const checkoutData = makeCoworkCheckoutData(
  "https://workspace.example.test",
  "2099-09-01",
  "nexi-driver"
);
const expectedFields = {
  card_number: nexiSandboxTestCard.number,
  expiration_date: nexiSandboxTestCard.expiry,
  security_code: nexiSandboxTestCard.cvv,
  cardholder_name: checkoutData.name,
  cardholder_email: checkoutData.email,
};
const states = new Map<string, HostedState>();
const hostedOrigin = "https://xpay.nexigroup.com";
const html = (body: string) =>
  new Response(`<!doctype html><html><body>${body}</body></html>`, {
    headers: { "content-type": "text/html; charset=utf-8" },
  });

// The server records only state and event kinds, never field contents.
export const hostedPaymentServer = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(request) {
    const url = new URL(request.url);
    const id = url.searchParams.get("scenario") ?? "";
    const state = states.get(id);
    if (!state) return new Response(null, { status: 404 });
    const query = `?scenario=${id}`;
    if (url.pathname === "/event") {
      state.actions.push(url.searchParams.get("action") ?? "unknown");
      return new Response(null, { status: 204 });
    }
    if (url.pathname === "/field-state") {
      state.fields.set(url.searchParams.get("field") ?? "", {
        nonempty: url.searchParams.get("nonempty") === "true",
        typed: url.searchParams.get("typed") === "true",
        correct: url.searchParams.get("correct") === "true",
      });
      return new Response(null, { status: 204 });
    }
    if (url.pathname === "/fe/build/text") {
      return new Response("{}", {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    }
    if (url.pathname === "/field") {
      const entry = fieldNames.find(
        ([key]) => key === url.searchParams.get("field")
      );
      if (!entry) return new Response(null, { status: 404 });
      const [field, label] = entry;
      return html(`<input aria-label="${label}"><script>
        const input = document.querySelector('input');
        let typed = false;
        input.addEventListener('keydown', () => { typed = true; });
        input.addEventListener('input', () => {
          if (${state.options.fallback === true && field === "card_number"} && !typed) input.value = '';
          fetch('/field-state${query}&field=${field}&nonempty=' + Boolean(input.value.trim()) + '&typed=' + typed + '&correct=' + (input.value === ${JSON.stringify(expectedFields[field])}), {method:'POST'});
        });
      </script>`);
    }
    if (url.pathname.startsWith("/reservation/status/")) {
      return html(
        `<main data-status>Returned</main>${state.options.popup && !state.options.keepPopup && !url.searchParams.has("checkout") ? "<script>setTimeout(() => window.close(), 500)</script>" : ""}`
      );
    }
    if (url.pathname === "/checkout") {
      return html(
        `<a id="open" target="_blank" href="${hostedOrigin}/hpp/nexi/card${query}">Open hosted payment</a>`
      );
    }
    if (url.pathname === "/gap") {
      state.gaps += 1;
      return html(
        `<script>setTimeout(() => location.href='/hpp/nexi/challenge${query}', 1400)</script>`
      );
    }
    const frameMarkup = fieldNames
      .map(
        ([field]) =>
          `<iframe title="${field}" src="/field${query}&field=${field}"></iframe>`
      )
      .join("");
    const view = url.pathname.split("/").at(-1);
    const heading =
      new Map([
        ["error", "<h1>Payment error</h1>"],
        ["failure", "<h1>OPS! Something went wrong</h1>"],
      ]).get(view ?? "") ?? "";
    const views = new Map([
      [
        "card",
        `${frameMarkup}<button data-action="continue">Continue</button>`,
      ],
      ["pay", '<button data-action="pay">Pay</button>'],
      [
        "challenge",
        `<button data-action="challenge" ${state.options.disabledChallenge ? "disabled" : ""}>Authentication successful</button><button data-action="challenge_failure" ${state.options.disabledChallenge ? "disabled" : ""}>Authentication failed</button>`,
      ],
    ]);
    const content =
      views.get(view ?? "") ??
      `${heading}<button data-action="return" ${state.options.returnActivation ? 'data-reject="true"' : ""}>Back to the shop</button>`;
    return html(`${content}<script>
      document.addEventListener('click', async event => {
        const action = event.target.dataset.action;
        if (!action) return;
        await fetch('/event${query}&action=' + action, {method:'POST'});
        if (action === 'continue') {
          const outcome = ${JSON.stringify(state.options.continueOutcome ?? "pay")};
          if (outcome === 'reject') {
            await fetch('/fe/build/text${query}', {method:'POST'});
            document.querySelector('button').disabled = true;
            for (const frame of document.querySelectorAll('iframe')) frame.contentDocument.querySelector('input').disabled = true;
            return;
          }
          if (outcome === 'stall') return;
          location.href = '/hpp/nexi/' + outcome + '${query}';
        } else if (action === 'pay') {
          location.href = '${state.options.snapshotGap ? "/gap" : "/hpp/nexi/challenge"}${query}';
        } else if (action === 'challenge_failure') {
          location.href = '/hpp/nexi/error${query}';
        } else if (action === 'challenge' && !${state.options.directReturn === true}) {
          location.href = '/hpp/nexi/return${query}';
        } else if (${state.options.returnActivation !== "reject"}) {
          location.href = '/reservation/status/synthetic${query}';
        }
      });
    </script>`);
  },
});

export const prepareHostedPayment = (id: string, options: HostedScenario) => {
  const state: HostedState = {
    actions: [],
    authorizationActions: [],
    fields: new Map(),
    gaps: 0,
    options,
  };
  states.set(id, state);
  let hostedPaymentPage: HostedPaymentPage | undefined;
  let restoreKeyboard: (() => void) | undefined;
  const prepare = (session: BrowserStepDriver["session"]) =>
    session.use("prepare synthetic hosted payment", async (checkoutPage) => {
      const context = checkoutPage.context();
      await context.route(`${hostedOrigin}/**`, async (route) => {
        const source = new URL(route.request().url());
        const response = await fetch(
          new URL(source.pathname + source.search, hostedPaymentServer.url),
          {
            method: route.request().method(),
          }
        );
        await route.fulfill({
          status: response.status,
          headers: Object.fromEntries(response.headers),
          body: await response.text(),
        });
      });
      const query = `?scenario=${id}`;
      const checkoutPageUrl = `${hostedOrigin}/checkout${query}`;
      let page: Page = checkoutPage;
      if (options.popup) {
        await checkoutPage.goto(checkoutPageUrl);
        const opened = context.waitForEvent("page", { timeout: 10_000 });
        await checkoutPage.locator("#open").click({ timeout: 10_000 });
        page = await opened;
        await page.waitForLoadState("load", { timeout: 10_000 });
        await checkoutPage.goto(
          `${hostedOrigin}/reservation/status/synthetic${query}&checkout=true`
        );
      } else {
        await page.goto(`${hostedOrigin}/hpp/nexi/card${query}`);
      }
      for (const frame of page.frames().slice(1)) {
        await frame
          .locator("input")
          .waitFor({ state: "visible", timeout: 10_000 });
      }
      if (options.rejectionBaseline) {
        const response = page.waitForResponse(
          (response) => response.url().includes("/fe/build/text"),
          { timeout: 10_000 }
        );
        await page.evaluate(async (query) => {
          await fetch(`/fe/build/text${query}`, { method: "POST" });
        }, query);
        await response;
        // A real completed response enters the session log before the driver baselines it.
        await page.waitForLoadState("load");
      }
      if (options.returnActivation) {
        // Inject a transport error after the real keyboard activation. This is
        // the native Playwright object, shared by the argv and session drivers.
        const original = page.keyboard.press.bind(page.keyboard);
        page.keyboard.press = async (...args) => {
          const reject = await page.evaluate(() =>
            document.activeElement?.hasAttribute("data-reject")
          );
          await original(...args);
          if (reject) {
            if (options.returnActivation === "navigate-and-reject") {
              await page.waitForURL(/\/reservation\/status\//, {
                timeout: 10_000,
              });
            }
            throw new Error("Synthetic activation transport error");
          }
        };
        restoreKeyboard = () => {
          page.keyboard.press = original;
        };
      }
      hostedPaymentPage = {
        checkoutPage,
        checkoutPageUrl,
        page,
        url: page.url(),
      };
    });
  return {
    state,
    prepare,
    restore: () => {
      restoreKeyboard?.();
      states.delete(id);
    },
    payment: (
      driver: BrowserStepDriver,
      options: {
        challengeOutcome?: NexiChallengeOutcome;
        onPaymentAuthorizationRequested?: () => void;
        providerTransition?: number;
      } = {}
    ) =>
      completeNexiHostedPayment({
        data: checkoutData,
        hostedPaymentPage,
        challengeOutcome: options.challengeOutcome,
        onPaymentAuthorizationRequested: options.onPaymentAuthorizationRequested
          ? () => {
              state.authorizationActions.push([...state.actions]);
              options.onPaymentAuthorizationRequested?.();
            }
          : undefined,
        session: driver.session,
        timeouts: {
          ...workspaceE2ETimeouts,
          providerTransition: options.providerTransition ?? 30_000,
        },
      }),
  };
};
