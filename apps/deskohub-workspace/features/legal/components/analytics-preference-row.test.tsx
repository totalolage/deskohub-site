import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  expect,
  mock,
  spyOn,
  test,
} from "bun:test";
import {
  act,
  cleanup,
  fireEvent,
  render,
  waitFor,
} from "@testing-library/react";
import { customerAccountIdSchema } from "@/features/account/customer-account";
import { m } from "@/features/i18n";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";

type ActionResult = {
  readonly data?: {
    readonly accountId: string;
    readonly decidedAt: string;
  } | null;
  readonly serverError?: string;
};

// The save's answer: the account it was recorded for and its instant.
const savedFor = (decidedAt: string, accountId = "account-a") => ({
  accountId,
  decidedAt,
});

const savePreference = (): Promise<ActionResult> =>
  Promise.resolve({ data: savedFor("2026-11-08T10:15:30.123Z") });
const saveAccountAnalyticsPreference = mock(
  (_input: { readonly granted: boolean }) => savePreference()
);

mock.module("@/features/legal/actions", () => ({
  saveAccountAnalyticsPreference,
}));

type Identity =
  | { readonly status: "pending" | "anonymous" }
  | {
      readonly status: "authenticated";
      readonly accountId: ReturnType<typeof customerAccountIdSchema.make>;
      readonly testAccount: boolean;
    };

const signedIn = (id: string): Identity => ({
  status: "authenticated",
  accountId: customerAccountIdSchema.make(id),
  testAccount: true,
});

let identity: Identity = signedIn("account-a");

mock.module("@/features/account/analytics-identity", () => ({
  getAnalyticsAccountIdentity: () => identity,
  subscribeAnalyticsAccountIdentity: () => () => undefined,
}));

const writeConsentCookie = (savedAt: string) => {
  // biome-ignore lint/suspicious/noDocumentCookie: The test saves the consent cookie the device's own switch would.
  document.cookie = `cc_cookie=${encodeURIComponent(
    JSON.stringify({
      categories: ["necessary"],
      revision: 1,
      lastConsentTimestamp: savedAt,
    })
  )}; path=/`;
};

const { visitorConsent } = await import(
  "@/features/cookie-consent/visitor-consent"
);
const { AnalyticsPreferenceRow } = await import("./analytics-preference-row");

type RowState =
  | { readonly status: "unavailable" }
  | { readonly status: "available"; readonly granted: boolean };

// The device writer is covered by visitor-consent's own suite; here only its
// call is observed.
const applyAccountDecision = spyOn(visitorConsent, "applyAccountDecision");

beforeAll(registerWorkspaceComponentTestEnv);
beforeEach(() => {
  window.happyDOM.setURL("https://deskohub.test/en-US/account/legal");
  identity = signedIn("account-a");
  writeConsentCookie("2026-11-02T09:30:00.000Z");
  expect(visitorConsent.saveMark()).not.toBe("");
  applyAccountDecision.mockImplementation(() => undefined);
});
afterEach(() => {
  cleanup();
  // biome-ignore lint/suspicious/noDocumentCookie: The test clears consent between cases.
  document.cookie = "cc_cookie=; Path=/; Max-Age=0";
  saveAccountAnalyticsPreference.mockReset();
  saveAccountAnalyticsPreference.mockImplementation(savePreference);
  applyAccountDecision.mockReset();
});
afterAll(async () => {
  applyAccountDecision.mockRestore();
  await unregisterWorkspaceComponentTestEnv();
});

const renderRow = (state: RowState) =>
  render(<AnalyticsPreferenceRow locale="en-US" state={state} />);

const getSwitch = (view: ReturnType<typeof render>) =>
  view.getByRole("switch", {
    name: m.analyticsPreferenceTitle({}, { locale: "en-US" }),
  });

const getArticle = (view: ReturnType<typeof render>) => {
  const article = view.container.querySelector("article");
  if (!article) throw new Error("Analytics preference row was not rendered");
  return article;
};

/**
 * Waits until the save settled and its success feedback shows: the switch is
 * enabled again and the status region still holds a message.
 */
const waitForSavedFeedback = (view: ReturnType<typeof render>) =>
  waitFor(() => {
    expect(getSwitch(view).hasAttribute("disabled")).toBe(false);
    expect(view.getByRole("status").textContent).not.toBe("");
  });

const deferSave = () => {
  let settle!: (result: ActionResult) => void;
  saveAccountAnalyticsPreference.mockImplementationOnce(
    () =>
      new Promise<ActionResult>((resolve) => {
        settle = resolve;
      })
  );
  return (result: ActionResult) => settle(result);
};

