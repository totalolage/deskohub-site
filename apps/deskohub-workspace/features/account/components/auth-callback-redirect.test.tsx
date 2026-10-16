import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  mock,
  test,
} from "bun:test";
import { act, cleanup, render } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { unsafeReturnTargets } from "@/shared/testing/unsafe-return-targets.test-utils";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";

const VALID_ATTEMPT_ID = "550e8400-e29b-41d4-a716-446655440000";
const handOffReturn = mock((_options: { readonly attemptId: string }) =>
  Promise.resolve(false)
);
const recordSignInCompletion = mock(
  (_method: "link" | "code", _options?: { readonly keepRecorded?: boolean }) =>
    undefined
);

mock.module("@/shared/browser/return-window", () => ({ handOffReturn }));
mock.module("@/features/account/sign-in-analytics", () => ({
  recordSignInCompletion,
}));

const { AuthCallbackRedirect } = await import("./auth-callback-redirect");

let originalReplace: typeof window.location.replace;
let originalClose: typeof window.close;
let originalClosed: PropertyDescriptor | undefined;
let originalSearch: PropertyDescriptor | undefined;

const setAttempt = (attemptId?: string, error?: string, returnTo?: string) => {
  const search = new URLSearchParams();
  if (attemptId !== undefined) search.set("attempt", attemptId);
  if (returnTo !== undefined) search.set("returnTo", returnTo);
  if (error !== undefined) search.set("error", error);
  const query = search.toString();
  Object.defineProperty(window.location, "search", {
    configurable: true,
    value: query ? `?${query}` : "",
  });
};

const setClosed = (closed: boolean) => {
  Object.defineProperty(window, "closed", {
    configurable: true,
    value: closed,
    writable: true,
  });
};

const codeRequestStorageKey = "deskohub:account-sign-in-code";

const renderAndFlush = async (locale: "en-US" | "cs-CZ") => {
  let view: ReturnType<typeof render> | undefined;
  await act(async () => {
    view = render(<AuthCallbackRedirect locale={locale} />);
    await Promise.resolve();
  });
  return view!;
};

