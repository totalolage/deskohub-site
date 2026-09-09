import { normalizePhoneNumber } from "@deskohub/dotypos";
import { expect, type Page } from "@playwright/test";
import { workspaceE2ETimeouts } from "../timeouts";
import {
  accountSectionLabels,
  accountSectionLandmarks,
  selectAccountSection,
} from "./account-sections";

const homePath = "/en-US";
const accountPath = "/en-US/account";
const profileFormSelector = "#account-profile-form";
const profileFirstNameSelector = "#account-profile-first-name";
const profileLastNameSelector = "#account-profile-last-name";
const profilePhoneSelector = "#account-profile-phone";
const billingKindSelector = "#account-profile-billing-kind";
const billingCompanyNameSelector = "#account-profile-billing-company-name";
const profileSubmitSelector = "#account-profile-submit";
const unavailableHeading = "Customer accounts are temporarily unavailable";

export function triggerProfileHistoryBack(page: Page): Promise<void> {
  return page.evaluate(() => {
    window.history.back();
  });
}

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

  const selectProfileSection = async (): Promise<void> => {
    await selectAccountSection(page, "profile");
    await expect(profileForm).toBeVisible({
      timeout: workspaceE2ETimeouts.browserAction,
    });
  };

  await selectProfileSection();
  const originalProfile = {
    firstName: await firstName.inputValue({
      timeout: workspaceE2ETimeouts.browserAction,
    }),
    lastName: await page.locator(profileLastNameSelector).inputValue({
      timeout: workspaceE2ETimeouts.browserAction,
    }),
    phone: await page.locator(profilePhoneSelector).inputValue({
      timeout: workspaceE2ETimeouts.browserAction,
    }),
  };
  const canonicalOriginalPhone = normalizePhoneNumber(originalProfile.phone);
  if (canonicalOriginalPhone === null)
    throw new Error("profile phone is not a valid canonical phone number");
  await selectAccountSection(page, "billing");
  await expect(page.locator(accountSectionLandmarks.billing)).toBeVisible({
    timeout: workspaceE2ETimeouts.browserAction,
  });
  await expect(
    page.getByRole("heading", {
      exact: true,
      level: 2,
      name: accountSectionLabels.billing,
    })
  ).toBeVisible({ timeout: workspaceE2ETimeouts.browserAction });
  const originalBilling = {
    companyName: await page.locator(billingCompanyNameSelector).inputValue({
      timeout: workspaceE2ETimeouts.browserAction,
    }),
    kind: await page.locator(billingKindSelector).inputValue({
      timeout: workspaceE2ETimeouts.browserAction,
    }),
  };
  const draftFirstName = `${originalProfile.firstName} draft`.slice(0, 100);
  await selectProfileSection();

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
  await selectProfileSection();
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

  await selectAccountSection(page, "billing");
  await expect(page.locator(accountSectionLandmarks.billing)).toBeVisible({
    timeout: workspaceE2ETimeouts.browserAction,
  });
  await expect(
    page.getByRole("heading", {
      exact: true,
      level: 2,
      name: accountSectionLabels.billing,
    })
  ).toBeVisible({ timeout: workspaceE2ETimeouts.browserAction });
  await selectProfileSection();
  await expect(firstName).toHaveValue(draftFirstName, {
    timeout: workspaceE2ETimeouts.browserAction,
  });

  await selectAccountSection(page, "billing");
  await expect(page.locator(accountSectionLandmarks.billing)).toBeVisible({
    timeout: workspaceE2ETimeouts.browserAction,
  });
  await page.locator(billingCompanyNameSelector).fill("", {
    timeout: workspaceE2ETimeouts.browserAction,
  });
  await selectProfileSection();
  await page.locator(profileSubmitSelector).click({
    timeout: workspaceE2ETimeouts.browserAction,
  });
  await expect(page.locator(accountSectionLandmarks.billing)).toBeVisible({
    timeout: workspaceE2ETimeouts.browserAction,
  });
  await expect(page.locator(billingCompanyNameSelector)).toHaveValue("", {
    timeout: workspaceE2ETimeouts.browserAction,
  });
  const hiddenBillingValidationMessage = await page
    .locator(billingCompanyNameSelector)
    .evaluate((input) => {
      if (!(input instanceof HTMLInputElement)) {
        throw new Error("billing company name control is not an input");
      }
      return input.validationMessage;
    });
  expect(hiddenBillingValidationMessage).not.toBe("");
  await page
    .locator(billingCompanyNameSelector)
    .fill(originalBilling.companyName, {
      timeout: workspaceE2ETimeouts.browserAction,
    });
  await selectProfileSection();
  await expect(firstName).toHaveValue(draftFirstName, {
    timeout: workspaceE2ETimeouts.browserAction,
  });

  // The profile form remains mounted while its profile panel is hidden.
  await selectAccountSection(page, "billing");
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
  await selectProfileSection();
  await expect(firstName).toHaveValue(draftFirstName, {
    timeout: workspaceE2ETimeouts.browserAction,
  });

  const backDialogPromise = page.waitForEvent("dialog", {
    timeout: workspaceE2ETimeouts.browserAction,
  });
  const backTriggerPromise = triggerProfileHistoryBack(page);
  const backDialog = await backDialogPromise;
  expect(backDialog.type()).toBe("confirm");
  await backDialog.dismiss();
  await backTriggerPromise;
  await expect(page).toHaveURL(accountUrl, {
    timeout: workspaceE2ETimeouts.browserAction,
  });
  await selectProfileSection();
  await expect(firstName).toHaveValue(draftFirstName, {
    timeout: workspaceE2ETimeouts.browserAction,
  });

  const leaveDialogPromise = page.waitForEvent("dialog", {
    timeout: workspaceE2ETimeouts.browserAction,
  });
  const leaveClickPromise = homeLink.click({
    timeout: workspaceE2ETimeouts.browserAction,
  });
  const leaveDialog = await leaveDialogPromise;
  expect(leaveDialog.type()).toBe("confirm");
  await leaveDialog.accept();
  await leaveClickPromise;
  await expect(page).toHaveURL(homeUrl, {
    timeout: workspaceE2ETimeouts.browserNavigation,
  });

  await page.goto(accountUrl, {
    waitUntil: "load",
    timeout: workspaceE2ETimeouts.browserNavigation,
  });
  await selectProfileSection();
  await expect(firstName).toHaveValue(originalProfile.firstName, {
    timeout: workspaceE2ETimeouts.browserAction,
  });
  await expect(page.locator(profileLastNameSelector)).toHaveValue(
    originalProfile.lastName,
    { timeout: workspaceE2ETimeouts.browserAction }
  );
  await expect(page.locator(profilePhoneSelector)).toHaveValue(
    canonicalOriginalPhone,
    { timeout: workspaceE2ETimeouts.browserAction }
  );
  await selectAccountSection(page, "billing");
  await expect(page.locator(billingKindSelector)).toHaveValue(
    originalBilling.kind,
    { timeout: workspaceE2ETimeouts.browserAction }
  );
  await expect(page.locator(billingCompanyNameSelector)).toHaveValue(
    originalBilling.companyName,
    { timeout: workspaceE2ETimeouts.browserAction }
  );
  await selectProfileSection();
  await expect(
    page.getByRole("heading", {
      exact: true,
      level: 1,
      name: unavailableHeading,
    })
  ).toHaveCount(0, { timeout: workspaceE2ETimeouts.browserAction });
}
