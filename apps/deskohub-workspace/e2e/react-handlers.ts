import { errors, type Locator, type Page } from "@playwright/test";
import { workspaceE2EPollIntervalMs } from "./timeouts";

const reactHandlerTimeoutMs = 15_000;

type ReactHandlerState = "ready" | "detached" | false;

/**
 * Runs in the browser: whether React has attached the `handler` prop, such
 * as `onClick`, to the element, or the element has left the document. A
 * server-rendered control is visible before hydration, and a native event
 * before then is silently dropped. A streamed Suspense reveal can also
 * replace a server-rendered fallback control with a new node after the
 * document `load` event; the replaced node never gains React props.
 */
const reactHandlerState = ({
  element,
  handler,
}: {
  readonly element: Element | null;
  readonly handler: string;
}): ReactHandlerState => {
  if (element === null || !element.isConnected) return "detached";
  const reactPropsKey = Object.keys(element).find((key) =>
    key.startsWith("__reactProps$")
  );
  if (reactPropsKey === undefined) return false;

  const reactProps: unknown = Object.getOwnPropertyDescriptor(
    element,
    reactPropsKey
  )?.value;
  if (typeof reactProps !== "object" || reactProps === null) return false;

  return typeof Reflect.get(reactProps, handler) === "function"
    ? "ready"
    : false;
};

/**
 * Waits until React has hydrated the `handler` prop, such as `onPointerDown`,
 * of the control the locator currently resolves to, resolving the locator
 * again whenever the observed node is replaced.
 */
export const waitForReactEventHandler = async (
  page: Pick<Page, "waitForFunction">,
  control: Pick<Locator, "elementHandle">,
  handler: string
): Promise<void> => {
  const deadline = Date.now() + reactHandlerTimeoutMs;
  let replacements = 0;

  const remainingBudgetMs = (): number => {
    const remainingMs = deadline - Date.now();
    if (remainingMs > 0) return remainingMs;
    throw new errors.TimeoutError(
      `React ${handler} handler wait timed out after ${replacements} control replacements`
    );
  };

  for (;;) {
    const element = await control.elementHandle({
      timeout: remainingBudgetMs(),
    });
    if (element === null)
      throw new Error(`React ${handler} control was not rendered`);

    try {
      const state = await page.waitForFunction(
        reactHandlerState,
        { element, handler },
        {
          polling: workspaceE2EPollIntervalMs.reactHandler,
          timeout: remainingBudgetMs(),
        }
      );
      try {
        if ((await state.jsonValue()) !== "detached") return;
      } finally {
        await state.dispose();
      }
    } finally {
      await element.dispose();
    }
    replacements += 1;
  }
};

/** Waits until React has hydrated the control's click handler. */
export const waitForReactClickHandler = (
  page: Pick<Page, "waitForFunction">,
  control: Pick<Locator, "elementHandle">
): Promise<void> => waitForReactEventHandler(page, control, "onClick");

/**
 * Waits until React has attached the `onSubmit` handler of the form the
 * locator resolves to. A native submit before hydration falls back to a full
 * document POST instead of the Server Action.
 */
export const waitForReactSubmitHandler = async (
  page: Pick<Page, "waitForFunction">,
  form: Pick<Locator, "elementHandle">,
  timeoutMs: number
): Promise<void> => {
  const element = await form.elementHandle({ timeout: timeoutMs });
  if (element === null) throw new Error("React form was not rendered");
  try {
    const state = await page.waitForFunction(
      (node) => {
        const reactPropsKey = Object.keys(node).find((key) =>
          key.startsWith("__reactProps$")
        );
        const reactProps =
          reactPropsKey === undefined
            ? undefined
            : Object.getOwnPropertyDescriptor(node, reactPropsKey)?.value;
        return (
          typeof reactProps === "object" &&
          reactProps !== null &&
          typeof (reactProps as { readonly onSubmit?: unknown }).onSubmit ===
            "function"
        );
      },
      element,
      { polling: workspaceE2EPollIntervalMs.reactHandler, timeout: timeoutMs }
    );
    await state.dispose();
  } finally {
    await element.dispose();
  }
};
