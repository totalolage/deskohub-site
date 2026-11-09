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
  saveMarketingPreferencesAction.mockReset();
  saveMarketingPreferencesAction.mockImplementation(
    (_input: MarketingPreferenceSaveInput): Promise<ActionResult> =>
      Promise.resolve({ data: { status: "saved" } })
  );
  confirmMarketingManagementAction.mockClear();
  clearMarketingManagementAction.mockClear();
  routerRefresh.mockClear();
});

afterAll(unregisterWorkspaceComponentTestEnv);

function renderForm(
  state: MarketingPreferencesState,
  locale: Locale = "en-US"
) {
  return render(<MarketingPreferencesForm locale={locale} state={state} />);
}

function getSwitch(
  view: ReturnType<typeof render>,
  name: string = m.marketingPreferencesFormRowTitle({}, { locale: "en-US" })
) {
  return view.getByRole("switch", { name });
}

function getArticle(view: ReturnType<typeof render>) {
  const article = view.container.querySelector("article");
  if (!article) throw new Error("Marketing preference row was not rendered");
  return article;
}

test.each([
  ["absent", true],
  ["active", false],
] as const)(
  "keeps a deferred save from the %s status single-flight and announces the pending state",
  async (status, granted) => {
    let resolveSave!: (result: ActionResult) => void;
    saveMarketingPreferencesAction.mockImplementationOnce(
      () =>
        new Promise<ActionResult>((resolve) => {
          resolveSave = resolve;
        })
    );
    const context = "synthetic-account-context";
    const view = renderForm({ context, source: "account", status });
    const marketingSwitch = getSwitch(
      view,
      m.marketingPreferencesFormRowTitle({}, { locale: "en-US" })
    );
    const target = granted ? "true" : "false";

    expect(marketingSwitch.getAttribute("aria-checked")).toBe(
      granted ? "false" : "true"
    );
    fireEvent.click(marketingSwitch);
    fireEvent.click(marketingSwitch);

    await waitFor(() => {
      expect(saveMarketingPreferencesAction).toHaveBeenCalledTimes(1);
      expect(getArticle(view).getAttribute("aria-busy")).toBe("true");
    });
    expect(saveMarketingPreferencesAction).toHaveBeenCalledWith({
      confirmed: true,
      context,
      granted,
      locale: "en-US",
      source: "account",
    });
    // While the save is pending the switch already reads the target state
    // (feedback lZJlJt7s-q7L), stays disabled, and ignores further toggles.
    expect(marketingSwitch.hasAttribute("disabled")).toBe(true);
    expect(
      getSwitch(
        view,
        m.marketingPreferencesFormRowTitle({}, { locale: "en-US" })
      ).getAttribute("aria-checked")
    ).toBe(target);
    fireEvent.click(
      getSwitch(
        view,
        m.marketingPreferencesFormRowTitle({}, { locale: "en-US" })
      )
    );
    expect(saveMarketingPreferencesAction).toHaveBeenCalledTimes(1);
    expect(view.getByRole("status").textContent).toBe(
      m.marketingPreferencesFormSavingStatus({}, { locale: "en-US" })
    );

    resolveSave({ data: { status: "saved" } });
    await waitFor(() => {
      expect(marketingSwitch.hasAttribute("disabled")).toBe(false);
      expect(
        getSwitch(
          view,
          m.marketingPreferencesFormRowTitle({}, { locale: "en-US" })
        ).getAttribute("aria-checked")
      ).toBe(target);
    });
  }
);

