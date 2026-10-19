import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Browser, chromium, type Page } from "@playwright/test";
import {
  addVirtualAuthenticator,
  type PageVirtualAuthenticator,
} from "@/e2e/virtual-authenticator";
import { playwrightChromiumAvailable } from "@/shared/testing/playwright-browser";

/*
 * Runs the page's passkey sign-in attempts in Chromium with a virtual
 * authenticator, against stand-ins for the Better Auth passkey endpoints:
 * each options response sets the browser's one challenge cookie, and the
 * verification fails unless that cookie names the challenge the passkey
 * signed, as the server's does.
 */

const chromiumAvailable = await playwrightChromiumAvailable();
const challengeCookie = "better-auth-passkey";
const optionsPath = "/api/auth/passkey/generate-authenticate-options";

/** When the server answers one options request: headers, then the body. */
type OptionsExchange = {
  readonly headersSent?: Promise<void>;
  readonly bodySent?: Promise<void>;
};

let browser: Browser | undefined;
let server: ReturnType<typeof Bun.serve> | undefined;
let buildDirectory = "";
let harness = "";

/** The challenges issued so far, by the cookie value naming each. */
const challenges = new Map<string, string>();
let exchanges: OptionsExchange[] = [];
let arrivals: PromiseWithResolvers<void>[] = [];
let verifications: { readonly cookie?: string; readonly matched: boolean }[] =
  [];

const arrival = (index: number) => {
  arrivals[index] ??= Promise.withResolvers<void>();
  return arrivals[index];
};

const answerOptions = async () => {
  const index = challenges.size;
  const id = `challenge-${index + 1}`;
  const challenge = Buffer.from(
    crypto.getRandomValues(new Uint8Array(32))
  ).toString("base64url");
  challenges.set(id, challenge);
  arrival(index).resolve();
  const { headersSent, bodySent } = exchanges[index] ?? {};
  await headersSent;
  const body = JSON.stringify({
    challenge,
    rpId: "localhost",
    userVerification: "preferred",
    timeout: 60_000,
  });
  const headers = {
    "content-type": "application/json",
    "set-cookie": `${challengeCookie}=${id}; Path=/; HttpOnly; SameSite=Lax`,
  };
  if (bodySent === undefined) return new Response(body, { headers });
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream({
      start(controller) {
        // Leading whitespace sends the headers and keeps the JSON valid.
        controller.enqueue(encoder.encode(" "));
        void bodySent.then(() => {
          try {
            controller.enqueue(encoder.encode(body));
            controller.close();
          } catch {
            // The browser abandoned the response.
          }
        });
      },
    }),
    { headers }
  );
};

const answerVerification = async (request: Request) => {
  const cookie = new RegExp(`${challengeCookie}=([^;]+)`).exec(
    request.headers.get("cookie") ?? ""
  )?.[1];
  const { response } = (await request.json()) as {
    readonly response: { readonly response: { clientDataJSON: string } };
  };
  const clientData = JSON.parse(
    Buffer.from(response.response.clientDataJSON, "base64url").toString()
  ) as { readonly challenge: string };
  const matched =
    cookie !== undefined && challenges.get(cookie) === clientData.challenge;
  verifications.push({ cookie, matched });
  return matched
    ? Response.json({ session: {}, user: { id: "account-1" } })
    : Response.json(
        { code: "AUTHENTICATION_FAILED", message: "Authentication failed" },
        { status: 400 }
      );
};

beforeAll(async () => {
  if (!chromiumAvailable) return;
  buildDirectory = await mkdtemp(join(tmpdir(), "passkey-sign-in-browser-"));
  const build = await Bun.build({
    entrypoints: [join(import.meta.dir, "passkey-sign-in.browser-harness.ts")],
    format: "iife",
    naming: "harness.js",
    outdir: buildDirectory,
    target: "browser",
  });
  if (!build.success) {
    throw new Error(build.logs.map(({ message }) => message).join("\n"));
  }
  harness = await Bun.file(join(buildDirectory, "harness.js")).text();
  browser = await chromium.launch({ headless: true });
  server = Bun.serve({
    port: 0,
    idleTimeout: 0,
    fetch: (request) => {
      const { pathname } = new URL(request.url);
      if (pathname === optionsPath) return answerOptions();
      if (pathname === "/api/auth/passkey/verify-authentication") {
        return answerVerification(request);
      }
      if (pathname === "/harness.js") {
        return new Response(harness, {
          headers: { "content-type": "text/javascript" },
        });
      }
      return new Response(
        '<!doctype html><html lang="en"><body><input autocomplete="username webauthn"><script src="/harness.js"></script></body></html>',
        { headers: { "content-type": "text/html; charset=utf-8" } }
      );
    },
  });
});

afterAll(async () => {
  await browser?.close();
  await server?.stop(true);
  if (buildDirectory) {
    await rm(buildDirectory, { force: true, recursive: true });
  }
});

beforeEach(() => {
  challenges.clear();
  exchanges = [];
  arrivals = [];
  verifications = [];
});

/** Opens the page with an authenticator that holds one localhost passkey. */
const withPasskeyPage = async (
  run: (page: Page, authenticator: PageVirtualAuthenticator) => Promise<void>
) => {
  if (!browser || !server) throw new Error("The browser has not launched.");
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
    // The authenticator watches documents loaded after it was added.
    await page.goto(url);
    await run(page, authenticator);
  } finally {
    await page.close();
  }
};

