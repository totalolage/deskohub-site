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
