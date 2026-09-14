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
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";
import { AuthCallbackRedirect } from "./auth-callback-redirect";

const VALID_ATTEMPT_ID = "550e8400-e29b-41d4-a716-446655440000";
const handOffReturn = mock((_options: { readonly attemptId: string }) =>
  Promise.resolve(false)
);

mock.module("@/shared/browser/return-window", () => ({ handOffReturn }));

let originalReplace: typeof window.location.replace;
let originalClose: typeof window.close;
let originalClosed: PropertyDescriptor | undefined;
let originalSearch: PropertyDescriptor | undefined;

const setAttempt = (attemptId?: string, error?: string) => {
  const search = new URLSearchParams();
  if (attemptId !== undefined) search.set("attempt", attemptId);
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
    handOffReturn.mockReset();
    handOffReturn.mockImplementation(() => Promise.resolve(false));
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
    "keeps the visible fallback after replacing %s with the account page",
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

    expect(close).toHaveBeenCalledTimes(1);
    expect(replace).toHaveBeenCalledWith("/en-US/account");
  });

  test("does not close and navigates when the return is not acknowledged", async () => {
    setAttempt(VALID_ATTEMPT_ID);
    handOffReturn.mockResolvedValue(false);
    const close = mock(() => undefined);
    window.close = close as typeof window.close;
    const replace = mock((_href: string) => undefined);
    window.location.replace = replace as typeof window.location.replace;

    await renderAndFlush("en-US");

    expect(close).not.toHaveBeenCalled();
    expect(replace).toHaveBeenCalledWith("/en-US/account");
  });

  test("falls back when the callback has no attempt", async () => {
    setAttempt();
    const replace = mock((_href: string) => undefined);
    window.location.replace = replace as typeof window.location.replace;

    await renderAndFlush("cs-CZ");

    expect(handOffReturn).toHaveBeenCalledWith({ attemptId: "" });
    expect(replace).toHaveBeenCalledWith("/cs-CZ/account");
  });

  test("suppresses handoff and close when the callback reports an error", async () => {
    setAttempt(VALID_ATTEMPT_ID, "INVALID_TOKEN");
    const close = mock(() => undefined);
    window.close = close as typeof window.close;
    const replace = mock((_href: string) => undefined);
    window.location.replace = replace as typeof window.location.replace;

    await renderAndFlush("en-US");

    expect(handOffReturn).not.toHaveBeenCalled();
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
});
