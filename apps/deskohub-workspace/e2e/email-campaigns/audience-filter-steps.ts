import type { Locator, Page } from "@playwright/test";
import { workspaceE2ETimeouts } from "../timeouts";

/**
 * Adds a "Dotypos tags is any of" clause for one tag through the audience
 * filter builder inside `scope`, as the audience form and the automation
 * condition card both render it. Menus and listboxes open in portals, so
 * their items are found on the page.
 */
export const addDotyposTagCondition = async (
  page: Page,
  scope: Locator,
  tag: string
) => {
  await scope
    .getByRole("button", { exact: true, name: "Add condition" })
    .click({ timeout: workspaceE2ETimeouts.browserAction });
  await page
    .getByRole("menuitem", { exact: true, name: "Dotypos tags" })
    .click({ timeout: workspaceE2ETimeouts.browserAction });
  await scope
    .getByRole("combobox", { exact: true, name: "Dotypos tags match" })
    .click({ timeout: workspaceE2ETimeouts.browserAction });
  await page
    .getByRole("option", { exact: true, name: "is any of" })
    .click({ timeout: workspaceE2ETimeouts.browserAction });
  const tagEntry = scope.getByRole("textbox", { exact: true, name: "Add tag" });
  await tagEntry.fill(tag, { timeout: workspaceE2ETimeouts.browserAction });
  // The entry commits a tag on Enter and shows it as a removable chip.
  await tagEntry.press("Enter", {
    timeout: workspaceE2ETimeouts.browserAction,
  });
  await scope
    .getByRole("button", { exact: true, name: `Remove tag ${tag}` })
    .waitFor({ state: "visible", timeout: workspaceE2ETimeouts.browserAction });
};
