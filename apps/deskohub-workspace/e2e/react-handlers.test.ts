import { afterEach, expect, setSystemTime, test } from "bun:test";
import { createServer } from "node:http";
import { chromium, errors, type Locator, type Page } from "@playwright/test";
import { createElement, Suspense, use } from "react";
import { renderToReadableStream } from "react-dom/server";
import { playwrightChromiumAvailable } from "../shared/testing/playwright-browser";
import { waitForReactClickHandler } from "./react-handlers";

const chromiumAvailable = await playwrightChromiumAvailable();

afterEach(() => setSystemTime());
const controlLabel = "Profile & Identity";

function StreamedControl({ ready }: { readonly ready: Promise<void> }) {
  use(ready);
  return createElement(
    "button",
    { "data-control": "content", type: "button" },
    controlLabel
  );
}

/**
 * Streams a document whose Suspense fallback renders the same control as its
 * content, like the account layout's loading shell, and holds the content
 * until the test releases it.
 */
const startStreamedControlServer = async () => {
  let releaseContent = () => {};
  const content = new Promise<void>((resolve) => {
    releaseContent = resolve;
  });
  const server = createServer(async (_request, response) => {
    const stream = await renderToReadableStream(
      createElement(
        "html",
        null,
        createElement(
          "body",
          null,
          createElement(
            Suspense,
            {
              fallback: createElement(
                "button",
                { "data-control": "fallback", disabled: true, type: "button" },
                controlLabel
              ),
            },
            createElement(StreamedControl, { ready: content })
          )
        )
      )
    );
    response.writeHead(200, { "content-type": "text/html" });
    for await (const chunk of stream) response.write(chunk);
    response.end();
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    throw new Error("streamed control server did not receive a port");
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        releaseContent();
        server.close((error) => (error ? reject(error) : resolve()));
      }),
    releaseContent: () => releaseContent(),
  };
};

test.skipIf(!chromiumAvailable)(
  "waits on the control a streamed Suspense reveal puts in place of the fallback",
  async () => {
    const server = await startStreamedControlServer();
    try {
      const browser = await chromium.launch();
      try {
        const page = await browser.newPage();
        await page.goto(server.baseUrl, { waitUntil: "commit" });
        const control = page.getByRole("button", { name: controlLabel });
        await page
          .locator("[data-control='fallback']")
          .waitFor({ state: "visible" });

        let fallbackObserved = () => {};
        const fallbackObservation = new Promise<void>((resolve) => {
          fallbackObserved = resolve;
        });
        const observedPage: Pick<Page, "waitForFunction"> = {
          waitForFunction: (...args: Parameters<Page["waitForFunction"]>) => {
            fallbackObserved();
            return page.waitForFunction(...args);
          },
        } as Pick<Page, "waitForFunction">;

        const handlerReady = waitForReactClickHandler(observedPage, control);
        // The wait observes the server-rendered fallback first; React's
        // streamed reveal then removes that node and moves the content in.
        await fallbackObservation;
        server.releaseContent();
        const content = page.locator("[data-control='content']");
        await content.waitFor({ state: "visible" });
        expect(await page.locator("[data-control='fallback']").count()).toBe(0);
        await content.evaluate((element) => {
          Object.assign(element, {
            __reactProps$streamed: { onClick: () => undefined },
          });
        });

        await handlerReady;
      } finally {
        await browser.close();
      }
    } finally {
      await server.close();
    }
  }
);

test.skipIf(!chromiumAvailable)(
  "sees a hydrated control while the page delivers no animation frames",
  async () => {
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage();
      // Playwright's injected script takes the page's requestAnimationFrame
      // when it first runs, so a stub stands in for a browser that has
      // stopped rendering frames.
      await page.addInitScript(() => {
        window.requestAnimationFrame = () => 0;
      });
      const origin = "http://react-handlers.test";
      await page.route(`${origin}/`, (route) =>
        route.fulfill({
          body: `<button type="button">${controlLabel}</button><script>
            setTimeout(() => {
              document.querySelector("button").__reactProps$late = {
                onClick: () => undefined,
              };
            }, 200);
          </script>`,
          contentType: "text/html",
        })
      );
      await page.goto(`${origin}/`);

      const startedAt = performance.now();
      await waitForReactClickHandler(
        page,
        page.getByRole("button", { name: controlLabel })
      );
      expect(performance.now() - startedAt).toBeLessThan(5_000);
    } finally {
      await browser.close();
    }
  }
);

test.skipIf(!chromiumAvailable)(
  "sees a control hydrated while the page runs no timers",
  async () => {
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage();
      // Playwright's injected script takes the page's setTimeout when it
      // first runs, so a stub stands in for a page whose event loop stalls
      // between protocol commands: the in-page poll checks once on arrival.
      await page.addInitScript(() => {
        Reflect.set(window, "setTimeout", () => 0);
      });
      const origin = "http://react-handlers.test";
      await page.route(`${origin}/`, (route) =>
        route.fulfill({
          body: `<button type="button">${controlLabel}</button>`,
          contentType: "text/html",
        })
      );
      await page.goto(`${origin}/`);
      const control = page.getByRole("button", { name: controlLabel });

      const startedAt = performance.now();
      const handlerReady = waitForReactClickHandler(page, control);
      await new Promise((resolve) => setTimeout(resolve, 200));
      await control.evaluate((element) => {
        Object.assign(element, {
          __reactProps$late: { onClick: () => undefined },
        });
      });

      await handlerReady;
      expect(performance.now() - startedAt).toBeLessThan(5_000);
    } finally {
      await browser.close();
    }
  }
);

test("rejects within its deadline when a detached control is never replaced", async () => {
  const startedAt = Date.parse("2026-10-11T12:00:00.000Z");
  let now = startedAt;
  setSystemTime(new Date(now));
  const advance = (ms: number) => {
    now += ms;
    setSystemTime(new Date(now));
  };
  const lookupTimeouts: (number | undefined)[] = [];
  const handle = {
    dispose: async () => {},
    jsonValue: async () => "detached",
  };

  const control = Object.assign({} as Pick<Locator, "elementHandle">, {
    elementHandle: async (options?: { readonly timeout?: number }) => {
      lookupTimeouts.push(options?.timeout);
      if (lookupTimeouts.length === 1) return handle;
      // Playwright waits for attachment until the timeout; without one it
      // would wait forever, which this fake reports at once instead.
      if (options?.timeout === undefined)
        throw new Error("replacement lookup had no timeout");
      advance(options.timeout);
      throw new errors.TimeoutError("fake replacement never attached");
    },
  });
  const page = Object.assign({} as Pick<Page, "waitForFunction">, {
    waitForFunction: async () => {
      advance(4_000);
      return handle;
    },
  });

  const failure = await waitForReactClickHandler(page, control).then(
    () => undefined,
    (cause: unknown) => cause
  );

  expect(failure).toBeInstanceOf(errors.TimeoutError);
  expect(lookupTimeouts).toEqual([15_000, 11_000]);
  expect(now - startedAt).toBeLessThanOrEqual(15_000);
});
