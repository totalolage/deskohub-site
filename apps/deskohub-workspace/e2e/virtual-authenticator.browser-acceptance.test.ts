import { afterAll, beforeAll, expect, test } from "bun:test";
import { type Browser, chromium, type Page } from "@playwright/test";
import { playwrightChromiumAvailable } from "@/shared/testing/playwright-browser";
import {
  addVirtualAuthenticator,
  holdsVirtualAuthenticator,
  ModalCeremonyNotAlone,
  type PageVirtualAuthenticator,
} from "./virtual-authenticator";

// Chromium's WebAuthn emulation decides which requests presence answers, so
// these run against a real browser on a localhost secure context.
const chromiumAvailable = await playwrightChromiumAvailable();
let browser: Browser | undefined;
let server: ReturnType<typeof Bun.serve> | undefined;

/**
 * A sign-in form in miniature: `armAutofill` starts the field's conditional
 * request and `pressButton` the button's, which replaces it the way the
 * WebAuthn client library aborts its pending ceremony. `continueAfterSignIn`
 * opens the account after a sign-in, and `failButtonSignIn` makes the
 * server refuse the button's passkey, after which the form re-arms autofill.
 */
const signInDocument = `<!doctype html><html lang="en"><body>
<input autocomplete="username webauthn">
<script>
  window.outcomes = [];
  let pending;
  let opensAccount = false;
  let refusesButton = false;
  const start = (name, mediation) => {
    pending?.abort();
    pending = new AbortController();
    return navigator.credentials
      .get({
        mediation,
        signal: pending.signal,
        publicKey: {
          challenge: crypto.getRandomValues(new Uint8Array(32)),
          rpId: "localhost",
          allowCredentials: [],
        },
      })
      .then(
        () => {
          if (name === "button" && refusesButton) {
            window.outcomes.push("button refused");
            void armAutofill();
            return;
          }
          window.outcomes.push(name + " signed in");
          if (opensAccount) location.assign("/account");
        },
        (error) => window.outcomes.push(name + " " + error.name)
      );
  };
  window.armAutofill = () => start("autofill", "conditional");
  window.pressButton = () => start("button", undefined);
  window.continueAfterSignIn = () => (opensAccount = true);
  window.failButtonSignIn = () => (refusesButton = true);
</script>
</body></html>`;

/** Starts the field's conditional request in the page and returns at once. */
const armAutofill = (page: Page) => page.evaluate("void armAutofill()");

beforeAll(async () => {
  if (!chromiumAvailable) return;
  browser = await chromium.launch({ headless: true });
  server = Bun.serve({
    port: 0,
    fetch: () =>
      new Response(signInDocument, {
        headers: { "content-type": "text/html; charset=utf-8" },
      }),
  });
});

afterAll(async () => {
  await browser?.close();
  await server?.stop(true);
});

/** Opens a page whose authenticator holds one passkey for localhost. */
const withPasskeyPage = async (
  run: (page: Page, authenticator: PageVirtualAuthenticator) => Promise<void>
) => {
  if (!browser || !server)
    throw new Error("The browser has not been launched.");
  const page = await browser.newPage();
  try {
    const authenticator = await addVirtualAuthenticator(page);
    const url = `http://localhost:${server.port}/`;
    await page.goto(url);
    await authenticator.answerCeremony(() =>
      page.evaluate(async () => {
        await navigator.credentials.create({
          publicKey: {
            challenge: crypto.getRandomValues(new Uint8Array(32)),
            rp: { id: "localhost", name: "Workspace" },
            user: {
              id: new Uint8Array([1]),
              name: "customer",
              displayName: "Customer",
            },
            pubKeyCredParams: [{ type: "public-key", alg: -7 }],
            authenticatorSelection: { residentKey: "required" },
          },
        });
      })
    );
    // The init script watches documents loaded after the authenticator.
    await page.goto(url);
    await run(page, authenticator);
  } finally {
    await page.close();
  }
};

const readOutcomes = (page: Page) =>
  page.evaluate<readonly string[]>("window.outcomes");

test.skipIf(!chromiumAvailable)(
  "waits until the document has armed its conditional request",
  async () => {
    await withPasskeyPage(async (page, authenticator) => {
      await expect(
        authenticator.waitForConditionalRequest(250)
      ).rejects.toThrow();

      await armAutofill(page);

      await authenticator.waitForConditionalRequest(5_000);
    });
  }
);

test.skipIf(!chromiumAvailable)(
  "answers the button but not the conditional request armed before it",
  async () => {
    await withPasskeyPage(async (page, authenticator) => {
      await armAutofill(page);
      await authenticator.waitForConditionalRequest(5_000);

      await authenticator.answerCeremony(() => page.evaluate("pressButton()"));

      expect(await readOutcomes(page)).toEqual([
        "autofill AbortError",
        "button signed in",
      ]);
    });
  }
);

test.skipIf(!chromiumAvailable)(
  "answers a conditional request the page arms during a ceremony",
  async () => {
    await withPasskeyPage(async (page, authenticator) => {
      await authenticator.answerCeremony(() => page.evaluate("armAutofill()"));

      expect(await readOutcomes(page)).toEqual(["autofill signed in"]);
    });
  }
);

/** Presses the button and waits until a sign-in has opened the account. */
const pressButtonUntilAccount = async (page: Page) => {
  await page.evaluate("pressButton()");
  await page.waitForURL((url) => url.pathname === "/account", {
    timeout: 5_000,
  });
};

test.skipIf(!chromiumAvailable)(
  "accepts a modal ceremony that signs in alone, across the navigation",
  async () => {
    await withPasskeyPage(async (page, authenticator) => {
      await page.evaluate("continueAfterSignIn()");
      await armAutofill(page);
      await authenticator.waitForConditionalRequest(5_000);

      await authenticator.answerModalCeremony(() =>
        pressButtonUntilAccount(page)
      );
    });
  }
);

test.skipIf(!chromiumAvailable)(
  "rejects a sign-in by the autofill re-armed after a failed button ceremony",
  async () => {
    await withPasskeyPage(async (page, authenticator) => {
      await page.evaluate("continueAfterSignIn()");
      await page.evaluate("failButtonSignIn()");
      await armAutofill(page);
      await authenticator.waitForConditionalRequest(5_000);

      // The account opens all the same, through the re-armed autofill.
      await expect(
        authenticator.answerModalCeremony(() => pressButtonUntilAccount(page))
      ).rejects.toThrow(ModalCeremonyNotAlone);
      expect(new URL(page.url()).pathname).toBe("/account");
    });
  }
);

test.skipIf(!chromiumAvailable)(
  "marks its page while another CDP session's detach would drop its passkey",
  async () => {
    await withPasskeyPage(async (page, authenticator) => {
      expect(holdsVirtualAuthenticator(page)).toBe(true);
      expect(await authenticator.readCredentials()).toHaveLength(1);

      // Why other CDP users must not detach on a marked page: any detach
      // resets the page's virtual authenticator environment.
      const other = await page.context().newCDPSession(page);
      await other.detach();
      await expect(authenticator.readCredentials()).rejects.toThrow(
        "Virtual Authenticator Environment has not been enabled"
      );

      await authenticator.remove().catch(() => undefined);
      expect(holdsVirtualAuthenticator(page)).toBe(false);
    });
  }
);
