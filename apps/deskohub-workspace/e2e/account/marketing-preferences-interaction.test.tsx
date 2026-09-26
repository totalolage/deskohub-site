import { afterAll, afterEach, beforeAll, expect, mock, test } from "bun:test";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { useState } from "react";
import { m } from "@/features/i18n";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";
import {
  managedPreferenceSelector,
  managedPreferenceSourceSelector,
} from "./marketing-preferences";

type SaveInput = {
  readonly confirmed: true;
  readonly context: string;
  readonly granted: boolean;
  readonly locale: string;
  readonly source: "account" | "link";
};

const saveMarketingPreferencesAction = mock((_input: SaveInput) =>
  Promise.resolve({ data: { status: "saved" } })
);
const confirmMarketingManagementAction = mock(() =>
  Promise.resolve({ data: { status: "confirmed" } })
);
const clearMarketingManagementAction = mock(() =>
  Promise.resolve({ data: { status: "cleared" } })
);
const routerRefresh = mock(() => undefined);

mock.module("@/features/legal/actions", () => ({
  clearMarketingManagementAction,
  confirmMarketingManagementAction,
  saveMarketingPreferencesAction,
}));

mock.module("next/navigation", () => ({
  useParams: () => ({}),
  usePathname: () => "/en-US/account/legal",
  useRouter: () => ({ refresh: routerRefresh }),
  useSearchParams: () => new URLSearchParams(),
}));

mock.module("@/shared/utils/use-workspace-action", () => ({
  useWorkspaceAction: (
    action: (input: unknown) => Promise<{ serverError?: string }>,
    options: {
      onSuccess?: (args: { readonly data?: unknown; readonly input: unknown }) => void;
      onError?: (args: { readonly error: unknown }) => void;
    }
  ) => {
    const [isExecuting, setIsExecuting] = useState(false);
    const execute = (input: unknown) => {
      setIsExecuting(true);
      void action(input)
        .then((result) => {
          setIsExecuting(false);
          if (result.serverError) {
            options.onError?.({ error: result });
            return;
          }
          options.onSuccess?.({ input });
        })
        .catch((error: unknown) => {
          setIsExecuting(false);
          options.onError?.({ error });
        });
    };
    return { execute, isExecuting, reset: () => undefined, result: {} };
  },
}));

const { MarketingPreferencesForm } = await import(
  "@/features/legal/components/marketing-preferences-form"
);


let releaseSave: (() => void) | undefined;
const deferSave = () => {
  saveMarketingPreferencesAction.mockImplementation(
    () =>
      new Promise<{ data: { status: string } }>((resolve) => {
        releaseSave = () => resolve({ data: { status: "saved" } });
      })
  );
};

beforeAll(registerWorkspaceComponentTestEnv);

afterEach(() => {
  cleanup();
  releaseSave = undefined;
  saveMarketingPreferencesAction.mockClear();
  saveMarketingPreferencesAction.mockImplementation(() =>
    Promise.resolve({ data: { status: "saved" } })
  );
});

afterAll(unregisterWorkspaceComponentTestEnv);

const renderManaged = (
  status: "active" | "withdrawn",
  source: "account" | "link"
) =>
  render(
    <MarketingPreferencesForm
      locale="en-US"
      state={
        source === "account"
          ? { context: "synthetic-context", source, status }
          : {
              context: "synthetic-context",
              dismissalContext: "synthetic-dismissal",
              source,
              status,
            }
      }
    />
  );

const helperSwitchSelector = (source: "account" | "link") =>
  `${managedPreferenceSourceSelector(source)} [role="switch"]`;

test("helper managed selectors match the production section and switch", () => {
  renderManaged("active", "account");

  expect(
    document.querySelectorAll(managedPreferenceSelector("active", "account"))
  ).toHaveLength(1);
  expect(
    document.querySelectorAll(managedPreferenceSourceSelector("account"))
  ).toHaveLength(1);
  expect(
    document.querySelectorAll(managedPreferenceSelector("withdrawn", "account"))
  ).toHaveLength(0);

  const switchEl = document.querySelector<HTMLButtonElement>(
    helperSwitchSelector("account")
  );
  expect(switchEl).not.toBeNull();
  expect(switchEl?.getAttribute("aria-checked")).toBe("true");

  const switchTitleId = switchEl?.getAttribute("aria-labelledby");
  expect(switchTitleId).not.toBeNull();
  expect(document.getElementById(switchTitleId ?? "")?.textContent).toBe(
    m.marketingPreferencesFormRowTitle({}, { locale: "en-US" })
  );
});

test("helper selectors keep the link context exclusive to link management", () => {
  const linkView = renderManaged("withdrawn", "link");
  const linkSection = document.querySelector(
    managedPreferenceSelector("withdrawn", "link")
  );
  expect(linkSection?.textContent).toContain(m.marketingPreferencesFormLinkContext({}, { locale: "en-US" }));
  expect(linkSection?.textContent).not.toContain(m.marketingPreferencesFormAccountContext({}, { locale: "en-US" }));
  linkView.unmount();

  renderManaged("active", "account");
  const accountSection = document.querySelector(
    managedPreferenceSelector("active", "account")
  );
  expect(accountSection?.textContent).not.toContain(m.marketingPreferencesFormLinkContext({}, { locale: "en-US" }));
  expect(accountSection?.textContent).not.toContain(m.marketingPreferencesFormStatusActive({}, { locale: "en-US" }));
  expect(accountSection?.textContent).not.toContain(m.marketingPreferencesFormStatusWithdrawn({}, { locale: "en-US" }));
});

test("the transition switch shows the target state while the save is pending", async () => {
  deferSave();
  renderManaged("active", "account");

  const switchEl = document.querySelector<HTMLButtonElement>(
    helperSwitchSelector("account")
  );
  expect(switchEl?.getAttribute("aria-checked")).toBe("true");

  fireEvent.click(switchEl!);

  expect(saveMarketingPreferencesAction).toHaveBeenCalledWith({
    confirmed: true,
    context: "synthetic-context",
    granted: false,
    locale: "en-US",
    source: "account",
  });
  // Pending save: the switch is disabled and already reads the target state.
  expect(
    document
      .querySelector<HTMLButtonElement>(helperSwitchSelector("account"))
      ?.hasAttribute("disabled")
  ).toBe(true);
  expect(
    document
      .querySelector<HTMLButtonElement>(helperSwitchSelector("account"))
      ?.getAttribute("aria-checked")
  ).toBe("false");

  await act(async () => {
    releaseSave?.();
  });
  expect(releaseSave).toBeDefined();
  expect(
    document
      .querySelector<HTMLButtonElement>(helperSwitchSelector("account"))
      ?.getAttribute("aria-checked")
  ).toBe("false");
});
