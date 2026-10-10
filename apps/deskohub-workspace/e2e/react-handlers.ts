import type { Locator, Page } from "@playwright/test";

const reactClickHandlerTimeoutMs = 15_000;

/**
 * Runs in the browser: whether React has attached an `onClick` prop to the
 * element. A server-rendered control is visible before hydration, and a
 * native click before then is silently dropped.
 */
const elementHasReactClickHandler = (element: Element | null): boolean => {
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
};

/** Waits until React has hydrated the click handler of a rendered control. */
export const waitForReactClickHandler = async (
  page: Pick<Page, "waitForFunction">,
  control: Pick<Locator, "elementHandle">
): Promise<void> => {
  const element = await control.elementHandle();
  if (element === null) throw new Error("React click control was not rendered");

  try {
    await page.waitForFunction(elementHasReactClickHandler, element, {
      timeout: reactClickHandlerTimeoutMs,
    });
  } finally {
    await element.dispose();
  }
};
