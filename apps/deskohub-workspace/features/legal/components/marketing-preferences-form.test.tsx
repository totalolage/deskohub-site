import { afterAll, afterEach, beforeAll, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { useState } from "react";
import type { Locale } from "@/features/i18n";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";
import {
  type MarketingPreferencesFormCopy,
  marketingPreferencesFormCopy,
} from "./marketing-preferences-form.copy";

type MarketingPreferenceSaveInput = {
  readonly confirmed: true;
  readonly context: string;
  readonly granted: boolean;
  readonly locale: Locale;
  readonly source: "link" | "account";
};

type MarketingManagementConfirmInput = {
  readonly context: string;
};

type MarketingManagementClearInput = {
  readonly context: string;
};

type ActionResult = {
  readonly data?: unknown;
  readonly serverError?: string;
  readonly validationErrors?: unknown;
};

type ActionInput =
  | MarketingPreferenceSaveInput
  | MarketingManagementConfirmInput
  | MarketingManagementClearInput;
type Action = (input: ActionInput) => Promise<ActionResult>;

type ActionOptions = {
  readonly onError?: (args: { readonly error: unknown }) => void;
  readonly onSuccess?: (args: { readonly data?: unknown }) => void;
  readonly onTransportError?: (args: {
    readonly error: unknown;
    readonly input: unknown;
  }) => void;
};

const saveMarketingPreferencesAction = mock(
  (_input: MarketingPreferenceSaveInput): Promise<ActionResult> =>
    Promise.resolve({ data: { status: "saved" } })
);
const confirmMarketingManagementAction = mock(
  (_input: MarketingManagementConfirmInput): Promise<ActionResult> =>
    Promise.resolve({ data: { status: "confirmed" } })
);
const clearMarketingManagementAction = mock(
  (_input: MarketingManagementClearInput): Promise<ActionResult> =>
    Promise.resolve({ data: { status: "cleared" } })
);
const routerRefresh = mock(() => undefined);

mock.module("@/features/legal/actions", () => ({
  clearMarketingManagementAction,
  confirmMarketingManagementAction,
  saveMarketingPreferencesAction,
}));

mock.module("next/navigation", () => ({
  useRouter: () => ({ refresh: routerRefresh }),
}));

mock.module("@/shared/utils/use-workspace-action", () => ({
  useWorkspaceAction: (action: Action, options: ActionOptions) => {
    const [result, setResult] = useState<ActionResult>({});
    const [isExecuting, setIsExecuting] = useState(false);

    const reset = () => setResult({});
    const execute = (input: ActionInput) => {
      setIsExecuting(true);
      void action(input)
        .then((nextResult) => {
          setResult(nextResult);
          setIsExecuting(false);
          if (nextResult.serverError || nextResult.validationErrors) {
            options.onError?.({ error: nextResult });
            return;
          }
          options.onSuccess?.({ data: nextResult.data });
        })
        .catch((error: Error) => {
          setIsExecuting(false);
          options.onTransportError?.({ error, input });
        });
    };

    return { execute, isExecuting, reset, result };
  },
}));

const { MarketingPreferencesForm } = await import(
  "./marketing-preferences-form"
);

type MarketingPreferencesState =
  | {
      readonly status: "absent" | "active" | "withdrawn";
      readonly source: "link";
      readonly context: string;
      readonly dismissalContext: string;
    }
  | {
      readonly status: "absent" | "active" | "withdrawn";
      readonly source: "account";
      readonly context: string;
    }
  | {
      readonly status: "pending-link";
      readonly context: string;
      readonly dismissalContext: string;
    }
  | { readonly status: "invalid-link"; readonly dismissalContext: string }
  | { readonly status: "unavailable" };

beforeAll(registerWorkspaceComponentTestEnv);

afterEach(() => {
  cleanup();
  saveMarketingPreferencesAction.mockClear();
  confirmMarketingManagementAction.mockClear();
  clearMarketingManagementAction.mockClear();
  routerRefresh.mockClear();
});

afterAll(unregisterWorkspaceComponentTestEnv);

function renderForm(
  state: MarketingPreferencesState,
  locale: Locale = "en-US",
  copy?: MarketingPreferencesFormCopy,
  accountsEnabled = true
) {
  return render(
    <MarketingPreferencesForm
      accountsEnabled={accountsEnabled}
      locale={locale}
      state={state}
      copy={copy}
    />
  );
}

function getSwitch(
  view: ReturnType<typeof render>,
  name: string = marketingPreferencesFormCopy["en-US"].rowTitle
) {
  return view.getByRole("switch", { name });
}

function getArticle(view: ReturnType<typeof render>) {
  const article = view.container.querySelector("article");
  if (!article) throw new Error("Marketing preference row was not rendered");
  return article;
}

test("renders every localized preference state", () => {
  for (const locale of ["en-US", "cs-CZ"] as const) {
    const copy = marketingPreferencesFormCopy[locale];
    const states = [
      {
        context: "synthetic-account-context",
        source: "account",
        status: "absent",
      },
      {
        context: "synthetic-account-context",
        source: "account",
        status: "active",
      },
      {
        context: "synthetic-account-context",
        source: "account",
        status: "withdrawn",
      },
      {
        context: "synthetic-pending-context",
        dismissalContext: "synthetic-pending-dismissal-context",
        status: "pending-link",
      },
      { status: "unavailable" },
      {
        dismissalContext: "synthetic-invalid-dismissal-context",
        status: "invalid-link",
      },
    ] as const;

    for (const state of states) {
      const view = renderForm(state, locale);
      expect(
        view.container.querySelector(
          `[data-marketing-preferences="${state.status}"]`
        )
      ).toBeTruthy();

      const stateCopy = {
        absent: copy.rowTitle,
        active: copy.rowTitle,
        withdrawn: copy.rowTitle,
        "pending-link": copy.pendingDescription,
        unavailable: copy.unavailableDescription,
        "invalid-link": copy.invalidLinkDescription,
      }[state.status];
      expect(view.getByText(stateCopy)).toBeTruthy();
      cleanup();
    }
  }
});

test("saves a grant immediately without a confirmation gate", async () => {
  const copy = marketingPreferencesFormCopy["en-US"];
  const context = "synthetic-link-save-context";
  const view = renderForm({
    context,
    dismissalContext: "synthetic-link-dismissal-context",
    status: "absent",
    source: "link",
  });
  const marketingSwitch = getSwitch(view, copy.rowTitle);

  expect(marketingSwitch.getAttribute("aria-checked")).toBe("false");
  fireEvent.click(marketingSwitch);

  await waitFor(() => {
    expect(saveMarketingPreferencesAction).toHaveBeenCalledWith({
      confirmed: true,
      context,
      granted: true,
      locale: "en-US",
      source: "link",
    });
  });
  expect(routerRefresh).toHaveBeenCalledTimes(1);
  await waitFor(() => {
    expect(view.getByText(copy.saved)).toBeTruthy();
    expect(getSwitch(view, copy.rowTitle).getAttribute("aria-checked")).toBe(
      "true"
    );
  });
});

test.each([
  ["active", false],
  ["withdrawn", true],
] as const)("saves the rendered %s choice", async (status, granted) => {
  const copy = marketingPreferencesFormCopy["en-US"];
  const view = renderForm({
    context: `synthetic-${status}-context`,
    dismissalContext: `synthetic-${status}-dismissal-context`,
    source: "link",
    status,
  });
  const marketingSwitch = getSwitch(view, copy.rowTitle);

  expect(marketingSwitch.getAttribute("aria-checked")).toBe(
    status === "active" ? "true" : "false"
  );
  fireEvent.click(marketingSwitch);

  await waitFor(() => {
    expect(saveMarketingPreferencesAction).toHaveBeenCalledWith({
      confirmed: true,
      context: `synthetic-${status}-context`,
      granted,
      locale: "en-US",
      source: "link",
    });
  });
});

test("keeps a deferred save single-flight and announces the pending state", async () => {
  const copy = marketingPreferencesFormCopy["en-US"];
  let resolveSave!: (result: ActionResult) => void;
  saveMarketingPreferencesAction.mockImplementationOnce(
    () =>
      new Promise<ActionResult>((resolve) => {
        resolveSave = resolve;
      })
  );
  const view = renderForm({
    context: "synthetic-account-context",
    source: "account",
    status: "absent",
  });
  const marketingSwitch = getSwitch(view, copy.rowTitle);

  fireEvent.click(marketingSwitch);
  fireEvent.click(marketingSwitch);

  await waitFor(() => {
    expect(saveMarketingPreferencesAction).toHaveBeenCalledTimes(1);
    expect(getArticle(view).getAttribute("aria-busy")).toBe("true");
  });
  expect(marketingSwitch.hasAttribute("disabled")).toBe(true);
  expect(marketingSwitch.getAttribute("aria-checked")).toBe("false");
  expect(view.getByRole("status").textContent).toBe(copy.savingStatus);

  resolveSave({ data: { status: "saved" } });
  await waitFor(() => {
    expect(getSwitch(view, copy.rowTitle).getAttribute("aria-checked")).toBe(
      "true"
    );
  });
});

test("preserves the server-authoritative switch on a save failure and allows retry", async () => {
  const copy = marketingPreferencesFormCopy["en-US"];
  let rejectFirst!: (result: ActionResult) => void;
  saveMarketingPreferencesAction.mockImplementationOnce(
    () =>
      new Promise<ActionResult>((resolve) => {
        rejectFirst = resolve;
      })
  );
  const context = "synthetic-account-context";
  const view = renderForm({
    context,
    source: "account",
    status: "absent",
  });
  const marketingSwitch = getSwitch(view, copy.rowTitle);

  fireEvent.click(marketingSwitch);
  rejectFirst({ serverError: "Synthetic preference save failure" });

  await waitFor(() => {
    expect(view.getByRole("alert").textContent).toContain(
      "Synthetic preference save failure"
    );
  });
  expect(getSwitch(view, copy.rowTitle).getAttribute("aria-checked")).toBe(
    "false"
  );
  expect(getSwitch(view, copy.rowTitle).hasAttribute("disabled")).toBe(false);

  fireEvent.click(getSwitch(view, copy.rowTitle));
  await waitFor(() => {
    expect(saveMarketingPreferencesAction).toHaveBeenNthCalledWith(2, {
      confirmed: true,
      context,
      granted: true,
      locale: "en-US",
      source: "account",
    });
  });
});

test("announces a rejected save request with localized copy and allows a successful retry", async () => {
  const copy = marketingPreferencesFormCopy["en-US"];
  const context = "synthetic-account-context";
  saveMarketingPreferencesAction.mockImplementationOnce(() =>
    Promise.reject(new Error("Synthetic transport failure"))
  );
  const view = renderForm({
    context,
    source: "account",
    status: "absent",
  });
  const marketingSwitch = getSwitch(view, copy.rowTitle);

  fireEvent.click(marketingSwitch);

  await waitFor(() => {
    expect(view.getByRole("alert").textContent).toBe(copy.saveError);
  });
  expect(marketingSwitch.getAttribute("aria-checked")).toBe("false");
  expect(marketingSwitch.hasAttribute("disabled")).toBe(false);
  expect(routerRefresh).not.toHaveBeenCalled();

  fireEvent.click(getSwitch(view, copy.rowTitle));
  await waitFor(() => {
    expect(saveMarketingPreferencesAction).toHaveBeenNthCalledWith(2, {
      confirmed: true,
      context,
      granted: true,
      locale: "en-US",
      source: "account",
    });
    expect(getSwitch(view, copy.rowTitle).getAttribute("aria-checked")).toBe(
      "true"
    );
    expect(routerRefresh).toHaveBeenCalledTimes(1);
  });
  expect(view.getByText(copy.saved)).toBeTruthy();
});

test("keeps a pending dedicated-link context inaccessible until Continue and prevents duplicate requests", async () => {
  const copy = marketingPreferencesFormCopy["en-US"];
  const context = "synthetic-pending-confirm-context";
  const view = renderForm({
    context,
    dismissalContext: "synthetic-pending-dismissal-context",
    status: "pending-link",
  });
  const continueButton = view.getByRole("button", {
    name: copy.continueAction,
  });

  expect(
    view.queryByRole("switch", {
      name: copy.rowTitle,
    })
  ).toBeNull();
  fireEvent.click(continueButton);

  await waitFor(() => {
    expect(confirmMarketingManagementAction).toHaveBeenCalledWith({ context });
  });
  expect(routerRefresh).toHaveBeenCalledTimes(1);
  expect(view.getByText(copy.confirmed)).toBeTruthy();
  expect(view.container.textContent).not.toContain(context);
});

test("keeps a pending context after a continuation failure", async () => {
  const copy = marketingPreferencesFormCopy["en-US"];
  confirmMarketingManagementAction.mockImplementationOnce(() =>
    Promise.resolve({ serverError: "Synthetic continuation failure" })
  );
  const view = renderForm({
    context: "synthetic-pending-confirm-context",
    dismissalContext: "synthetic-pending-dismissal-context",
    status: "pending-link",
  });

  fireEvent.click(view.getByRole("button", { name: copy.continueAction }));

  await waitFor(() => {
    expect(view.getByRole("alert").textContent).toContain(
      "Synthetic continuation failure"
    );
  });
  expect(routerRefresh).not.toHaveBeenCalled();
  expect(view.getByText(copy.pendingDescription)).toBeTruthy();
  expect(
    view.queryByRole("switch", {
      name: copy.rowTitle,
    })
  ).toBeNull();
});

test("uses signed-in account copy and no link-clear control for account source", () => {
  const copy = marketingPreferencesFormCopy["en-US"];
  const view = renderForm({
    context: "synthetic-account-context",
    source: "account",
    status: "absent",
  });

  expect(view.queryByText(copy.accountContext)).toBeNull();
  expect(view.queryByText(copy.linkContext)).toBeNull();
  expect(view.queryByRole("button", { name: copy.clearAction })).toBeNull();
});

test("resets a stale save error when the dismissal context changes", async () => {
  const copy = marketingPreferencesFormCopy["en-US"];
  saveMarketingPreferencesAction.mockImplementationOnce(() =>
    Promise.resolve({ serverError: "Synthetic stale save failure" })
  );
  const context = "synthetic-save-context";
  const view = renderForm({
    context,
    dismissalContext: "synthetic-first-dismissal-context",
    source: "link",
    status: "absent",
  });

  fireEvent.click(getSwitch(view, copy.rowTitle));
  await waitFor(() => {
    expect(view.getByRole("alert").textContent).toContain(
      "Synthetic stale save failure"
    );
  });

  view.rerender(
    <MarketingPreferencesForm
      locale="en-US"
      state={{
        context,
        dismissalContext: "synthetic-second-dismissal-context",
        source: "link",
        status: "absent",
      }}
    />
  );

  expect(view.queryByRole("alert")).toBeNull();
  expect(getSwitch(view, copy.rowTitle).getAttribute("aria-checked")).toBe(
    "false"
  );
  expect(view.container.textContent).not.toContain(
    "synthetic-first-dismissal-context"
  );
  expect(view.container.textContent).not.toContain(
    "synthetic-second-dismissal-context"
  );
});

test("renders unavailable guidance without presenting account availability as a flag", () => {
  const copy = marketingPreferencesFormCopy["en-US"];
  const view = renderForm({ status: "unavailable" });

  expect(view.getByText(copy.unavailableNextStep)).toBeTruthy();
  expect(view.getByText(copy.unavailableSignInNextStep)).toBeTruthy();
  expect(
    view.getByRole("link", { name: copy.signInAction }).getAttribute("href")
  ).toBe("/en-US/auth/sign-in");
  expect(
    view.queryByRole("switch", {
      name: copy.rowTitle,
    })
  ).toBeNull();
  expect(view.queryByText(copy.accountContext)).toBeNull();
});

test.each(["en-US", "cs-CZ"] as const)(
  "hides sign-in affordances when accounts are disabled in %s",
  (locale) => {
    const copy = marketingPreferencesFormCopy[locale];
    const view = renderForm(
      { status: "unavailable" },
      locale,
      undefined,
      false
    );

    expect(view.getByText(copy.unavailableNextStep)).toBeTruthy();
    expect(view.queryByText(copy.unavailableSignInNextStep)).toBeNull();
    expect(view.queryByRole("link", { name: copy.signInAction })).toBeNull();
  }
);

test.each(["en-US", "cs-CZ"] as const)(
  "keeps a link-authorized preference actionable when accounts are disabled in %s",
  async (locale) => {
    const copy = marketingPreferencesFormCopy[locale];
    const context = `synthetic-${locale}-link-save-context`;
    const view = renderForm(
      {
        context,
        dismissalContext: `synthetic-${locale}-link-dismissal-context`,
        source: "link",
        status: "absent",
      },
      locale,
      undefined,
      false
    );

    expect(
      view.container.querySelector('[data-marketing-preferences-source="link"]')
    ).toBeTruthy();
    expect(getSwitch(view, copy.rowTitle).hasAttribute("disabled")).toBe(false);

    fireEvent.click(getSwitch(view, copy.rowTitle));

    await waitFor(() => {
      expect(saveMarketingPreferencesAction).toHaveBeenCalledWith({
        confirmed: true,
        context,
        granted: true,
        locale,
        source: "link",
      });
      expect(routerRefresh).toHaveBeenCalledTimes(1);
    });
    expect(view.getByText(copy.saved)).toBeTruthy();
  }
);

test("keeps a pending dedicated link usable when accounts are disabled", async () => {
  const copy = marketingPreferencesFormCopy["en-US"];
  const context = "synthetic-pending-confirm-context";
  const view = renderForm(
    {
      context,
      dismissalContext: "synthetic-pending-dismissal-context",
      status: "pending-link",
    },
    "en-US",
    undefined,
    false
  );

  fireEvent.click(view.getByRole("button", { name: copy.continueAction }));

  await waitFor(() => {
    expect(confirmMarketingManagementAction).toHaveBeenCalledWith({ context });
  });
  expect(view.getByText(copy.confirmed)).toBeTruthy();
});

test("keeps an invalid dedicated link out of the account flow without a fallback", () => {
  const copy = marketingPreferencesFormCopy["en-US"];
  const view = renderForm({
    dismissalContext: "synthetic-invalid-dismissal-context",
    status: "invalid-link",
  });

  expect(view.getByText(copy.invalidLinkDescription)).toBeTruthy();
  expect(view.getByText(copy.invalidLinkNextStep)).toBeTruthy();
  const invalidClearButton = view.getByRole("button", {
    name: copy.clearAction,
  });
  expect(invalidClearButton.className).toContain("!whitespace-normal");
  expect(invalidClearButton.className).toContain("max-w-full");
  expect(invalidClearButton.className).toContain("min-w-0");
  expect(view.queryByRole("link", { name: copy.signInAction })).toBeNull();
  expect(
    view.queryByRole("switch", {
      name: copy.rowTitle,
    })
  ).toBeNull();
  expect(view.queryByRole("button", { name: copy.continueAction })).toBeNull();
  expect(view.getByRole("button", { name: copy.clearAction })).toBeTruthy();
});

test("offers an explicit clear action for a valid dedicated-link context", async () => {
  const copy = marketingPreferencesFormCopy["en-US"];
  const dismissalContext = "synthetic-link-dismissal-context";
  const view = renderForm({
    context: "synthetic-link-save-context",
    dismissalContext,
    status: "active",
    source: "link",
  });
  const clearButton = view.getByRole("button", { name: copy.clearAction });
  expect(clearButton.className).toContain("!whitespace-normal");
  expect(clearButton.className).toContain("max-w-full");
  expect(clearButton.className).toContain("min-w-0");
  expect(clearButton.parentElement?.className).toContain("flex-1");
  expect(
    getArticle(view).querySelector(":scope > button[role='switch']")
  ).toBeTruthy();

  fireEvent.click(view.getByRole("button", { name: copy.clearAction }));
  await waitFor(() => {
    expect(clearMarketingManagementAction).toHaveBeenCalledWith({
      context: dismissalContext,
    });
  });
  expect(routerRefresh).toHaveBeenCalledTimes(1);
});

test.each(["absent", "active", "withdrawn"] as const)(
  "uses the dismissal context when clearing a managed %s link state",
  async (status) => {
    const copy = marketingPreferencesFormCopy["en-US"];
    const dismissalContext = `synthetic-${status}-dismissal-context`;
    const view = renderForm({
      context: `synthetic-${status}-save-context`,
      dismissalContext,
      source: "link",
      status,
    });

    fireEvent.click(view.getByRole("button", { name: copy.clearAction }));

    await waitFor(() => {
      expect(clearMarketingManagementAction).toHaveBeenCalledWith({
        context: dismissalContext,
      });
    });
  }
);

test("clears a pending dedicated-link context with its dismissal context", async () => {
  const copy = marketingPreferencesFormCopy["en-US"];
  const context = "synthetic-pending-confirm-context";
  const dismissalContext = "synthetic-pending-dismissal-context";
  const view = renderForm({
    context,
    dismissalContext,
    status: "pending-link",
  });
  const pendingClearButton = view.getByRole("button", {
    name: copy.clearAction,
  });
  expect(pendingClearButton.className).toContain("!whitespace-normal");
  expect(pendingClearButton.className).toContain("max-w-full");
  expect(pendingClearButton.className).toContain("min-w-0");

  fireEvent.click(view.getByRole("button", { name: copy.clearAction }));

  await waitFor(() => {
    expect(clearMarketingManagementAction).toHaveBeenCalledWith({
      context: dismissalContext,
    });
  });
  expect(routerRefresh).toHaveBeenCalledTimes(1);
  expect(view.getByText(copy.cleared)).toBeTruthy();
});

test("keeps a pending dedicated link after clear failure and allows retry", async () => {
  const copy = marketingPreferencesFormCopy["en-US"];
  const dismissalContext = "synthetic-pending-dismissal-context";
  clearMarketingManagementAction.mockImplementationOnce(() =>
    Promise.resolve({ serverError: "Synthetic pending clear failure" })
  );
  const view = renderForm({
    context: "synthetic-pending-confirm-context",
    dismissalContext,
    status: "pending-link",
  });

  fireEvent.click(view.getByRole("button", { name: copy.clearAction }));
  await waitFor(() => {
    expect(view.getByRole("alert").textContent).toContain(
      "Synthetic pending clear failure"
    );
  });
  expect(view.getByText(copy.pendingDescription)).toBeTruthy();
  expect(view.getByRole("button", { name: copy.continueAction })).toBeTruthy();

  fireEvent.click(view.getByRole("button", { name: copy.clearAction }));
  await waitFor(() => {
    expect(clearMarketingManagementAction).toHaveBeenCalledTimes(2);
    expect(view.getByText(copy.cleared)).toBeTruthy();
  });
  expect(clearMarketingManagementAction).toHaveBeenNthCalledWith(1, {
    context: dismissalContext,
  });
  expect(clearMarketingManagementAction).toHaveBeenNthCalledWith(2, {
    context: dismissalContext,
  });
});

test("clears an invalid dedicated-link context without writing consent", async () => {
  const copy = marketingPreferencesFormCopy["en-US"];
  const dismissalContext = "synthetic-invalid-dismissal-context";
  const view = renderForm({
    dismissalContext,
    status: "invalid-link",
  });

  fireEvent.click(view.getByRole("button", { name: copy.clearAction }));

  await waitFor(() => {
    expect(clearMarketingManagementAction).toHaveBeenCalledWith({
      context: dismissalContext,
    });
  });
  expect(saveMarketingPreferencesAction).not.toHaveBeenCalled();
  expect(confirmMarketingManagementAction).not.toHaveBeenCalled();
  expect(routerRefresh).toHaveBeenCalledTimes(1);
  expect(view.getByText(copy.cleared)).toBeTruthy();
});

test("disables the explicit invalid-link clear action while it is busy", async () => {
  const copy = marketingPreferencesFormCopy["en-US"];
  const dismissalContext = "synthetic-invalid-dismissal-context";
  let resolveClear!: (result: ActionResult) => void;
  clearMarketingManagementAction.mockImplementationOnce(
    () =>
      new Promise<ActionResult>((resolve) => {
        resolveClear = resolve;
      })
  );
  const view = renderForm({
    dismissalContext,
    status: "invalid-link",
  });

  fireEvent.click(view.getByRole("button", { name: copy.clearAction }));
  await waitFor(() => {
    expect(
      view
        .getByRole("button", { name: copy.clearing })
        .getAttribute("aria-busy")
    ).toBe("true");
  });
  expect(
    (view.getByRole("button", { name: copy.clearing }) as HTMLButtonElement)
      .disabled
  ).toBe(true);

  resolveClear({ data: { status: "cleared" } });
  await waitFor(() => expect(view.getByText(copy.cleared)).toBeTruthy());
});

test("announces clear loading, allows retry after an error, and keeps the dismissal payload", async () => {
  const copy = marketingPreferencesFormCopy["en-US"];
  const dismissalContext = "synthetic-link-dismissal-context";
  let resolveClear!: (result: ActionResult) => void;
  clearMarketingManagementAction.mockImplementationOnce(
    () =>
      new Promise<ActionResult>((resolve) => {
        resolveClear = resolve;
      })
  );
  const view = renderForm({
    context: "synthetic-link-save-context",
    dismissalContext,
    source: "link",
    status: "active",
  });
  const clearButton = view.getByRole("button", { name: copy.clearAction });

  fireEvent.click(clearButton);
  fireEvent.click(clearButton);

  await waitFor(() => {
    expect(clearMarketingManagementAction).toHaveBeenCalledTimes(1);
    expect(
      view
        .getByRole("button", { name: copy.clearing })
        .getAttribute("aria-busy")
    ).toBe("true");
  });
  expect((clearButton as HTMLButtonElement).disabled).toBe(true);

  resolveClear({ serverError: "Synthetic clear failure" });
  await waitFor(() => {
    expect(view.getByRole("alert").textContent).toContain(
      "Synthetic clear failure"
    );
  });

  fireEvent.click(view.getByRole("button", { name: copy.clearAction }));
  await waitFor(() => {
    expect(clearMarketingManagementAction).toHaveBeenCalledTimes(2);
    expect(view.getByText(copy.cleared)).toBeTruthy();
  });
  expect(clearMarketingManagementAction).toHaveBeenNthCalledWith(1, {
    context: dismissalContext,
  });
  expect(clearMarketingManagementAction).toHaveBeenNthCalledWith(2, {
    context: dismissalContext,
  });
});

test.each([
  ["en-US", "reservation email"],
  ["cs-CZ", "e-mailu k rezervaci"],
] as const)("uses dedicated marketing-link copy in %s", (locale, forbidden) => {
  const copy = marketingPreferencesFormCopy[locale];
  expect(Object.values(copy).join(" ")).not.toContain(forbidden);
});

test("wraps long localized copy without fixed-width controls", () => {
  const copy = marketingPreferencesFormCopy["cs-CZ"];
  const longCopy: MarketingPreferencesFormCopy = {
    ...copy,
    rowDescription: `${copy.rowDescription} ${"Dlouhý popis. ".repeat(12)}`,
    rowTitle: `${copy.rowTitle} ${"a další podrobnosti".repeat(4)}`,
  };
  const view = renderForm(
    {
      context: "synthetic-account-context",
      status: "absent",
      source: "account",
    },
    "cs-CZ",
    longCopy
  );

  const section = view.container.querySelector("section");
  expect(section?.className).toContain("min-w-0");
  expect(section?.querySelector("article")?.className).toContain("min-w-0");
  expect(section?.querySelector("h3")?.className).toContain("break-words");
  expect(getSwitch(view, longCopy.rowTitle).className).toContain("shrink-0");
});