test.each([
  { granted: false, decidedAt: "2026-11-08T10:15:30.123Z" },
  { granted: true, decidedAt: "2026-11-08T11:45:00.000Z" },
])(
  "moves the switch at once and applies the saved decision (from granted $granted) to this device",
  async ({ granted, decidedAt }) => {
    const settle = deferSave();
    const view = renderRow({ status: "available", granted });
    const preferenceSwitch = getSwitch(view);
    expect(preferenceSwitch.getAttribute("aria-checked")).toBe(`${granted}`);

    fireEvent.click(preferenceSwitch);

    // Optimistic: the switch reads the target before the save settles.
    await waitFor(() => {
      expect(saveAccountAnalyticsPreference).toHaveBeenCalledTimes(1);
      expect(getArticle(view).getAttribute("aria-busy")).toBe("true");
    });
    expect(saveAccountAnalyticsPreference).toHaveBeenCalledWith({
      granted: !granted,
    });
    expect(preferenceSwitch.getAttribute("aria-checked")).toBe(`${!granted}`);
    expect(applyAccountDecision).not.toHaveBeenCalled();

    settle({ data: savedFor(decidedAt) });

    await waitForSavedFeedback(view);
    expect(preferenceSwitch.getAttribute("aria-checked")).toBe(`${!granted}`);
    expect(applyAccountDecision).toHaveBeenCalledTimes(1);
    expect(applyAccountDecision).toHaveBeenCalledWith({
      analytics: !granted,
      decidedAt,
      change: "preference",
    });
    expect(view.getByRole("status").textContent).not.toBe("");
    expect(view.getByRole("alert").textContent).toBe("");
  }
);

test.each([
  {
    failure: "a server error",
    respond: () =>
      Promise.resolve<ActionResult>({ serverError: "Synthetic save failure" }),
  },
  {
    failure: "a transport error",
    respond: () =>
      Promise.reject<ActionResult>(new Error("Synthetic transport failure")),
  },
  {
    // The session ended meanwhile, so nothing was recorded.
    failure: "no recorded decision",
    respond: () => Promise.resolve<ActionResult>({ data: null }),
  },
])(
  "reverts the switch and leaves the device alone after $failure",
  async ({ respond }) => {
    saveAccountAnalyticsPreference.mockImplementationOnce(respond);
    const view = renderRow({ status: "available", granted: false });
    const preferenceSwitch = getSwitch(view);

    fireEvent.click(preferenceSwitch);
    expect(preferenceSwitch.getAttribute("aria-checked")).toBe("true");

    await waitFor(() => {
      expect(view.getByRole("alert").textContent).not.toBe("");
      expect(preferenceSwitch.hasAttribute("disabled")).toBe(false);
    });
    expect(preferenceSwitch.getAttribute("aria-checked")).toBe("false");
    expect(saveAccountAnalyticsPreference).toHaveBeenCalledTimes(1);
    expect(applyAccountDecision).not.toHaveBeenCalled();
  }
);

test.each([
  {
    change: "the device saves its own choice",
    apply: () => writeConsentCookie("2026-11-08T10:20:00.000Z"),
  },
  {
    change: "the session switches to another account",
    apply: () => {
      identity = signedIn("account-b");
    },
  },
  {
    change: "the session signs out",
    apply: () => {
      identity = { status: "anonymous" };
    },
  },
])(
  "keeps the saved switch but leaves the device alone when $change during the save",
  async ({ apply }) => {
    const settle = deferSave();
    const view = renderRow({ status: "available", granted: false });
    const preferenceSwitch = getSwitch(view);

    fireEvent.click(preferenceSwitch);
    await waitFor(() =>
      expect(saveAccountAnalyticsPreference).toHaveBeenCalledTimes(1)
    );
    apply();
    settle({ data: savedFor("2026-11-08T10:15:30.123Z") });

    await waitForSavedFeedback(view);
    expect(preferenceSwitch.getAttribute("aria-checked")).toBe("true");
    expect(view.getByRole("status").textContent).not.toBe("");
    expect(view.getByRole("alert").textContent).toBe("");
    expect(applyAccountDecision).not.toHaveBeenCalled();
  }
);

