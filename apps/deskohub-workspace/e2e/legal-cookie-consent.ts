import { expect, type Page } from "@playwright/test";
import { type Locale, m } from "@/features/i18n";
import { workspaceE2ETimeouts } from "./timeouts";

const analyticsCheckboxSelector = "#cookie-category-analytics";

export async function dismissLegalCookieConsent(
  page: Page,
  locale: Locale
): Promise<void> {
  const necessaryOnlyButton = page.getByRole("button", {
    exact: true,
    name: m.cookieConsentConsentModalAcceptNecessaryBtn({}, { locale }),
  });

  await expect
    .poll(
      async () =>
        (await necessaryOnlyButton.isVisible()) ||
        ((await page.locator(analyticsCheckboxSelector).isVisible()) &&
          (await page.evaluate(
            hasReactClickHandler,
            analyticsCheckboxSelector
          ))),
      { timeout: workspaceE2ETimeouts.uiTransition }
    )
    .toBe(true);

  if (await necessaryOnlyButton.isVisible()) {
    await necessaryOnlyButton.click({
      timeout: workspaceE2ETimeouts.browserAction,
    });
    await expect(necessaryOnlyButton).toBeHidden({
      timeout: workspaceE2ETimeouts.browserAction,
    });
  }
}

export function hasReactClickHandler(selector: string): boolean {
  const element = document.querySelector(selector);
  if (element === null) return false;

  const reactPropsKey = Object.keys(element).find((key) =>
    key.startsWith("__reactProps$")
  );
  if (reactPropsKey === undefined) return false;

  const reactProps = Object.getOwnPropertyDescriptor(
    element,
    reactPropsKey
  )?.value;
  if (typeof reactProps !== "object" || reactProps === null) return false;

  return (
    "onClick" in reactProps &&
    typeof (reactProps as { readonly onClick?: unknown }).onClick === "function"
  );
}
