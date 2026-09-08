import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
} from "bun:test";
import { cleanup, render } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { workspaceRouterReplace } from "@/shared/testing/workspace-component-module-mocks";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";
import { AuthCallbackRedirect } from "./auth-callback-redirect";

describe("AuthCallbackRedirect", () => {
  beforeAll(registerWorkspaceComponentTestEnv);
  afterEach(() => {
    cleanup();
    workspaceRouterReplace.mockClear();
  });
  afterAll(unregisterWorkspaceComponentTestEnv);

  test.each([
    ["en-US", "/en-US/account", "Loading sign-in…", "My Workspace"],
    ["cs-CZ", "/cs-CZ/account", "Načítání přihlášení…", "Můj Workspace"],
  ] as const)(
    "keeps the visible fallback after replacing %s with the account page",
    (locale, target, label, accountLabel) => {
      const view = render(<AuthCallbackRedirect locale={locale} />);
      const status = view.getByRole("status", { name: label });
      const staticMarkup = renderToStaticMarkup(
        <AuthCallbackRedirect locale={locale} />
      );

      expect(workspaceRouterReplace).toHaveBeenCalledWith(target);
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
});
