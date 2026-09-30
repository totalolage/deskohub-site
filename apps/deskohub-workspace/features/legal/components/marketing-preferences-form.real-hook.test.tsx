import { afterAll, afterEach, beforeAll, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { Schema } from "effect";
import { createSafeActionClient } from "next-safe-action";
import { m } from "@/features/i18n";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";

// Regression harness for the settled-control window: these tests run the
// MarketingPreferencesForm against the REAL useWorkspaceAction hook and the
// REAL next-safe-action hook scheduling, mocking only the server action
// handlers. next-safe-action 8.x delivers onSuccess/onError callbacks from a
// passive effect after the result commit, so settlement processing lands one
// paint later than the resolved result — exactly the window where a rendered
// enabled control must not silently no-op a retry click.

type SyntheticSaveInput = {
  readonly confirmed: true;
  readonly context: string;
  readonly granted: boolean;
  readonly locale: string;
  readonly source: "link" | "account";
};

type SyntheticManagementInput = { readonly context: string };

type MarketingPreferencesState =
  | {
      readonly status: "absent" | "active" | "withdrawn";
      readonly source: "account";
      readonly context: string;
    }
  | {
      readonly status: "absent" | "active" | "withdrawn";
      readonly source: "link";
      readonly context: string;
      readonly dismissalContext: string;
    }
  | {
      readonly status: "pending-link";
      readonly context: string;
      readonly dismissalContext: string;
    }
  | { readonly status: "invalid-link"; readonly dismissalContext: string }
  | { readonly status: "unavailable" };

const handleSave = mock((_input: SyntheticSaveInput) =>
  Promise.resolve({ status: "saved" as const })
);
const handleConfirm = mock(() =>
  Promise.resolve({ status: "confirmed" as const })
);
const handleClear = mock(() => Promise.resolve({ status: "cleared" as const }));
const routerRefresh = mock(() => undefined);

mock.module("next/navigation", () => ({
  useRouter: () => ({ refresh: routerRefresh }),
}));

// A real Standard Schema at the action boundary: the component test targets
// settlement scheduling, but inputs still parse into their owner types.
const saveSchema = Schema.toStandardSchemaV1(
  Schema.Struct({
    confirmed: Schema.Literal(true),
    context: Schema.NonEmptyString,
    granted: Schema.Boolean,
    locale: Schema.NonEmptyString,
    source: Schema.Literals(["link", "account"]),
  }),
  { parseOptions: { errors: "all", onExcessProperty: "error" } }
);

const contextSchema = Schema.toStandardSchemaV1(
  Schema.Struct({ context: Schema.NonEmptyString }),
  { parseOptions: { errors: "all", onExcessProperty: "error" } }
);

const actionClient = createSafeActionClient({
  defaultValidationErrorsShape: "flattened",
  handleServerError: (error) =>
    error instanceof Error ? error.message : "Synthetic server failure",
});

const saveAction = actionClient
  .inputSchema(saveSchema)
  .action(async ({ parsedInput }) => handleSave(parsedInput));

// The hook only calls the safe action function itself, so this wrapper can
// simulate a genuine transport rejection that bypasses safe-action error
// handling, exactly like a failed server-action network call.
let transportFailNext = false;
const saveMarketingPreferencesAction = ((input: SyntheticSaveInput) =>
  transportFailNext
    ? Promise.reject(new Error("Synthetic transport failure"))
    : saveAction(input)) as typeof saveAction;

const confirmAction = actionClient
  .inputSchema(contextSchema)
  .action(async () => handleConfirm());

const clearAction = actionClient
  .inputSchema(contextSchema)
  .action(async () => handleClear());

let confirmTransportFailNext = false;
const confirmMarketingManagementAction = ((input: SyntheticManagementInput) =>
  confirmTransportFailNext
    ? Promise.reject(new Error("Synthetic transport failure"))
    : confirmAction(input)) as typeof confirmAction;

let clearTransportFailNext = false;
const clearMarketingManagementAction = ((input: SyntheticManagementInput) =>
  clearTransportFailNext
    ? Promise.reject(new Error("Synthetic transport failure"))
    : clearAction(input)) as typeof clearAction;

mock.module("@/features/legal/actions", () => ({
  clearMarketingManagementAction,
  confirmMarketingManagementAction,
  saveMarketingPreferencesAction,
}));

const { MarketingPreferencesForm } = await import(
  "./marketing-preferences-form"
);

beforeAll(registerWorkspaceComponentTestEnv);

afterEach(() => {
  cleanup();
  handleSave.mockClear();
  handleConfirm.mockClear();
  handleClear.mockClear();
  routerRefresh.mockClear();
  transportFailNext = false;
  confirmTransportFailNext = false;
  clearTransportFailNext = false;
});

afterAll(unregisterWorkspaceComponentTestEnv);

function renderForm(
  state: MarketingPreferencesState = {
    context: "synthetic-real-hook-context",
    source: "account",
    status: "absent",
  },
  locale: "en-US" | "cs-CZ" = "en-US"
) {
  return render(
    <MarketingPreferencesForm accountsEnabled locale={locale} state={state} />
  );
}

function getSwitch(view: ReturnType<typeof render>) {
  return view.getByRole("switch", {
    name: m.marketingPreferencesFormRowTitle({}, { locale: "en-US" }),
  });
}

// Resolves as a MutationObserver microtask as soon as the committed DOM
// satisfies `check`, without flushing React's post-paint passive effects
// first. This observes the exact window a fast user (or the CI runner) hits:
// the UI looks interactive, but settlement processing has not run yet.
function waitForDomState(
  view: ReturnType<typeof render>,
  check: () => boolean
) {
  return new Promise<void>((resolve, reject) => {
    if (check()) {
      resolve();
      return;
    }
    const observer = new MutationObserver(() => {
      if (check()) {
        observer.disconnect();
        resolve();
      }
    });
    observer.observe(view.container, {
      attributes: true,
      childList: true,
      subtree: true,
    });
    const timeout = setTimeout(() => {
      observer.disconnect();
      reject(new Error("Expected DOM state was never observed"));
    }, 5000);
    timeout.unref?.();
  });
}

function isInteractiveAlert(view: ReturnType<typeof render>, text: string) {
  try {
    expect(view.getByRole("alert").textContent).toBe(text);
    expect(getSwitch(view).hasAttribute("disabled")).toBe(false);
    return true;
  } catch {
    return false;
  }
}

function alertVisible(view: ReturnType<typeof render>, text: string) {
  try {
    expect(view.getByRole("alert").textContent).toBe(text);
    return true;
  } catch {
    return false;
  }
}

// Yields macrotasks so a passive-effect delivery scheduled by the hook (such
// as the duplicate onError delivery for a transport rejection) has landed.
// Used while a newer attempt is deliberately held in flight to observe that
// the duplicate cannot resurface stale settlement.
async function drainPassiveDeliveries() {
  for (let i = 0; i < 10; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

test("issues a retry save after a handled server error as soon as the error UI and the enabled switch are visible", async () => {
  handleSave.mockImplementationOnce(() => {
    throw new Error("Synthetic preference save failure");
  });
  const view = renderForm();

  fireEvent.click(getSwitch(view));

  await waitForDomState(view, () =>
    isInteractiveAlert(view, "Synthetic preference save failure")
  );

  fireEvent.click(getSwitch(view));
  await waitFor(() => {
    expect(handleSave).toHaveBeenCalledTimes(2);
    expect(handleSave).toHaveBeenNthCalledWith(2, {
      confirmed: true,
      context: "synthetic-real-hook-context",
      granted: true,
      locale: "en-US",
      source: "account",
    });
    expect(getSwitch(view).getAttribute("aria-checked")).toBe("true");
    expect(routerRefresh).toHaveBeenCalledTimes(1);
  });
  expect(
    view.getByText(m.marketingPreferencesFormSaved({}, { locale: "en-US" }))
  ).toBeTruthy();
});

test("issues a retry save after a transport rejection with real hook scheduling", async () => {
  transportFailNext = true;
  const view = renderForm();

  fireEvent.click(getSwitch(view));

  await waitForDomState(view, () =>
    isInteractiveAlert(
      view,
      m.marketingPreferencesFormSaveError({}, { locale: "en-US" })
    )
  );

  // The retry must reach the real server action, not the transport stub.
  transportFailNext = false;

  fireEvent.click(getSwitch(view));
  await waitFor(() => {
    expect(handleSave).toHaveBeenCalledTimes(1);
    expect(handleSave).toHaveBeenNthCalledWith(1, {
      confirmed: true,
      context: "synthetic-real-hook-context",
      granted: true,
      locale: "en-US",
      source: "account",
    });
    expect(getSwitch(view).getAttribute("aria-checked")).toBe("true");
  });
});

test("accepts a click the instant the settled switch renders enabled, before the error feedback commit", async () => {
  // Discriminating regression for the settled-control window: the real hook
  // commits the action result (busy flips false, the switch renders enabled)
  // in a transition and delivers onError/onSuccess from a passive effect one
  // paint later. A click in that window must not be silently dropped.
  handleSave.mockImplementationOnce(() => {
    throw new Error("Synthetic preference save failure");
  });
  const view = renderForm();

  fireEvent.click(getSwitch(view));

  await waitForDomState(view, () => {
    try {
      expect(getSwitch(view).hasAttribute("disabled")).toBe(false);
      return true;
    } catch {
      return false;
    }
  });

  fireEvent.click(getSwitch(view));
  await waitFor(() => {
    expect(handleSave).toHaveBeenCalledTimes(2);
    expect(
      (handleSave.mock.calls[1]?.[0] as SyntheticSaveInput | undefined)?.granted
    ).toBe(true);
  });
  expect(
    view.getByText(m.marketingPreferencesFormSaved({}, { locale: "en-US" }))
  ).toBeTruthy();
});

test("keeps the control interactive after a resolved success settlement", async () => {
  const view = renderForm();

  fireEvent.click(getSwitch(view));
  await waitFor(() => {
    expect(handleSave).toHaveBeenCalledTimes(1);
    expect(
      view.getByText(m.marketingPreferencesFormSaved({}, { locale: "en-US" }))
    ).toBeTruthy();
    expect(routerRefresh).toHaveBeenCalledTimes(1);
  });

  // An opposite toggle right after the success settlement must issue the
  // second save instead of being silently dropped.
  fireEvent.click(getSwitch(view));
  await waitFor(() => {
    expect(handleSave).toHaveBeenCalledTimes(2);
    expect(
      (handleSave.mock.calls[1]?.[0] as SyntheticSaveInput | undefined)?.granted
    ).toBe(false);
  });
});

test("a confirm retry in flight is not clobbered by the duplicate delivery of the transport-failed attempt", async () => {
  confirmTransportFailNext = true;
  let resolveRetry!: (value: { status: "confirmed" }) => void;
  handleConfirm.mockImplementationOnce(
    () =>
      new Promise<{ status: "confirmed" }>((resolve) => {
        resolveRetry = resolve;
      })
  );
  const view = renderForm({
    context: "synthetic-real-hook-context",
    dismissalContext: "synthetic-real-hook-dismissal-context",
    status: "pending-link",
  });
  const continueButton = view.getByRole("button", {
    name: m.marketingPreferencesFormContinueAction({}, { locale: "en-US" }),
  });

  fireEvent.click(continueButton);
  await waitForDomState(view, () => {
    try {
      expect(
        alertVisible(
          view,
          m.marketingPreferencesFormConfirmError({}, { locale: "en-US" })
        )
      ).toBe(true);
      expect(continueButton.hasAttribute("disabled")).toBe(false);
      return true;
    } catch {
      return false;
    }
  });

  confirmTransportFailNext = false;
  fireEvent.click(continueButton);
  await waitFor(() => expect(handleConfirm).toHaveBeenCalledTimes(1));

  // The first attempt's duplicate passive-effect delivery must not resurface
  // its stale error feedback while the retry is still in flight.
  await drainPassiveDeliveries();
  expect(
    alertVisible(
      view,
      m.marketingPreferencesFormConfirmError({}, { locale: "en-US" })
    )
  ).toBe(false);

  resolveRetry({ status: "confirmed" });
  await waitFor(() => {
    expect(
      view.getByText(
        m.marketingPreferencesFormConfirmed({}, { locale: "en-US" })
      )
    ).toBeTruthy();
    expect(routerRefresh).toHaveBeenCalledTimes(1);
  });
});

test("a clear retry in flight is not clobbered by the duplicate delivery of the transport-failed attempt", async () => {
  clearTransportFailNext = true;
  let resolveRetry!: (value: { status: "cleared" }) => void;
  handleClear.mockImplementationOnce(
    () =>
      new Promise<{ status: "cleared" }>((resolve) => {
        resolveRetry = resolve;
      })
  );
  const view = renderForm({
    dismissalContext: "synthetic-real-hook-dismissal-context",
    status: "invalid-link",
  });
  const clearButton = view.getByRole("button", {
    name: m.marketingPreferencesFormClearAction({}, { locale: "en-US" }),
  });

  fireEvent.click(clearButton);
  await waitForDomState(view, () => {
    try {
      expect(
        alertVisible(
          view,
          m.marketingPreferencesFormClearError({}, { locale: "en-US" })
        )
      ).toBe(true);
      expect(clearButton.hasAttribute("disabled")).toBe(false);
      return true;
    } catch {
      return false;
    }
  });

  clearTransportFailNext = false;
  fireEvent.click(clearButton);
  await waitFor(() => expect(handleClear).toHaveBeenCalledTimes(1));

  await drainPassiveDeliveries();
  expect(
    alertVisible(
      view,
      m.marketingPreferencesFormClearError({}, { locale: "en-US" })
    )
  ).toBe(false);

  resolveRetry({ status: "cleared" });
  await waitFor(() => {
    expect(
      view.getByText(m.marketingPreferencesFormCleared({}, { locale: "en-US" }))
    ).toBeTruthy();
  });
});
