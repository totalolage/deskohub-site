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
import { m } from "@/features/i18n";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";

type ActionResult = {
  readonly data?: string | null;
  readonly serverError?: string;
};

const savePreference = (): Promise<ActionResult> =>
  Promise.resolve({ data: "2026-11-08T10:15:30.123Z" });
const saveAccountAnalyticsPreference = mock(
  (_input: { readonly granted: boolean }) => savePreference()
);

mock.module("@/features/legal/actions", () => ({
  saveAccountAnalyticsPreference,
}));

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
  applyAccountDecision.mockImplementation(() => undefined);
});
afterEach(() => {
  cleanup();
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

    settle({ data: decidedAt });

    await waitFor(() =>
      expect(preferenceSwitch.hasAttribute("disabled")).toBe(false)
    );
    expect(preferenceSwitch.getAttribute("aria-checked")).toBe(`${!granted}`);
    expect(applyAccountDecision).toHaveBeenCalledTimes(1);
    expect(applyAccountDecision).toHaveBeenCalledWith({
      analytics: !granted,
      decidedAt,
      change: "preference",
    });
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

test("reverts to the last saved decision, not the initial one", async () => {
  const view = renderRow({ status: "available", granted: false });
  const preferenceSwitch = getSwitch(view);

  fireEvent.click(preferenceSwitch);
  await waitFor(() => expect(applyAccountDecision).toHaveBeenCalledTimes(1));
  await waitFor(() =>
    expect(preferenceSwitch.hasAttribute("disabled")).toBe(false)
  );
  expect(preferenceSwitch.getAttribute("aria-checked")).toBe("true");

  saveAccountAnalyticsPreference.mockImplementationOnce(() =>
    Promise.resolve({ serverError: "Synthetic save failure" })
  );
  fireEvent.click(preferenceSwitch);
  expect(preferenceSwitch.getAttribute("aria-checked")).toBe("false");

  await waitFor(() =>
    expect(view.getByRole("alert").textContent).not.toBe("")
  );
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

  settle({ data: "2026-11-08T10:15:30.123Z" });
  await waitFor(() =>
    expect(preferenceSwitch.hasAttribute("disabled")).toBe(false)
  );

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
  expect(article.getAttribute("data-analytics-preference")).toBe(
    "unavailable"
  );
  expect(article.querySelector("h3")?.id).toBe(
    "account-analytics-preference-title"
  );
  expect(view.getByRole("status").textContent).not.toBe("");
  expect(saveAccountAnalyticsPreference).not.toHaveBeenCalled();
});