test("permits a second toggle after a settled save and blocks duplicates while pending", async () => {
  let resolveFirstSave!: (result: ActionResult) => void;
  saveMarketingPreferencesAction.mockImplementationOnce(
    () =>
      new Promise<ActionResult>((resolve) => {
        resolveFirstSave = resolve;
      })
  );
  const context = "synthetic-account-context";
  const view = renderForm({
    context,
    source: "account",
    status: "absent",
  });
  const marketingSwitch = getSwitch(
    view,
    m.marketingPreferencesFormRowTitle({}, { locale: "en-US" })
  );

  act(() => {
    marketingSwitch.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    marketingSwitch.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await waitFor(() => {
    expect(saveMarketingPreferencesAction).toHaveBeenCalledTimes(1);
    expect(marketingSwitch.hasAttribute("disabled")).toBe(true);
  });
  expect(marketingSwitch.getAttribute("aria-checked")).toBe("true");
  fireEvent.click(marketingSwitch);
  expect(saveMarketingPreferencesAction).toHaveBeenCalledTimes(1);

  resolveFirstSave({ data: { status: "saved" } });
  await waitFor(() =>
    expect(marketingSwitch.hasAttribute("disabled")).toBe(false)
  );
  expect(marketingSwitch.getAttribute("aria-checked")).toBe("true");

  fireEvent.click(marketingSwitch);
  await waitFor(() => {
    expect(marketingSwitch.hasAttribute("disabled")).toBe(false);
    expect(saveMarketingPreferencesAction).toHaveBeenCalledTimes(2);
    expect(saveMarketingPreferencesAction).toHaveBeenNthCalledWith(2, {
      confirmed: true,
      context,
      granted: false,
      locale: "en-US",
      source: "account",
    });
    expect(marketingSwitch.getAttribute("aria-checked")).toBe("false");
    expect(
      view.getByText(m.marketingPreferencesFormSaved({}, { locale: "en-US" }))
    ).toBeTruthy();
    expect(routerRefresh).toHaveBeenCalledTimes(2);
  });
});

test("announces a rejected save request with localized copy and allows a successful retry", async () => {
  const context = "synthetic-account-context";
  saveMarketingPreferencesAction.mockImplementationOnce(() =>
    Promise.reject(new Error("Synthetic transport failure"))
  );
  const view = renderForm({
    context,
    source: "account",
    status: "absent",
  });
  const marketingSwitch = getSwitch(
    view,
    m.marketingPreferencesFormRowTitle({}, { locale: "en-US" })
  );

  expect(marketingSwitch.getAttribute("aria-checked")).toBe("false");
  fireEvent.click(marketingSwitch);

  await waitFor(() => {
    expect(view.getByRole("alert").textContent).toBe(
      m.marketingPreferencesFormSaveError({}, { locale: "en-US" })
    );
    expect(marketingSwitch.hasAttribute("disabled")).toBe(false);
  });
  // The feedback block renders inside the managed row's support column, not
  // as a loose sibling of the row article.
  expect(getArticle(view).contains(view.getByRole("alert"))).toBe(true);
  expect(marketingSwitch.getAttribute("aria-checked")).toBe("false");
  expect(saveMarketingPreferencesAction).toHaveBeenCalledTimes(1);
  expect(routerRefresh).not.toHaveBeenCalled();

  expect(marketingSwitch.getAttribute("aria-checked")).toBe("false");
  fireEvent.click(
    getSwitch(view, m.marketingPreferencesFormRowTitle({}, { locale: "en-US" }))
  );
  expect(marketingSwitch.getAttribute("aria-checked")).toBe("true");
  await waitFor(() => {
    expect(saveMarketingPreferencesAction).toHaveBeenNthCalledWith(2, {
      confirmed: true,
      context,
      granted: true,
      locale: "en-US",
      source: "account",
    });
    expect(
      getSwitch(
        view,
        m.marketingPreferencesFormRowTitle({}, { locale: "en-US" })
      ).getAttribute("aria-checked")
    ).toBe("true");
    expect(routerRefresh).toHaveBeenCalledTimes(1);
    expect(
      view.getByText(m.marketingPreferencesFormSaved({}, { locale: "en-US" }))
    ).toBeTruthy();
  });
});

test.each([
  {
    name: "rolls back to the last confirmed grant when a later withdraw fails",
    initialStatus: "absent",
    failureServerError: true,
    expectedAfterFailure: "true",
  },
  {
    name: "rolls back to the last confirmed grant when a later withdraw transport-fails",
    initialStatus: "absent",
    failureServerError: false,
    expectedAfterFailure: "true",
  },
] as const)(
  "$name",
  async ({ initialStatus, failureServerError, expectedAfterFailure }) => {
    const context = `synthetic-stale-rollback-${initialStatus}-context`;
    const view = renderForm({
      context,
      dismissalContext: `synthetic-stale-rollback-${initialStatus}-dismissal-context`,
      source: "link",
      status: initialStatus,
    });
    const getSwitchChecked = () =>
      getSwitch(
        view,
        m.marketingPreferencesFormRowTitle({}, { locale: "en-US" })
      ).getAttribute("aria-checked");

    // First toggle succeeds and becomes the confirmed server state; refreshed
    // server props have not arrived (router.refresh is a no-op in tests).
    fireEvent.click(
      getSwitch(
        view,
        m.marketingPreferencesFormRowTitle({}, { locale: "en-US" })
      )
    );
    await waitFor(() => {
      expect(saveMarketingPreferencesAction).toHaveBeenCalledTimes(1);
      expect(routerRefresh).toHaveBeenCalledTimes(1);
    });
    expect(getSwitchChecked()).toBe(
      initialStatus === "absent" ? "true" : "false"
    );

    // Opposite toggle fails; the switch must restore the last confirmed value,
    // not the stale initial prop state.
    if (!failureServerError) {
      saveMarketingPreferencesAction.mockImplementationOnce(() =>
        Promise.reject(new Error("Synthetic transport failure"))
      );
    } else {
      saveMarketingPreferencesAction.mockImplementationOnce(() =>
        Promise.resolve({ serverError: "Synthetic preference save failure" })
      );
    }
    await waitFor(() =>
      expect(
        getSwitch(
          view,
          m.marketingPreferencesFormRowTitle({}, { locale: "en-US" })
        ).hasAttribute("disabled")
      ).toBe(false)
    );
    fireEvent.click(
      getSwitch(
        view,
        m.marketingPreferencesFormRowTitle({}, { locale: "en-US" })
      )
    );
    await waitFor(() => {
      expect(view.getByRole("alert").textContent).toBe(
        m.marketingPreferencesFormSaveError({}, { locale: "en-US" })
      );
    });
    expect(getSwitchChecked()).toBe(expectedAfterFailure);
  }
);

test("keeps a pending dedicated-link context inaccessible until Continue and prevents duplicate requests", async () => {
  const context = "synthetic-pending-confirm-context";
  const view = renderForm({
    context,
    dismissalContext: "synthetic-pending-dismissal-context",
    status: "pending-link",
  });
  const continueButton = view.getByRole("button", {
    name: m.marketingPreferencesFormContinueAction({}, { locale: "en-US" }),
  });

  expect(
    view.queryByRole("switch", {
      name: m.marketingPreferencesFormRowTitle({}, { locale: "en-US" }),
    })
  ).toBeNull();
  fireEvent.click(continueButton);

  await waitFor(() => {
    expect(confirmMarketingManagementAction).toHaveBeenCalledWith({ context });
    expect(routerRefresh).toHaveBeenCalledTimes(1);
    expect(
      view.getByText(
        m.marketingPreferencesFormConfirmed({}, { locale: "en-US" })
      )
    ).toBeTruthy();
  });
  expect(view.container.textContent).not.toContain(context);
});

test("keeps a pending context after a continuation failure and allows retry", async () => {
  confirmMarketingManagementAction.mockImplementationOnce(() =>
    Promise.resolve({ serverError: "Synthetic continuation failure" })
  );
  const view = renderForm({
    context: "synthetic-pending-confirm-context",
    dismissalContext: "synthetic-pending-dismissal-context",
    status: "pending-link",
  });

  fireEvent.click(
    view.getByRole("button", {
      name: m.marketingPreferencesFormContinueAction({}, { locale: "en-US" }),
    })
  );

  await waitFor(() => {
    expect(view.getByRole("alert").textContent).toBe(
      m.marketingPreferencesFormConfirmError({}, { locale: "en-US" })
    );
  });
  expect(routerRefresh).not.toHaveBeenCalled();
  expect(
    view.getByText(
      m.marketingPreferencesFormPendingDescription({}, { locale: "en-US" })
    )
  ).toBeTruthy();
  expect(
    view.queryByRole("switch", {
      name: m.marketingPreferencesFormRowTitle({}, { locale: "en-US" }),
    })
  ).toBeNull();

  fireEvent.click(
    view.getByRole("button", {
      name: m.marketingPreferencesFormContinueAction({}, { locale: "en-US" }),
    })
  );
  await waitFor(() => {
    expect(confirmMarketingManagementAction).toHaveBeenCalledTimes(2);
    expect(routerRefresh).toHaveBeenCalledTimes(1);
    expect(
      view.getByText(
        m.marketingPreferencesFormConfirmed({}, { locale: "en-US" })
      )
    ).toBeTruthy();
  });
});

test("resets a stale save error when the dismissal context changes", async () => {
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

  fireEvent.click(
    getSwitch(view, m.marketingPreferencesFormRowTitle({}, { locale: "en-US" }))
  );
  await waitFor(() => {
    expect(view.getByRole("alert").textContent).toBe(
      m.marketingPreferencesFormSaveError({}, { locale: "en-US" })
    );
  });
  await waitFor(() =>
    expect(
      getSwitch(
        view,
        m.marketingPreferencesFormRowTitle({}, { locale: "en-US" })
      ).hasAttribute("disabled")
    ).toBe(false)
  );

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

  expect(view.getByRole("alert").textContent).toBe("");
  expect(
    getSwitch(
      view,
      m.marketingPreferencesFormRowTitle({}, { locale: "en-US" })
    ).getAttribute("aria-checked")
  ).toBe("false");
  expect(view.container.textContent).not.toContain(
    "synthetic-first-dismissal-context"
  );
  expect(view.container.textContent).not.toContain(
    "synthetic-second-dismissal-context"
  );
});

test("renders unavailable guidance without presenting account availability as a flag", () => {
  const view = renderForm({ status: "unavailable" });

  expect(
    view.getByText(
      m.marketingPreferencesFormUnavailableNextStep({}, { locale: "en-US" })
    )
  ).toBeTruthy();
  expect(
    view.getByText(
      m.marketingPreferencesFormUnavailableSignInNextStep(
        {},
        { locale: "en-US" }
      )
    )
  ).toBeTruthy();
  expect(
    view
      .getByRole("link", {
        name: m.marketingPreferencesFormSignInAction({}, { locale: "en-US" }),
      })
      .getAttribute("href")
  ).toBe("/en-US/auth/sign-in");
  expect(
    view.queryByRole("switch", {
      name: m.marketingPreferencesFormRowTitle({}, { locale: "en-US" }),
    })
  ).toBeNull();
  expect(
    view.queryByText(
      m.marketingPreferencesFormAccountContext({}, { locale: "en-US" })
    )
  ).toBeNull();
});

test.each(["en-US"] as const)(
  "keeps a link-authorized preference actionable in %s",
  async (locale) => {
    const context = `synthetic-${locale}-link-save-context`;
    const view = renderForm(
      {
        context,
        dismissalContext: `synthetic-${locale}-link-dismissal-context`,
        source: "link",
        status: "absent",
      },
      locale
    );

    expect(
      view.container.querySelector('[data-marketing-preferences-source="link"]')
    ).toBeTruthy();
    expect(
      getSwitch(
        view,
        m.marketingPreferencesFormRowTitle({}, { locale })
      ).hasAttribute("disabled")
    ).toBe(false);

    fireEvent.click(
      getSwitch(view, m.marketingPreferencesFormRowTitle({}, { locale }))
    );

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
    await waitFor(() => {
      expect(
        getSwitch(
          view,
          m.marketingPreferencesFormRowTitle({}, { locale })
        ).hasAttribute("disabled")
      ).toBe(false);
      expect(
        view.getByText(m.marketingPreferencesFormSaved({}, { locale }))
      ).toBeTruthy();
    });
  }
);

test("keeps an invalid dedicated link out of the account flow without a fallback", () => {
  const view = renderForm({
    dismissalContext: "synthetic-invalid-dismissal-context",
    status: "invalid-link",
  });

  expect(
    view.getByText(
      m.marketingPreferencesFormInvalidLinkDescription({}, { locale: "en-US" })
    )
  ).toBeTruthy();
  expect(
    view.getByText(
      m.marketingPreferencesFormInvalidLinkNextStep({}, { locale: "en-US" })
    )
  ).toBeTruthy();
  expect(
    view.queryByRole("link", {
      name: m.marketingPreferencesFormSignInAction({}, { locale: "en-US" }),
    })
  ).toBeNull();
  expect(
    view.queryByRole("switch", {
      name: m.marketingPreferencesFormRowTitle({}, { locale: "en-US" }),
    })
  ).toBeNull();
  expect(
    view.queryByRole("button", {
      name: m.marketingPreferencesFormContinueAction({}, { locale: "en-US" }),
    })
  ).toBeNull();
  expect(
    view.getByRole("button", {
      name: m.marketingPreferencesFormClearAction({}, { locale: "en-US" }),
    })
  ).toBeTruthy();
});

test("keeps a pending dedicated link after clear failure and allows retry", async () => {
  const dismissalContext = "synthetic-pending-dismissal-context";
  clearMarketingManagementAction.mockImplementationOnce(() =>
    Promise.resolve({ serverError: "Synthetic pending clear failure" })
  );
  const view = renderForm({
    context: "synthetic-pending-confirm-context",
    dismissalContext,
    status: "pending-link",
  });

  fireEvent.click(
    view.getByRole("button", {
      name: m.marketingPreferencesFormClearAction({}, { locale: "en-US" }),
    })
  );
  await waitFor(() => {
    expect(view.getByRole("alert").textContent).toBe(
      m.marketingPreferencesFormClearError({}, { locale: "en-US" })
    );
  });
  expect(
    view.getByText(
      m.marketingPreferencesFormPendingDescription({}, { locale: "en-US" })
    )
  ).toBeTruthy();
  expect(
    view.getByRole("button", {
      name: m.marketingPreferencesFormContinueAction({}, { locale: "en-US" }),
    })
  ).toBeTruthy();

  fireEvent.click(
    view.getByRole("button", {
      name: m.marketingPreferencesFormClearAction({}, { locale: "en-US" }),
    })
  );
  await waitFor(() => {
    expect(clearMarketingManagementAction).toHaveBeenCalledTimes(2);
    expect(
      view.getByText(m.marketingPreferencesFormCleared({}, { locale: "en-US" }))
    ).toBeTruthy();
  });
  expect(clearMarketingManagementAction).toHaveBeenNthCalledWith(1, {
    context: dismissalContext,
  });
  expect(clearMarketingManagementAction).toHaveBeenNthCalledWith(2, {
    context: dismissalContext,
  });
});

test("disables the explicit invalid-link clear action while it is busy", async () => {
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

  fireEvent.click(
    view.getByRole("button", {
      name: m.marketingPreferencesFormClearAction({}, { locale: "en-US" }),
    })
  );
  await waitFor(() => {
    expect(
      view
        .getByRole("button", {
          name: m.marketingPreferencesFormClearing({}, { locale: "en-US" }),
        })
        .getAttribute("aria-busy")
    ).toBe("true");
  });
  expect(
    (
      view.getByRole("button", {
        name: m.marketingPreferencesFormClearing({}, { locale: "en-US" }),
      }) as HTMLButtonElement
    ).disabled
  ).toBe(true);

  resolveClear({ data: { status: "cleared" } });
  await waitFor(() =>
    expect(
      view.getByText(m.marketingPreferencesFormCleared({}, { locale: "en-US" }))
    ).toBeTruthy()
  );
});

test("announces clear loading, allows retry after an error, and keeps the dismissal payload", async () => {
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
  const clearButton = view.getByRole("button", {
    name: m.marketingPreferencesFormClearAction({}, { locale: "en-US" }),
  });

  fireEvent.click(clearButton);
  fireEvent.click(clearButton);

  await waitFor(() => {
    expect(clearMarketingManagementAction).toHaveBeenCalledTimes(1);
    expect(
      view
        .getByRole("button", {
          name: m.marketingPreferencesFormClearing({}, { locale: "en-US" }),
        })
        .getAttribute("aria-busy")
    ).toBe("true");
  });
  expect((clearButton as HTMLButtonElement).disabled).toBe(true);

  resolveClear({ serverError: "Synthetic clear failure" });
  await waitFor(() => {
    expect(view.getByRole("alert").textContent).toBe(
      m.marketingPreferencesFormClearError({}, { locale: "en-US" })
    );
  });

  fireEvent.click(
    view.getByRole("button", {
      name: m.marketingPreferencesFormClearAction({}, { locale: "en-US" }),
    })
  );
  await waitFor(() => {
    expect(clearMarketingManagementAction).toHaveBeenCalledTimes(2);
    expect(
      view.getByText(m.marketingPreferencesFormCleared({}, { locale: "en-US" }))
    ).toBeTruthy();
  });
  expect(clearMarketingManagementAction).toHaveBeenNthCalledWith(1, {
    context: dismissalContext,
  });
  expect(clearMarketingManagementAction).toHaveBeenNthCalledWith(2, {
    context: dismissalContext,
  });
});

test("keeps save feedback and the focused switch when refreshed props report the saved status", async () => {
  const context = "synthetic-refresh-context";
  const view = renderForm({ context, source: "account", status: "absent" });
  const marketingSwitch = getSwitch(view);

  fireEvent.click(marketingSwitch);
  await waitFor(() => {
    expect(routerRefresh).toHaveBeenCalledTimes(1);
    expect(marketingSwitch.hasAttribute("disabled")).toBe(false);
  });
  act(() => marketingSwitch.focus());

  // router.refresh() delivers the server-confirmed status as new props.
  view.rerender(
    <MarketingPreferencesForm
      locale="en-US"
      state={{ context, source: "account", status: "active" }}
    />
  );

  expect(getSwitch(view)).toBe(marketingSwitch);
  expect(marketingSwitch.isConnected).toBe(true);
  expect(document.activeElement).toBe(marketingSwitch);
  expect(marketingSwitch.getAttribute("aria-checked")).toBe("true");
  expect(
    view.getByText(m.marketingPreferencesFormSaved({}, { locale: "en-US" }))
  ).toBeTruthy();

  // A later server-side change still drives the switch without a remount.
  view.rerender(
    <MarketingPreferencesForm
      locale="en-US"
      state={{ context, source: "account", status: "withdrawn" }}
    />
  );
  expect(getSwitch(view)).toBe(marketingSwitch);
  expect(marketingSwitch.getAttribute("aria-checked")).toBe("false");

  // The refreshed status is now the confirmed rollback target.
  saveMarketingPreferencesAction.mockImplementationOnce(() =>
    Promise.resolve({ serverError: "Synthetic refreshed save failure" })
  );
  fireEvent.click(marketingSwitch);
  await waitFor(() => {
    expect(view.getByRole("alert").textContent).toBe(
      m.marketingPreferencesFormSaveError({}, { locale: "en-US" })
    );
  });
  expect(marketingSwitch.getAttribute("aria-checked")).toBe("false");
});

test("announces the invalid-link rejection reason when continuing a replayed link", async () => {
  confirmMarketingManagementAction.mockImplementationOnce(() =>
    Promise.resolve({ data: { status: "rejected", reason: "invalid-link" } })
  );
  const view = renderForm({
    context: "synthetic-replayed-confirm-context",
    dismissalContext: "synthetic-replayed-dismissal-context",
    status: "pending-link",
  });

  fireEvent.click(
    view.getByRole("button", {
      name: m.marketingPreferencesFormContinueAction({}, { locale: "en-US" }),
    })
  );

  await waitFor(() => {
    expect(view.getByRole("alert").textContent).toBe(
      "This marketing management link is invalid or has expired."
    );
  });
});

test("announces a stale-context save rejection in the visitor's locale", async () => {
  const locale = "cs-CZ" as const;
  saveMarketingPreferencesAction.mockImplementationOnce(() =>
    Promise.resolve({ data: { status: "rejected", reason: "stale-context" } })
  );
  const view = renderForm(
    {
      context: "synthetic-account-context",
      source: "account",
      status: "absent",
    },
    locale
  );

  fireEvent.click(
    getSwitch(view, m.marketingPreferencesFormRowTitle({}, { locale }))
  );

  await waitFor(() => {
    expect(view.getByRole("alert").textContent).toBe(
      m.marketingPreferencesFormStaleContextError({}, { locale })
    );
  });
  expect(view.getByRole("alert").textContent).not.toBe(
    m.marketingPreferencesFormSaveError({}, { locale })
  );
});

test("keeps the feedback live regions mounted before any feedback appears", async () => {
  saveMarketingPreferencesAction.mockImplementationOnce(() =>
    Promise.resolve({ serverError: "Synthetic live region failure" })
  );
  const view = renderForm({
    context: "synthetic-account-context",
    source: "account",
    status: "absent",
  });
  const statusRegion = view.getByRole("status");
  const alertRegion = view.getByRole("alert");

  expect(statusRegion.getAttribute("aria-live")).toBe("polite");
  expect(statusRegion.textContent).toBe("");
  expect(alertRegion.textContent).toBe("");

  fireEvent.click(getSwitch(view));
  await waitFor(() => {
    expect(alertRegion.textContent).toBe(
      m.marketingPreferencesFormSaveError({}, { locale: "en-US" })
    );
  });
  expect(view.getByRole("alert")).toBe(alertRegion);

  fireEvent.click(getSwitch(view));
  await waitFor(() => {
    expect(statusRegion.textContent).toBe(
      m.marketingPreferencesFormSaved({}, { locale: "en-US" })
    );
  });
  expect(view.getByRole("status")).toBe(statusRegion);
  expect(alertRegion.textContent).toBe("");
});
