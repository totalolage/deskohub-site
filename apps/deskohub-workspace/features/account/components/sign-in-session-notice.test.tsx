import { afterAll, afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import { m } from "@/features/i18n";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";

mock.module("@/features/account/auth.client", () => ({
  authClient: {
    getSession: () => Promise.resolve({ data: null, error: null }),
    signIn: { magicLink: () => Promise.resolve({ error: null }) },
    signOut: () => Promise.resolve({ error: null }),
  },
}));

mock.module("@/shared/browser/return-window", () => ({
  listenForReturn: () => () => undefined,
}));

registerWorkspaceComponentTestEnv();

const { SignInCard } = await import("./sign-in-card");

afterEach(cleanup);

afterAll(unregisterWorkspaceComponentTestEnv);

describe("sign-in session notice", () => {
  test("renders the session-expired notice for the saved-card session flag", () => {
    const view = render(<SignInCard locale="en-US" sessionNotice />);
    expect(
      view.getByText(m.accountSessionExpired({}, { locale: "en-US" }))
    ).toBeTruthy();
    expect(view.getByRole("status").getAttribute("aria-live")).toBe("polite");
    expect(view.container.querySelector("#account-sign-in-form")).toBeTruthy();
  });

  test("renders the Czech session-expired notice copy", () => {
    const view = render(<SignInCard locale="cs-CZ" sessionNotice />);
    expect(
      view.getByText(m.accountSessionExpired({}, { locale: "cs-CZ" }))
    ).toBeTruthy();
  });

  test("renders nothing for the notice without the session flag", () => {
    const view = render(<SignInCard locale="en-US" />);
    expect(view.queryByRole("status")).toBeNull();
    expect(
      view.queryByText(m.accountSessionExpired({}, { locale: "en-US" }))
    ).toBeNull();
  });

  test("keeps the sign-in form interactive with the notice present", () => {
    const view = render(<SignInCard locale="en-US" sessionNotice />);
    const emailInput = view.container.querySelector("#account-sign-in-email");
    expect(emailInput).toBeTruthy();
    expect((emailInput as HTMLInputElement | null)?.disabled).toBe(false);
  });
});
