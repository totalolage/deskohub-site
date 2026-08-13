import { expect, test } from "bun:test";
import type { Browser } from "@playwright/test";
import {
  addDatabaseUrlRedactions,
  makePlaywrightBrowserRunner,
  redact,
} from "./runtime";

test("redacts database connection identity fragments", () => {
  const connectionUrl =
    "postgresql://permit-user:permit-password@private-coordination.example.test/private-database";
  addDatabaseUrlRedactions(connectionUrl);

  const output = redact(
    `${connectionUrl} private-coordination.example.test private-database permit-user permit-password`
  );

  expect(output).not.toContain("private-coordination.example.test");
  expect(output).not.toContain("private-database");
  expect(output).not.toContain("permit-user");
  expect(output).not.toContain("permit-password");
});

test("targets the visible match for selector-based browser actions", async () => {
  let filteredForVisibility = false;
  const visibleLocator = {
    focus: async () => undefined,
  };
  const ambiguousLocator = {
    filter: (options: { readonly visible?: boolean }) => {
      filteredForVisibility = options.visible === true;
      return visibleLocator;
    },
    focus: async () => {
      throw new Error("strict mode violation: selector resolved to 2 elements");
    },
  };
  const frame = {
    locator: () => ambiguousLocator,
  };
  const page = {
    mainFrame: () => frame,
    on: () => undefined,
  };
  const context = {
    close: async () => undefined,
    newPage: async () => page,
    on: () => undefined,
  };
  const browser = {
    newContext: async () => context,
  } as unknown as Browser;
  const run = makePlaywrightBrowserRunner(browser);

  try {
    await run("playwright", [
      "--session",
      "visible-selector-test",
      "focus",
      "[data-locale-switcher] a",
    ]);
  } finally {
    await run.close?.();
  }

  expect(filteredForVisibility).toBe(true);
});

test("types provider-controlled fields with user-like key timing", async () => {
  let typeOptions: { readonly delay?: number; readonly timeout?: number } = {};
  const visibleLocator = {
    pressSequentially: async (
      _value: string,
      options: { readonly delay?: number; readonly timeout?: number }
    ) => {
      typeOptions = options;
    },
  };
  const frame = {
    locator: () => ({ filter: () => visibleLocator }),
  };
  const page = {
    mainFrame: () => frame,
    on: () => undefined,
  };
  const context = {
    close: async () => undefined,
    newPage: async () => page,
    on: () => undefined,
  };
  const browser = {
    newContext: async () => context,
  } as unknown as Browser;
  const run = makePlaywrightBrowserRunner(browser);

  try {
    await run(
      "playwright",
      ["--session", "provider-field-test", "type", "input", "123"],
      { timeoutMs: 5000 }
    );
  } finally {
    await run.close?.();
  }

  expect(typeOptions).toEqual({ delay: 50, timeout: 5000 });
});

test("waits for the document body before taking a snapshot", async () => {
  const calls: string[] = [];
  const bodyLocator = {
    ariaSnapshot: async () => {
      calls.push("snapshot");
      return "- generic";
    },
    waitFor: async () => {
      calls.push("wait");
    },
  };
  const frame = {
    locator: () => bodyLocator,
  };
  const page = {
    mainFrame: () => frame,
    on: () => undefined,
  };
  const context = {
    close: async () => undefined,
    newPage: async () => page,
    on: () => undefined,
  };
  const browser = {
    newContext: async () => context,
  } as unknown as Browser;
  const run = makePlaywrightBrowserRunner(browser);

  try {
    await run("playwright", ["--session", "snapshot-test", "snapshot"]);
  } finally {
    await run.close?.();
  }

  expect(calls).toEqual(["wait", "snapshot"]);
});

test("restores the remaining page when the current popup closes", async () => {
  let registerPopup: ((page: unknown) => void) | undefined;
  let closePopup: (() => void) | undefined;
  const checkoutPage = {
    isClosed: () => false,
    mainFrame: () => ({}),
    on: () => undefined,
    url: () => "https://workspace.test/checkout/status/order-id",
  };
  const popupPage = {
    mainFrame: () => ({}),
    on: (event: string, listener: () => void) => {
      if (event === "close") closePopup = listener;
    },
    url: () => "https://provider.test/hosted-payment",
  };
  const context = {
    close: async () => undefined,
    newPage: async () => checkoutPage,
    on: (event: string, listener: (page: unknown) => void) => {
      if (event === "page") registerPopup = listener;
    },
    pages: () => [checkoutPage],
  };
  const browser = {
    newContext: async () => context,
  } as unknown as Browser;
  const run = makePlaywrightBrowserRunner(browser);

  try {
    await run("playwright", ["--session", "popup-test", "get", "url"]);
    registerPopup?.(popupPage);
    expect(
      (await run("playwright", ["--session", "popup-test", "get", "url"]))
        .stdout
    ).toBe("https://provider.test/hosted-payment");

    closePopup?.();
    expect(
      (await run("playwright", ["--session", "popup-test", "get", "url"]))
        .stdout
    ).toBe("https://workspace.test/checkout/status/order-id");
  } finally {
    await run.close?.();
  }
});