describe("AuthCallbackRedirect", () => {
  beforeAll(() => {
    registerWorkspaceComponentTestEnv();
    originalReplace = window.location.replace;
    originalClose = window.close;
    originalClosed = Object.getOwnPropertyDescriptor(window, "closed");
    originalSearch = Object.getOwnPropertyDescriptor(window.location, "search");
  });

  afterEach(() => {
    cleanup();
    sessionStorage.clear();
    handOffReturn.mockReset();
    handOffReturn.mockImplementation(() => Promise.resolve(false));
    recordSignInCompletion.mockReset();
    recordSignInCompletion.mockImplementation(() => undefined);
    window.location.replace = originalReplace;
    window.close = originalClose;
    if (originalClosed) Object.defineProperty(window, "closed", originalClosed);
    else Reflect.deleteProperty(window, "closed");
    if (originalSearch)
      Object.defineProperty(window.location, "search", originalSearch);
    else Reflect.deleteProperty(window.location, "search");
  });

  afterAll(unregisterWorkspaceComponentTestEnv);

  test.each([
    ["en-US", "/en-US/account", "Loading sign-in…", "My Workspace"],
    ["cs-CZ", "/cs-CZ/account", "Načítání přihlášení…", "Můj Workspace"],
  ] as const)(
    "keeps the accessible loading fallback after replacing %s with the account page",
    async (locale, target, label, accountLabel) => {
      const replace = mock((_href: string) => undefined);
      window.location.replace = replace as typeof window.location.replace;

      const view = await renderAndFlush(locale);
      const status = view.getByRole("status", { name: label });
      const staticMarkup = renderToStaticMarkup(
        <AuthCallbackRedirect locale={locale} />
      );

      expect(handOffReturn).toHaveBeenCalledWith({ attemptId: "" });
      expect(replace).toHaveBeenCalledWith(target);
      expect(status).toBeTruthy();
      expect(status.getAttribute("aria-busy")).toBe("true");
      expect(status.getAttribute("hidden")).toBeNull();
      expect(status.querySelector("p")).toBeNull();
      expect(status.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(7);
      expect(staticMarkup).toContain('role="status"');
      expect(staticMarkup).toContain(label);
      expect(staticMarkup).toContain(
        `<noscript><a href="${target}">${accountLabel}</a></noscript>`
      );
      expect(
        staticMarkup.match(new RegExp(`<a href="${target}"`, "g"))
      ).toHaveLength(1);
      expect(view.container.querySelector("form")).toBeNull();
      expect(view.queryByRole("textbox")).toBeNull();
    }
  );

  test("passes the current attempt and closes only after an acknowledged return", async () => {
    setAttempt(VALID_ATTEMPT_ID);
    handOffReturn.mockResolvedValue(true);
    setClosed(false);
    const close = mock(() => setClosed(true));
    window.close = close as typeof window.close;
    const replace = mock((_href: string) => undefined);
    window.location.replace = replace as typeof window.location.replace;

    await renderAndFlush("en-US");

    expect(handOffReturn).toHaveBeenCalledWith({
      attemptId: VALID_ATTEMPT_ID,
    });
    expect(recordSignInCompletion).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledTimes(1);
    expect(replace).not.toHaveBeenCalled();
  });

  test("falls back to hard navigation when the acknowledged tab cannot close", async () => {
    setAttempt(VALID_ATTEMPT_ID);
    handOffReturn.mockResolvedValue(true);
    setClosed(false);
    const close = mock(() => undefined);
    window.close = close as typeof window.close;
    const replace = mock((_href: string) => undefined);
    window.location.replace = replace as typeof window.location.replace;

    await renderAndFlush("en-US");

    expect(recordSignInCompletion).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledTimes(1);
    expect(replace).toHaveBeenCalledWith("/en-US/account");
  });

  test("does not close and navigates when the return is not acknowledged", async () => {
    setAttempt(VALID_ATTEMPT_ID);
    handOffReturn.mockResolvedValue(false);
    sessionStorage.setItem(
      codeRequestStorageKey,
      JSON.stringify({ email: "synthetic", requestedAt: Date.now() })
    );
    const close = mock(() => undefined);
    window.close = close as typeof window.close;
    const effects: string[] = [];
    recordSignInCompletion.mockImplementation(() => {
      effects.push("record");
    });
    const replace = mock((_href: string) => {
      effects.push("navigate");
    });
    window.location.replace = replace as typeof window.location.replace;

    await renderAndFlush("en-US");

    expect(close).not.toHaveBeenCalled();
    expect(recordSignInCompletion).toHaveBeenCalledWith("link", {
      keepRecorded: true,
    });
    expect(replace).toHaveBeenCalledWith("/en-US/account");
    expect(effects).toEqual(["record", "navigate"]);
    // This tab is signed in: a pending code step must not come back.
    expect(sessionStorage.getItem(codeRequestStorageKey)).toBeNull();
  });

  test("suppresses handoff and close when the callback reports an error", async () => {
    setAttempt(VALID_ATTEMPT_ID, "INVALID_TOKEN");
    sessionStorage.setItem(codeRequestStorageKey, "pending");
    const close = mock(() => undefined);
    window.close = close as typeof window.close;
    const replace = mock((_href: string) => undefined);
    window.location.replace = replace as typeof window.location.replace;

    await renderAndFlush("en-US");

    expect(handOffReturn).not.toHaveBeenCalled();
    expect(recordSignInCompletion).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(codeRequestStorageKey)).toBe("pending");
    expect(close).not.toHaveBeenCalled();
    expect(replace).toHaveBeenCalledWith("/en-US/account");
  });

  test("does not navigate after an unmounted handoff resolves", async () => {
    let resolveHandoff!: (handled: boolean) => void;
    handOffReturn.mockImplementationOnce(
      () => new Promise<boolean>((resolve) => (resolveHandoff = resolve))
    );
    const replace = mock((_href: string) => undefined);
    window.location.replace = replace as typeof window.location.replace;

    const view = await renderAndFlush("en-US");
    view.unmount();
    await act(async () => {
      resolveHandoff(false);
      await Promise.resolve();
    });

    expect(replace).not.toHaveBeenCalled();
  });

  test("records a sign-in before navigating when the handoff throws", async () => {
    handOffReturn.mockImplementationOnce(() => {
      throw new Error("handoff unavailable");
    });
    const effects: string[] = [];
    recordSignInCompletion.mockImplementation(() => {
      effects.push("record");
    });
    const replace = mock((_href: string) => {
      effects.push("navigate");
    });
    window.location.replace = replace as typeof window.location.replace;

    await renderAndFlush("en-US");

    expect(recordSignInCompletion).toHaveBeenCalledWith("link", {
      keepRecorded: true,
    });
    expect(replace).toHaveBeenCalledWith("/en-US/account");
    expect(effects).toEqual(["record", "navigate"]);
  });

  describe("with a return target", () => {
    const returnTo = "/cs-CZ/admin/invoices?page=2";

    test("continues to it when no other tab takes the hand-off", async () => {
      setAttempt(VALID_ATTEMPT_ID, undefined, returnTo);
      const replace = mock((_href: string) => undefined);
      window.location.replace = replace as typeof window.location.replace;

      await renderAndFlush("en-US");

      expect(handOffReturn).toHaveBeenCalledWith({
        attemptId: VALID_ATTEMPT_ID,
      });
      expect(replace).toHaveBeenCalledWith(returnTo);
    });

    test("continues to it when the acknowledged tab cannot close", async () => {
      setAttempt(VALID_ATTEMPT_ID, undefined, returnTo);
      handOffReturn.mockResolvedValue(true);
      setClosed(false);
      window.close = mock(() => undefined) as typeof window.close;
      const replace = mock((_href: string) => undefined);
      window.location.replace = replace as typeof window.location.replace;

      await renderAndFlush("en-US");

      expect(replace).toHaveBeenCalledWith(returnTo);
    });

    test("continues to it for a signed-in visitor on a reported error", async () => {
      setAttempt(VALID_ATTEMPT_ID, "INVALID_TOKEN", "/admin");
      const replace = mock((_href: string) => undefined);
      window.location.replace = replace as typeof window.location.replace;

      await renderAndFlush("en-US");

      expect(replace).toHaveBeenCalledWith("/admin");
    });

    test.each(unsafeReturnTargets)(
      "ignores %p and continues to the account",
      async (unsafeReturnTo) => {
        setAttempt(VALID_ATTEMPT_ID, undefined, unsafeReturnTo);
        const replace = mock((_href: string) => undefined);
        window.location.replace = replace as typeof window.location.replace;

        await renderAndFlush("en-US");

        expect(replace).toHaveBeenCalledWith("/en-US/account");
      }
    );
  });
});
