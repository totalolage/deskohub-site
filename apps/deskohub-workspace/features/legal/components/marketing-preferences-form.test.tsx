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

function getForm(view: ReturnType<typeof render>) {
  const form = view.container.querySelector("form");
  if (!form) throw new Error("Marketing preference form was not rendered");
  return form;
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
        absent: copy.statusAbsent,
        active: copy.statusActive,
        withdrawn: copy.statusWithdrawn,
        "pending-link": copy.pendingDescription,
        unavailable: copy.unavailableDescription,
        "invalid-link": copy.invalidLinkDescription,
      }[state.status];
      expect(view.getByText(stateCopy)).toBeTruthy();
      cleanup();
    }
  }
});

test("keeps a dedicated-link submission on link source and requires confirmation", async () => {
  const copy = marketingPreferencesFormCopy["en-US"];
  const context = "synthetic-link-save-context";
  const view = renderForm({
    context,
    dismissalContext: "synthetic-link-dismissal-context",
    status: "absent",
    source: "link",
  });
  const saveButton = view.getByRole("button", { name: copy.grantAction });
  const form = getForm(view);

  expect((saveButton as HTMLButtonElement).disabled).toBe(true);
  fireEvent.submit(form);
  expect(saveMarketingPreferencesAction).not.toHaveBeenCalled();

  fireEvent.click(view.getByRole("checkbox", { name: copy.grantConfirmation }));
  expect((saveButton as HTMLButtonElement).disabled).toBe(false);
  fireEvent.submit(form);

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
  expect(view.getByText(copy.saved)).toBeTruthy();
});

test.each([
  ["active", false, "Withdraw marketing communications"],
  ["withdrawn", true, "Allow marketing communications"],
] as const)("saves the rendered %s choice", async (status, granted, label) => {
  const view = renderForm({
    context: `synthetic-${status}-context`,
    dismissalContext: `synthetic-${status}-dismissal-context`,
    source: "link",
    status,
  });
  fireEvent.click(view.getByRole("checkbox"));
  fireEvent.submit(getForm(view));

  await waitFor(() => {
    expect(saveMarketingPreferencesAction).toHaveBeenCalledWith({
      confirmed: true,
      context: `synthetic-${status}-context`,
      granted,
      locale: "en-US",
      source: "link",
    });
  });
  expect(view.getByRole("button", { name: label })).toBeTruthy();
});

test("continues a pending dedicated-link context with its exact opaque context", async () => {
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

  expect(view.queryByRole("checkbox")).toBeNull();
  expect(view.queryByRole("button", { name: copy.grantAction })).toBeNull();
  fireEvent.click(continueButton);

  await waitFor(() => {
    expect(confirmMarketingManagementAction).toHaveBeenCalledWith({ context });
  });
  expect(routerRefresh).toHaveBeenCalledTimes(1);
  expect(view.getByText(copy.confirmed)).toBeTruthy();
  expect(view.container.textContent).not.toContain(context);
});

test("keeps a pending context inaccessible until Continue and prevents duplicate requests", async () => {
  const copy = marketingPreferencesFormCopy["en-US"];
  let resolveConfirm!: (result: ActionResult) => void;
  confirmMarketingManagementAction.mockImplementationOnce(
    () =>
      new Promise<ActionResult>((resolve) => {
        resolveConfirm = resolve;
      })
  );
  const view = renderForm({
    context: "synthetic-pending-confirm-context",
    dismissalContext: "synthetic-pending-dismissal-context",
    status: "pending-link",
  });
  const continueButton = view.getByRole("button", {
    name: copy.continueAction,
  });

  fireEvent.click(continueButton);
  fireEvent.click(continueButton);

  await waitFor(() => {
    expect(confirmMarketingManagementAction).toHaveBeenCalledTimes(1);
    expect(
      view
        .getByRole("button", { name: copy.confirming })
        .getAttribute("aria-busy")
    ).toBe("true");
  });
  expect((continueButton as HTMLButtonElement).disabled).toBe(true);

  resolveConfirm({ data: { status: "confirmed" } });
  await waitFor(() => expect(view.getByText(copy.confirmed)).toBeTruthy());
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
  expect(view.queryByRole("checkbox")).toBeNull();
});

test("uses signed-in account copy and no email-management control for account source", () => {
  const copy = marketingPreferencesFormCopy["en-US"];
  const view = renderForm({
    context: "synthetic-account-context",
    source: "account",
    status: "absent",
  });

  expect(view.getByText(copy.accountContext)).toBeTruthy();
  expect(view.queryByText(copy.linkContext)).toBeNull();
  expect(view.queryByRole("button", { name: copy.clearAction })).toBeNull();
});