test("applies the saved decision to the device when the account was verified during the save", async () => {
  identity = { status: "pending" };
  const settle = deferSave();
  const view = renderRow({ status: "available", granted: true });
  const preferenceSwitch = getSwitch(view);

  fireEvent.click(preferenceSwitch);
  await waitFor(() =>
    expect(saveAccountAnalyticsPreference).toHaveBeenCalledTimes(1)
  );
  identity = signedIn("account-a");
  settle({ data: savedFor("2026-11-08T10:15:30.123Z") });

  await waitForSavedFeedback(view);
  expect(applyAccountDecision).toHaveBeenCalledTimes(1);
  expect(applyAccountDecision).toHaveBeenCalledWith({
    analytics: false,
    decidedAt: "2026-11-08T10:15:30.123Z",
    change: "preference",
  });
});

test("leaves the device alone when the save was recorded for an account other than the one verified during it", async () => {
  identity = { status: "pending" };
  const settle = deferSave();
  const view = renderRow({ status: "available", granted: false });
  const preferenceSwitch = getSwitch(view);

  fireEvent.click(preferenceSwitch);
  await waitFor(() =>
    expect(saveAccountAnalyticsPreference).toHaveBeenCalledTimes(1)
  );
  identity = signedIn("account-b");
  settle({ data: savedFor("2026-11-08T10:15:30.123Z", "account-a") });

  await waitForSavedFeedback(view);
  expect(preferenceSwitch.getAttribute("aria-checked")).toBe("true");
  expect(applyAccountDecision).not.toHaveBeenCalled();
});

test("reverts to the last saved decision, not the initial one", async () => {
  const view = renderRow({ status: "available", granted: false });
  const preferenceSwitch = getSwitch(view);

  fireEvent.click(preferenceSwitch);
  await waitForSavedFeedback(view);
  expect(applyAccountDecision).toHaveBeenCalledTimes(1);
  expect(preferenceSwitch.getAttribute("aria-checked")).toBe("true");

  saveAccountAnalyticsPreference.mockImplementationOnce(() =>
    Promise.resolve({ serverError: "Synthetic save failure" })
  );
  fireEvent.click(preferenceSwitch);
  expect(preferenceSwitch.getAttribute("aria-checked")).toBe("false");

  await waitFor(() => expect(view.getByRole("alert").textContent).not.toBe(""));
  expect(preferenceSwitch.getAttribute("aria-checked")).toBe("true");
  expect(saveAccountAnalyticsPreference).toHaveBeenCalledTimes(2);
  expect(applyAccountDecision).toHaveBeenCalledTimes(1);
});

test("sends one save at a time and accepts the next toggle once it settles", async () => {
  const settle = deferSave();
  const view = renderRow({ status: "available", granted: false });
  const preferenceSwitch = getSwitch(view);

  // Two clicks before React re-renders the busy state.
  act(() => {
    preferenceSwitch.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    preferenceSwitch.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await waitFor(() =>
    expect(preferenceSwitch.hasAttribute("disabled")).toBe(true)
  );
  fireEvent.click(preferenceSwitch);
  expect(saveAccountAnalyticsPreference).toHaveBeenCalledTimes(1);
  expect(preferenceSwitch.getAttribute("aria-checked")).toBe("true");

  settle({ data: savedFor("2026-11-08T10:15:30.123Z") });
  await waitForSavedFeedback(view);

  fireEvent.click(preferenceSwitch);
  await waitFor(() => {
    expect(saveAccountAnalyticsPreference).toHaveBeenCalledTimes(2);
    expect(applyAccountDecision).toHaveBeenCalledTimes(2);
  });
  expect(saveAccountAnalyticsPreference).toHaveBeenNthCalledWith(2, {
    granted: false,
  });
  expect(preferenceSwitch.getAttribute("aria-checked")).toBe("false");
});

test("follows a refreshed saved preference", () => {
  const view = renderRow({ status: "available", granted: false });
  expect(getSwitch(view).getAttribute("aria-checked")).toBe("false");

  view.rerender(
    <AnalyticsPreferenceRow
      locale="en-US"
      state={{ status: "available", granted: true }}
    />
  );

  expect(getSwitch(view).getAttribute("aria-checked")).toBe("true");
});

test("renders no switch while the preference can't be read", () => {
  const view = renderRow({ status: "unavailable" });

  expect(view.queryByRole("switch")).toBeNull();
  const article = getArticle(view);
  expect(article.getAttribute("data-analytics-preference")).toBe("unavailable");
  expect(article.querySelector("h3")?.id).toBe(
    "account-analytics-preference-title"
  );
  expect(view.getByRole("status").textContent).not.toBe("");
  expect(saveAccountAnalyticsPreference).not.toHaveBeenCalled();
});
