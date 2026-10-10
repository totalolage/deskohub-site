import { afterAll, afterEach, beforeAll, expect, mock, test } from "bun:test";
import {
  act,
  cleanup,
  fireEvent,
  render,
  waitFor,
} from "@testing-library/react";
import { type Locale, m } from "@/features/i18n";
import {
  flushWorkspaceComponentWork,
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";

type MarketingPreferenceSaveInput = {
  readonly confirmed: true;
  readonly context: string;
  readonly granted: boolean;
  readonly locale: Locale;
  readonly source: "link" | "account";
};

type MarketingActionInput =
  | MarketingPreferenceSaveInput
  | { readonly context: string };

type MarketingAction = (input: MarketingActionInput) => Promise<unknown>;

type ActionOptions = {
  readonly onError?: (args: {
    readonly error: { readonly thrownError?: Error };
    readonly input: MarketingActionInput;
  }) => void;
  readonly onSuccess?: (args: { readonly input: MarketingActionInput }) => void;
  readonly onTransportError?: (args: {
    readonly error: unknown;
    readonly input: MarketingActionInput;
  }) => void;
};

const saveMarketingPreferencesAction = mock((_input: MarketingActionInput) =>
  Promise.resolve({ data: {} })
);
const confirmMarketingManagementAction = mock((_input: MarketingActionInput) =>
  Promise.resolve({ data: {} })
);
const clearMarketingManagementAction = mock((_input: MarketingActionInput) =>
  Promise.resolve({ data: {} })
);
const routerRefresh = mock(() => undefined);
const saveCalls: MarketingActionInput[] = [];
const delayedTransportErrors: Array<() => void> = [];
let transportErrorCalls = 0;

mock.module("@/features/legal/actions", () => ({
  clearMarketingManagementAction,
  confirmMarketingManagementAction,
  saveMarketingPreferencesAction,
}));

mock.module("next/navigation", () => ({
  useRouter: () => ({ refresh: routerRefresh }),
}));

mock.module("@/shared/utils/use-workspace-action", () => ({
  useWorkspaceAction: (action: MarketingAction, options: ActionOptions) => {
    const executeAsync = async (input: MarketingActionInput) => {
      if (action === saveMarketingPreferencesAction) {
        saveCalls.push(input);
        if (saveCalls.length === 1) {
          const error = new Error("Synthetic fast transport failure");
          if (options.onTransportError) {
            transportErrorCalls += 1;
            options.onTransportError({ error, input });
          }
          delayedTransportErrors.push(() =>
            options.onError?.({ error: { thrownError: error }, input })
          );
          throw error;
        }
        options.onSuccess?.({ input });
      }
      return { data: { status: "saved" } };
    };

    return {
      execute: (input: MarketingActionInput) => {
        void executeAsync(input).catch(() => undefined);
      },
      executeAsync,
      isExecuting: false,
    };
  },
}));

const { MarketingPreferencesForm } = await import(
  "./marketing-preferences-form"
);

beforeAll(registerWorkspaceComponentTestEnv);
afterEach(() => {
  cleanup();
  saveCalls.length = 0;
  delayedTransportErrors.length = 0;
  transportErrorCalls = 0;
  routerRefresh.mockClear();
});
afterAll(async () => {
  cleanup();
  await flushWorkspaceComponentWork();
  unregisterWorkspaceComponentTestEnv();
});

test("retries a fast rejected save after the rendered busy state stays false", async () => {
  const context = "synthetic-fast-retry-context";
  const view = render(
    <MarketingPreferencesForm
      locale="en-US"
      state={{ context, source: "account", status: "absent" }}
    />
  );
  const marketingSwitch = view.getByRole("switch", {
    name: m.marketingPreferencesFormRowTitle({}, { locale: "en-US" }),
  });

  expect(marketingSwitch.getAttribute("aria-checked")).toBe("false");
  fireEvent.click(marketingSwitch);
  await waitFor(() => {
    expect(view.getByRole("alert").textContent).toBe(
      m.marketingPreferencesFormSaveError({}, { locale: "en-US" })
    );
    expect(marketingSwitch.hasAttribute("disabled")).toBe(false);
  });
  expect(marketingSwitch.getAttribute("aria-checked")).toBe("false");
  expect(saveCalls).toHaveLength(1);
  expect(transportErrorCalls).toBe(1);

  fireEvent.click(marketingSwitch);
  await waitFor(() => {
    expect(saveCalls).toHaveLength(2);
    expect(saveCalls[1]).toEqual({
      confirmed: true,
      context,
      granted: true,
      locale: "en-US",
      source: "account",
    });
    expect(routerRefresh).toHaveBeenCalledTimes(1);
    expect(
      view.getByText(m.marketingPreferencesFormSaved({}, { locale: "en-US" }))
    ).toBeTruthy();
  });
  expect(marketingSwitch.getAttribute("aria-checked")).toBe("true");

  // next-safe-action reports a rejected action through onError as well as the
  // workspace transport handler. A delayed old error callback must not undo a
  // later successful retry.
  act(() => delayedTransportErrors[0]?.());
  expect(marketingSwitch.getAttribute("aria-checked")).toBe("true");
  expect(transportErrorCalls).toBe(1);
  expect(view.queryByRole("alert")).toBeNull();
  expect(
    view.getByText(m.marketingPreferencesFormSaved({}, { locale: "en-US" }))
  ).toBeTruthy();
});
