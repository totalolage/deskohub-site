import { expect, test } from "bun:test";
import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { createServer } from "node:http";
import { chromium, type Page } from "@playwright/test";
import { triggerProfileHistoryBack } from "./profile-navigation";

type MockPage = {
  readonly evaluateInputs: readonly unknown[];
  readonly navigationWaitCalls: () => number;
  readonly page: Page;
  readonly goBackCalls: () => number;
};

const makeMockPage = (): MockPage => {
  const evaluateInputs: unknown[] = [];
  let goBackCallCount = 0;
  let navigationWaitCallCount = 0;
  const page = Object.assign({} as Page, {
    evaluate: async (expression: unknown) => {
      evaluateInputs.push(expression);
    },
    goBack: async () => {
      goBackCallCount += 1;
      throw new Error("page.goBack must not be used for guarded history");
    },
    waitForNavigation: async () => {
      navigationWaitCallCount += 1;
      throw new Error("navigation waits must not be used for guarded history");
    },
  });

  return {
    evaluateInputs,
    goBackCalls: () => goBackCallCount,
    navigationWaitCalls: () => navigationWaitCallCount,
    page,
  };
};

const chromiumAvailable = await access(
  chromium.executablePath(),
  constants.X_OK
)
  .then(() => true)
  .catch(() => false);

const startNavigationTestServer = async () => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/html" });
    response.end(`
      <!doctype html>
      <title>ready</title>
      <script>
        if (window.navigation) {
          window.navigation.addEventListener("navigate", (event) => {
            if (event.navigationType !== "traverse") return;
            document.title = "cancelled-back";
            event.preventDefault();
          });
        }
      </script>
    `);
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    throw new Error("navigation regression server did not receive a port");
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
};

test("uses one evaluated history trigger instead of Playwright navigation waits", async () => {
  const mockPage = makeMockPage();

  await triggerProfileHistoryBack(mockPage.page);

  expect(mockPage.goBackCalls()).toBe(0);
  expect(mockPage.navigationWaitCalls()).toBe(0);
  expect(mockPage.evaluateInputs).toHaveLength(1);
  expect(mockPage.evaluateInputs[0]).toBeInstanceOf(Function);
  expect(String(mockPage.evaluateInputs[0])).toContain("window.history.back()");
});

test.skipIf(!chromiumAvailable)(
  "resolves the evaluated trigger when the Navigation API cancels same-document back",
  async () => {
    const server = await startNavigationTestServer();
    try {
      const browser = await chromium.launch();
      try {
        const page = await browser.newPage();
        await page.goto(`${server.baseUrl}/first`);
        await page.evaluate(() => {
          window.history.pushState({}, "", "/second");
        });

        expect(await page.evaluate(() => "navigation" in window)).toBe(true);

        const triggerOutcome = await Promise.race([
          triggerProfileHistoryBack(page).then(() => "resolved" as const),
          new Promise<"timed-out">((resolve) =>
            setTimeout(() => resolve("timed-out"), 1000)
          ),
        ]);

        expect(triggerOutcome).toBe("resolved");
        await page.waitForFunction(() => document.title === "cancelled-back", {
          timeout: 1000,
        });
        expect(page.url()).toBe(`${server.baseUrl}/second`);
      } finally {
        await browser.close();
      }
    } finally {
      await server.close();
    }
  }
);
