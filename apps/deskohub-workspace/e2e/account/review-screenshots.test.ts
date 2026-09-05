import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import type * as Playwright from "@playwright/test";
import { workspaceE2ETimeouts } from "../timeouts";
import {
  type AccountReviewTarget,
  captureAccountReview,
} from "./review-screenshots";

const baseUrl = "https://deskohub-workspace-review.example.test";
const initialViewport = { height: 768, width: 1024 } as const;
const accountReviewArtifactDirectory = resolve(
  import.meta.dir,
  "../../e2e-artifacts/account-review"
);
const captureFailureMessage = "Account review screenshot capture failed";

const validTargets = [
  {
    filename: "completion-mobile375x900.png",
    path: "/en-US/account",
    query: "",
    target: "completion-mobile375x900",
    viewport: { height: 900, width: 375 },
  },
  {
    filename: "linked-desktop1440x1000.png",
    path: "/en-US/account",
    query: "",
    target: "linked-desktop1440x1000",
    viewport: { height: 1000, width: 1440 },
  },
  {
    filename: "linked-history-desktop.png",
    path: "/en-US/account",
    query: "",
    target: "linked-history-desktop",
    viewport: { height: 1000, width: 1440 },
  },
  {
    filename: "support-desktop.png",
    path: "/en-US/account",
    query: "",
    target: "support-desktop",
    viewport: { height: 1000, width: 1440 },
  },
  {
    filename: "sign-in-accepted-desktop.png",
    path: "/en-US/auth/sign-in",
    query: "",
    target: "sign-in-accepted-desktop",
    viewport: { height: 1000, width: 1440 },
  },
  {
    filename: "sign-in-desktop.png",
    path: "/en-US/auth/sign-in",
    query: "",
    target: "sign-in-desktop",
    viewport: { height: 1000, width: 1440 },
  },
  {
    filename: "callback-failed-desktop.png",
    path: "/en-US/auth/callback",
    query: "",
    target: "callback-failed-desktop",
    viewport: { height: 1000, width: 1440 },
  },
  {
    filename: "deleted-desktop.png",
    path: "/en-US/account/deleted",
    query: "",
    target: "deleted-desktop",
    viewport: { height: 1000, width: 1440 },
  },
] as const satisfies ReadonlyArray<{
  readonly filename: `${string}.png`;
  readonly path: string;
  readonly query: string;
  readonly target: AccountReviewTarget;
  readonly viewport: Playwright.ViewportSize;
}>;

type FakePage = {
  readonly currentViewport: () => Playwright.ViewportSize | null;
  readonly fontReadyCalls: () => number;
  readonly page: Playwright.Page;
  readonly screenshotCalls: readonly Record<string, unknown>[];
  readonly viewportChanges: readonly (Playwright.ViewportSize | null)[];
};

const makeFakePage = (
  url: string,
  options: { readonly failScreenshot?: boolean } = {}
): FakePage => {
  let currentViewport: Playwright.ViewportSize | null = { ...initialViewport };
  let fontReadyCallCount = 0;
  const screenshotCalls: Record<string, unknown>[] = [];
  const viewportChanges: (Playwright.ViewportSize | null)[] = [];

  const page = Object.assign({} as Playwright.Page, {
    evaluate: async () => {
      fontReadyCallCount += 1;
    },
    screenshot: async (screenshotOptions: Record<string, unknown>) => {
      screenshotCalls.push(screenshotOptions);
      if (options.failScreenshot)
        throw new Error(`screenshot failed for ${url}`);
    },
    setViewportSize: async (viewport: Playwright.ViewportSize | null) => {
      viewportChanges.push(viewport);
      currentViewport = viewport;
    },
    url: () => url,
    viewportSize: () => currentViewport,
  });

  return {
    currentViewport: () => currentViewport,
    fontReadyCalls: () => fontReadyCallCount,
    page,
    screenshotCalls,
    viewportChanges,
  };
};

describe("account review screenshot capture", () => {
  const invalidPages = [
    {
      name: "a foreign origin",
      target: "completion-mobile375x900",
      url: "https://other.example.test/en-US/account",
    },
    {
      name: "a different path",
      target: "completion-mobile375x900",
      url: `${baseUrl}/en-US/auth/sign-in`,
    },
    {
      name: "a token query",
      target: "completion-mobile375x900",
      url: `${baseUrl}/en-US/account?token=synthetic-secret-token`,
    },
    {
      name: "a callback query with another parameter",
      target: "callback-failed-desktop",
      url: `${baseUrl}/en-US/auth/callback?error=INVALID_TOKEN&token=synthetic-secret-token`,
    },
    {
      name: "a hash",
      target: "completion-mobile375x900",
      url: `${baseUrl}/en-US/account#review-state`,
    },
  ] as const;

  for (const invalidPage of invalidPages) {
    test(`rejects ${invalidPage.name} before the screenshot`, async () => {
      const fakePage = makeFakePage(invalidPage.url);

      await expect(
        captureAccountReview(fakePage.page, baseUrl, invalidPage.target)
      ).rejects.toThrow(captureFailureMessage);

      expect(fakePage.screenshotCalls).toHaveLength(0);
      expect(fakePage.viewportChanges).toHaveLength(0);
    });
  }

  test("does not include the rejected URL in its fixed error", async () => {
    const unsafeUrl = `${baseUrl}/en-US/account?token=synthetic-secret-token`;
    const fakePage = makeFakePage(unsafeUrl);
    let failure: unknown;

    try {
      await captureAccountReview(
        fakePage.page,
        baseUrl,
        "completion-mobile375x900"
      );
    } catch (cause) {
      failure = cause;
    }

    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toBe(captureFailureMessage);
    expect((failure as Error).message).not.toContain(unsafeUrl);
    expect((failure as Error).message).not.toContain("synthetic-secret-token");
  });

  for (const expected of validTargets) {
    test(`captures fixed metadata for ${expected.target}`, async () => {
      const fakePage = makeFakePage(
        `${baseUrl}${expected.path}${expected.query}`
      );

      await captureAccountReview(fakePage.page, baseUrl, expected.target);

      expect(fakePage.screenshotCalls).toEqual([
        {
          animations: "disabled",
          fullPage: true,
          path: resolve(accountReviewArtifactDirectory, expected.filename),
          timeout: workspaceE2ETimeouts.browserAction,
        },
      ]);
      expect(fakePage.viewportChanges).toEqual([
        expected.viewport,
        initialViewport,
      ]);
      expect(fakePage.currentViewport()).toEqual(initialViewport);
      expect(fakePage.fontReadyCalls()).toBe(1);
    });
  }

  test("allows the closed invalid-token callback query", async () => {
    const fakePage = makeFakePage(
      `${baseUrl}/en-US/auth/callback?error=INVALID_TOKEN`
    );

    await captureAccountReview(
      fakePage.page,
      baseUrl,
      "callback-failed-desktop"
    );

    expect(fakePage.screenshotCalls).toHaveLength(1);
  });

  test("restores the previous viewport when screenshot capture fails", async () => {
    const fakePage = makeFakePage(`${baseUrl}/en-US/account`, {
      failScreenshot: true,
    });

    await expect(
      captureAccountReview(fakePage.page, baseUrl, "linked-desktop1440x1000")
    ).rejects.toThrow(captureFailureMessage);

    expect(fakePage.viewportChanges).toEqual([
      { height: 1000, width: 1440 },
      initialViewport,
    ]);
    expect(fakePage.currentViewport()).toEqual(initialViewport);
  });
});
