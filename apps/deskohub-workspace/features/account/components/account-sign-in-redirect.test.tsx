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
import { parseReferralCode } from "@/features/referrals/client";
import { workspaceRouterReplace } from "@/shared/testing/workspace-component-module-mocks";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";
import { AccountSignInRedirect } from "./account-sign-in-redirect";

describe("AccountSignInRedirect", () => {
  beforeAll(registerWorkspaceComponentTestEnv);
  afterEach(() => {
    cleanup();
    workspaceRouterReplace.mockClear();
  });
  afterAll(unregisterWorkspaceComponentTestEnv);

  test.each([
    ["en-US", "/en-US/auth/sign-in", "Loading sign-in…"],
    ["cs-CZ", "/cs-CZ/auth/sign-in", "Načítání přihlášení…"],
  ] as const)(
    "redirects %s to the localized sign-in page while keeping the fallback",
    (locale, target, label) => {
      const view = render(<AccountSignInRedirect locale={locale} />);
      const status = view.getByRole("status", { name: label });
      const staticMarkup = renderToStaticMarkup(
        <AccountSignInRedirect locale={locale} />
      );

      expect(workspaceRouterReplace).toHaveBeenCalledWith(target);
      expect(status).toBeTruthy();
      expect(status.getAttribute("aria-busy")).toBe("true");
      expect(staticMarkup).toContain(`<a href="${target}">`);
      expect(view.container.querySelector("form")).toBeNull();
      expect(view.queryByRole("textbox")).toBeNull();
      expect(view.container.querySelector("[value]")).toBeNull();
      expect(view.container.textContent).not.toContain("@");
    }
  );

  test("preserves only the referral code on the fixed sign-in redirect", () => {
    const referralCode = parseReferralCode("RFL12345");
    if (referralCode === undefined) throw new Error("Invalid referral fixture");
    const props = { locale: "en-US" as const, referralCode };
    const view = render(<AccountSignInRedirect {...props} />);
    const staticMarkup = renderToStaticMarkup(
      <AccountSignInRedirect {...props} />
    );

    expect(workspaceRouterReplace).toHaveBeenCalledWith(
      "/en-US/auth/sign-in?ref=RFL12345"
    );
    expect(staticMarkup).toContain('href="/en-US/auth/sign-in?ref=RFL12345"');
    expect(view.container.textContent).not.toContain("returnTo");
  });
});
