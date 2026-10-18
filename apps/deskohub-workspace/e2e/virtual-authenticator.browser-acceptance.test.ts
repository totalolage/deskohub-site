import { afterAll, beforeAll, expect, test } from "bun:test";
import { type Browser, chromium, type Page } from "@playwright/test";
import { playwrightChromiumAvailable } from "@/shared/testing/playwright-browser";
import {
  addVirtualAuthenticator,
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
 * WebAuthn client library aborts its pending ceremony.
 */
const signInDocument = `<!doctype html><html lang="en"><body>
<input autocomplete="username webauthn">
<script>
  window.outcomes = [];
  let pending;
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
        () => window.outcomes.push(name + " signed in"),
        (error) => window.outcomes.push(name + " " + error.name)
      );
  };
  window.armAutofill = () => start("autofill", "conditional");
  window.pressButton = () => start("button", undefined);
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