const waitForOutcomes = (page: Page, count: number) =>
  page.waitForFunction(
    `globalThis.passkeyOutcomes.length >= ${count}`,
    undefined,
    { timeout: 10_000 }
  );

const readOutcomes = (page: Page) =>
  page.evaluate<readonly string[]>("globalThis.passkeyOutcomes");

const readChallengeCookie = async (page: Page) =>
  (await page.context().cookies()).find(
    (cookie) => cookie.name === challengeCookie
  )?.value;

/**
 * Fails unless one verification passed, with a challenge cookie that is
 * not the first attempt's and is still the browser's. Chromium may retry an
 * options request on a stale connection, so the cookie's number varies.
 */
const expectVerifiedAfterFirstAttempt = async (page: Page) => {
  expect(verifications.map(({ matched }) => matched)).toEqual([true]);
  const [{ cookie } = {}] = verifications;
  expect(cookie).not.toBe("challenge-1");
  expect(await readChallengeCookie(page)).toBe(cookie);
};

/** Lets a response the server sent reach the browser, had it kept waiting. */
const settleNetwork = () => new Promise((resolve) => setTimeout(resolve, 250));

test.skipIf(!chromiumAvailable)(
  "signs in with the button when autofill's options answer after the button's",
  async () => {
    const autofillAnswered = Promise.withResolvers<void>();
    const buttonBody = Promise.withResolvers<void>();
    // The autofill response comes only after the button's challenge cookie
    // is set, and before its options body arrives.
    exchanges = [
      { headersSent: autofillAnswered.promise },
      { bodySent: buttonBody.promise },
    ];
    void arrival(1).promise.then(async () => {
      await settleNetwork();
      autofillAnswered.resolve();
      await settleNetwork();
      buttonBody.resolve();
    });

    await withPasskeyPage(async (page, authenticator) => {
      const failedRequests: string[] = [];
      page.on("requestfailed", (request) => {
        failedRequests.push(new URL(request.url()).pathname);
      });
      await page.evaluate("armAutofill()");
      await arrival(0).promise;

      await authenticator.answerModalCeremony(async () => {
        await page.evaluate("pressButton()");
        await waitForOutcomes(page, 2);
      });

      expect(await readOutcomes(page)).toEqual([
        "autofill AUTH_CANCELLED",
        "button signed in",
      ]);
      await expectVerifiedAfterFirstAttempt(page);
      expect(failedRequests).toEqual([optionsPath]);
    });
  }
);

test.skipIf(!chromiumAvailable)(
  "keeps an autofill whose options body arrives after the click from starting",
  async () => {
    const autofillBody = Promise.withResolvers<void>();
    exchanges = [{ bodySent: autofillBody.promise }];

    await withPasskeyPage(async (page, authenticator) => {
      await page.evaluate("armAutofill()");
      await arrival(0).promise;
      await settleNetwork();

      await authenticator.answerModalCeremony(async () => {
        await page.evaluate("pressButton()");
        await waitForOutcomes(page, 2);
      });
      autofillBody.resolve();
      await settleNetwork();

      expect(await readOutcomes(page)).toEqual([
        "autofill AUTH_CANCELLED",
        "button signed in",
      ]);
      await expectVerifiedAfterFirstAttempt(page);
      await expect(
        authenticator.waitForConditionalRequest(250)
      ).rejects.toThrow();
    });
  }
);

test.skipIf(!chromiumAvailable)(
  "lets the button through a hung autofill options request that never starts later",
  async () => {
    const autofillAnswered = Promise.withResolvers<void>();
    exchanges = [{ headersSent: autofillAnswered.promise }];

    await withPasskeyPage(async (page, authenticator) => {
      await page.evaluate("armAutofill()");
      await arrival(0).promise;

      await authenticator.answerModalCeremony(async () => {
        await page.evaluate("pressButton()");
        await waitForOutcomes(page, 2);
      });
      autofillAnswered.resolve();
      await settleNetwork();

      expect(await readOutcomes(page)).toEqual([
        "autofill AUTH_CANCELLED",
        "button signed in",
      ]);
      await expectVerifiedAfterFirstAttempt(page);
      await expect(
        authenticator.waitForConditionalRequest(250)
      ).rejects.toThrow();
    });
  }
);

test.skipIf(!chromiumAvailable)(
  "signs in through the newer of two autofill attempts",
  async () => {
    const olderAnswered = Promise.withResolvers<void>();
    exchanges = [{ headersSent: olderAnswered.promise }];

    await withPasskeyPage(async (page, authenticator) => {
      // Presence answers the conditional request as it starts.
      await authenticator.answerCeremony(async () => {
        await page.evaluate("armAutofill()");
        await arrival(0).promise;
        await page.evaluate("armAutofill()");
        await waitForOutcomes(page, 2);
      });
      olderAnswered.resolve();
      await settleNetwork();

      expect(await readOutcomes(page)).toEqual([
        "autofill AUTH_CANCELLED",
        "autofill signed in",
      ]);
      await expectVerifiedAfterFirstAttempt(page);
    });
  }
);
