import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  mock,
  test,
} from "bun:test";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";

const signInMagicLink = mock(() => Promise.resolve({ error: null }));
const signOut = mock(() => Promise.resolve({ error: null }));
const getSession = mock(() => Promise.resolve({ data: null, error: null }));

mock.module("@/features/account/auth.client", () => ({
  authClient: {
    signIn: {
      magicLink: signInMagicLink,
    },
    signOut,
    getSession,
  },
}));

describe("account components", () => {
  beforeAll(() => {
    registerWorkspaceComponentTestEnv();
  });

  afterEach(() => {
    cleanup();
  });

  afterAll(() => {
    unregisterWorkspaceComponentTestEnv();
  });

  test("sign-in card shows the request form in both locales", async () => {
    const { SignInCard } = await import("./sign-in-card");

    const en = render(<SignInCard locale="en-US" />);
    expect(en.container.querySelector("h1")!.textContent).toBe(
      "Sign in or create an account"
    );
    expect(
      (en.getByLabelText("Email") as HTMLInputElement).hasAttribute("required")
    ).toBe(true);
    expect(
      en.getByLabelText("Email").getAttribute("aria-describedby")
    ).toBeNull();
    en.unmount();

    const cs = render(<SignInCard locale="cs-CZ" />);
    expect(cs.container.querySelector("h1")!.textContent).toBe(
      "Přihlášení nebo vytvoření účtu"
    );
    expect(cs.getByLabelText("E-mail")).toBeTruthy();
  });

  test("sign-in card swaps to the generic accepted state after the request succeeds", async () => {
    const { SignInCard } = await import("./sign-in-card");

    const view = render(<SignInCard locale="en-US" />);
    fireEvent.change(view.getByLabelText("Email"), {
      target: { value: "ada@example.test" },
    });
    await act(async () => {
      fireEvent.submit(view.container.querySelector("#account-sign-in-form")!);
    });

    expect(signInMagicLink).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "ada@example.test",
        callbackURL: "/en-US/auth/callback",
        metadata: { locale: "en-US" },
      })
    );
    expect(view.getByText("Check your inbox")).toBeTruthy();
    expect(view.getByText(/single-use link will arrive shortly/)).toBeTruthy();

    fireEvent.click(view.getByText("Send another link"));
    expect(view.getByLabelText("Email")).toBeTruthy();
  });

  test("sign-in card reports request failures in the live region", async () => {
    signInMagicLink.mockImplementationOnce(() =>
      Promise.resolve({ error: { message: "rate limited" } })
    );
    const { SignInCard } = await import("./sign-in-card");

    const view = render(<SignInCard locale="en-US" />);
    fireEvent.change(view.getByLabelText("Email"), {
      target: { value: "ada@example.test" },
    });
    await act(async () => {
      fireEvent.submit(view.container.querySelector("#account-sign-in-form")!);
    });

    expect(
      view.getByText("We could not send the link. Please try again.")
    ).toBeTruthy();
  });

  test("sign-out button signs out the current device and leaves the locale", async () => {
    const { SignOutButton } = await import("./sign-out-button");

    let assigned: string | null = null;
    const originalAssign = window.location.assign;
    window.location.assign = ((href: string) => {
      assigned = href;
    }) as typeof window.location.assign;

    const view = render(<SignOutButton locale="cs-CZ" />);
    await act(async () => {
      view.getByText("Odhlásit se").click();
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(signOut).toHaveBeenCalledTimes(1);
    expect(assigned).toBe("/cs-CZ");
    window.location.assign = originalAssign;
  });
});
