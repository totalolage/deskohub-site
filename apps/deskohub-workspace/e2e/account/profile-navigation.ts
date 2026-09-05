import { expect, type Page } from "@playwright/test";
import { workspaceE2ETimeouts } from "../timeouts";

const homePath = "/en-US";
const accountPath = "/en-US/account";
const profileFormSelector = "#account-profile-form";
const profileFirstNameSelector = "#account-profile-first-name";
const unavailableHeading = "Customer accounts are temporarily unavailable";

export async function verifyProfileNavigation(
  page: Page,
  baseUrl: string
): Promise<void> {
  const homeUrl = new URL(homePath, baseUrl).toString();
  const accountUrl = new URL(accountPath, baseUrl).toString();
  const profileForm = page.locator(profileFormSelector);
  const firstName = page.locator(profileFirstNameSelector);
  const header = page.getByRole("banner");
  const homeLink = header.getByRole("link", {
    exact: true,
    name: "Deskohub Workspace",
  });
  const accountLink = header.getByRole("link", {
    exact: true,
    name: "Account",
  });

  await expect(profileForm).toBeVisible({
    timeout: workspaceE2ETimeouts.browserAction,
  });
  const originalFirstName = await firstName.inputValue({
    timeout: workspaceE2ETimeouts.browserAction,
  });
  const draftFirstName = `${originalFirstName} draft`.slice(0, 100);

  await Promise.all([
    page.waitForURL(homeUrl, {
      timeout: workspaceE2ETimeouts.browserNavigation,
    }),
    homeLink.click({ timeout: workspaceE2ETimeouts.browserAction }),
  ]);

  await expect(accountLink).toBeVisible({
    timeout: workspaceE2ETimeouts.browserAction,
  });
  await Promise.all([
    page.waitForURL(accountUrl, {
      timeout: workspaceE2ETimeouts.browserNavigation,
    }),
    accountLink.click({ timeout: workspaceE2ETimeouts.browserAction }),
  ]);
  await expect(profileForm).toBeVisible({
    timeout: workspaceE2ETimeouts.browserAction,
  });
  await expect(
    page.getByRole("heading", {
      exact: true,
      level: 1,
      name: unavailableHeading,
    })
  ).toHaveCount(0, { timeout: workspaceE2ETimeouts.browserAction });

  await firstName.fill(draftFirstName, {
    timeout: workspaceE2ETimeouts.browserAction,
  });

  const headerClickDialogPromise = page.waitForEvent("dialog", {
    timeout: workspaceE2ETimeouts.browserAction,
  });
  const headerClickPromise = homeLink.click({
    timeout: workspaceE2ETimeouts.browserAction,
  });
  const headerClickDialog = await headerClickDialogPromise;
  expect(headerClickDialog.type()).toBe("confirm");
  await headerClickDialog.dismiss();
  await headerClickPromise;
  await expect(page).toHaveURL(accountUrl, {
    timeout: workspaceE2ETimeouts.browserAction,
  });
  await expect(firstName).toHaveValue(draftFirstName, {
    timeout: workspaceE2ETimeouts.browserAction,
  });

  const backDialogPromise = page.waitForEvent("dialog", {
    timeout: workspaceE2ETimeouts.browserAction,
  });
  const backPromise = page.goBack({
    timeout: workspaceE2ETimeouts.browserNavigation,
  });
  const backDialog = await backDialogPromise;
  expect(backDialog.type()).toBe("confirm");
  await backDialog.dismiss();
  try {
    await backPromise;
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !error.message.includes("net::ERR_ABORTED")
    ) {
      throw error;
    }
  }
  await expect(page).toHaveURL(accountUrl, {
    timeout: workspaceE2ETimeouts.browserAction,
  });
  await expect(firstName).toHaveValue(draftFirstName, {
    timeout: workspaceE2ETimeouts.browserAction,
  });

  await firstName.fill(originalFirstName, {
    timeout: workspaceE2ETimeouts.browserAction,
  });
  await Promise.all([
    page.waitForURL(homeUrl, {
      timeout: workspaceE2ETimeouts.browserNavigation,
    }),
    homeLink.click({ timeout: workspaceE2ETimeouts.browserAction }),
  ]);

  await expect(accountLink).toBeVisible({
    timeout: workspaceE2ETimeouts.browserAction,
  });
  await Promise.all([
    page.waitForURL(accountUrl, {
      timeout: workspaceE2ETimeouts.browserNavigation,
    }),
    accountLink.click({ timeout: workspaceE2ETimeouts.browserAction }),
  ]);
  await expect(profileForm).toBeVisible({
    timeout: workspaceE2ETimeouts.browserAction,
  });
  await expect(firstName).toHaveValue(originalFirstName, {
    timeout: workspaceE2ETimeouts.browserAction,
  });
  await expect(
    page.getByRole("heading", {
      exact: true,
      level: 1,
      name: unavailableHeading,
    })
  ).toHaveCount(0, { timeout: workspaceE2ETimeouts.browserAction });
}