test("resets confirmation when the dismissal context changes", () => {
  const copy = marketingPreferencesFormCopy["en-US"];
  const context = "synthetic-save-context";
  const firstDismissalContext = "synthetic-first-dismissal-context";
  const secondDismissalContext = "synthetic-second-dismissal-context";
  const view = renderForm({
    context,
    dismissalContext: firstDismissalContext,
    source: "link",
    status: "absent",
  });

  fireEvent.click(view.getByRole("checkbox", { name: copy.grantConfirmation }));
  expect(view.getByRole("checkbox").getAttribute("aria-checked")).toBe("true");

  view.rerender(
    <MarketingPreferencesForm
      locale="en-US"
      state={{
        context,
        dismissalContext: secondDismissalContext,
        source: "link",
        status: "absent",
      }}
    />
  );

  expect(view.getByRole("checkbox").getAttribute("aria-checked")).toBe("false");
  expect(
    (view.getByRole("button", { name: copy.grantAction }) as HTMLButtonElement)
      .disabled
  ).toBe(true);
  expect(view.container.textContent).not.toContain(firstDismissalContext);
  expect(view.container.textContent).not.toContain(secondDismissalContext);
});

test("renders unavailable guidance without presenting account availability as a flag", () => {
  const copy = marketingPreferencesFormCopy["en-US"];
  const view = renderForm({ status: "unavailable" });

  expect(view.getByText(copy.unavailableNextStep)).toBeTruthy();
  expect(view.getByText(copy.unavailableSignInNextStep)).toBeTruthy();
  expect(
    view.getByRole("link", { name: copy.signInAction }).getAttribute("href")
  ).toBe("/en-US/auth/sign-in");
  expect(view.queryByRole("checkbox")).toBeNull();
  expect(view.queryByRole("button", { name: copy.grantAction })).toBeNull();
  expect(view.queryByText(copy.accountContext)).toBeNull();
});

test("hides sign-in affordances when accounts are disabled but keeps the dedicated-link path", () => {
  const copy = marketingPreferencesFormCopy["en-US"];
  const view = renderForm({ status: "unavailable" }, "en-US", undefined, false);

  expect(view.getByText(copy.unavailableNextStep)).toBeTruthy();
  expect(view.queryByText(copy.unavailableSignInNextStep)).toBeNull();
  expect(view.queryByRole("link", { name: copy.signInAction })).toBeNull();
});

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
  expect(view.queryByRole("link", { name: copy.signInAction })).toBeNull();
  expect(view.queryByRole("checkbox")).toBeNull();
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

test("announces loading, success, and server errors accessibly", async () => {
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
    status: "absent",
    source: "account",
  });
  fireEvent.click(view.getByRole("checkbox"));
  fireEvent.submit(getForm(view));
  fireEvent.submit(getForm(view));

  await waitFor(() => {
    expect(
      view.getByRole("button", { name: copy.saving }).getAttribute("aria-busy")
    ).toBe("true");
  });

  resolveSave({ data: { status: "saved" } });
  await waitFor(() => expect(view.getByText(copy.saved)).toBeTruthy());

  saveMarketingPreferencesAction.mockImplementationOnce(() =>
    Promise.resolve({ serverError: "Synthetic preference save failure" })
  );
  fireEvent.click(view.getByRole("checkbox"));
  fireEvent.click(view.getByRole("checkbox"));
  fireEvent.submit(getForm(view));
  await waitFor(() => {
    expect(view.getByRole("alert").textContent).toContain(
      "Synthetic preference save failure"
    );
  });
  expect(view.queryByText(copy.saved)).toBeNull();
  expect(routerRefresh).toHaveBeenCalledTimes(1);
});

test("wraps long localized copy without fixed-width controls", () => {
  const copy = marketingPreferencesFormCopy["cs-CZ"];
  const longCopy: MarketingPreferencesFormCopy = {
    ...copy,
    description: `${copy.description} ${"Dlouhý popis. ".repeat(12)}`,
    grantAction: `${copy.grantAction} ${"s rozšířeným vysvětlením ".repeat(5)}`,
    grantConfirmation: `${copy.grantConfirmation} ${"Další potvrzení. ".repeat(8)}`,
    title: `${copy.title} ${"a další podrobnosti".repeat(4)}`,
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
  expect(section?.querySelector("h3")?.className).toContain("break-words");
  expect(section?.querySelector("form")?.className).toContain("min-w-0");
  expect(section?.querySelector("button[type='submit']")?.className).toContain(
    "whitespace-normal"
  );
  expect(section?.querySelector("label")?.className).toContain("break-words");
});
