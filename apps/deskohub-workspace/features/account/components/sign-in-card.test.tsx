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
const confirmDiscardChanges = mock(() => true);
const allowNextUnload = mock(() => {});

mock.module("@/features/account/auth.client", () => ({
  authClient: {
    signIn: {
      magicLink: signInMagicLink,
    },
    signOut,
    getSession,
  },
}));

mock.module("@/shared/components/unsaved-changes-guard", () => ({
  useAllowNextUnload: () => allowNextUnload,
  useConfirmDiscardChanges: () => confirmDiscardChanges,
}));

describe("account components", () => {
  beforeAll(() => {
    registerWorkspaceComponentTestEnv();
  });

  afterEach(() => {
    cleanup();
    signInMagicLink.mockClear();
    signOut.mockClear();
    confirmDiscardChanges.mockClear();
    allowNextUnload.mockClear();
    confirmDiscardChanges.mockImplementation(() => true);
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

  test("sign-in card shows a visible pending submit and sends only once", async () => {
    let resolveRequest!: (result: { error: null }) => void;
    const request = new Promise<{ error: null }>((resolve) => {
      resolveRequest = resolve;
    });
    signInMagicLink.mockImplementationOnce(() => request);
    const { SignInCard } = await import("./sign-in-card");

    const view = render(<SignInCard locale="en-US" />);
    fireEvent.change(view.getByLabelText("Email"), {
      target: { value: "ada@example.test" },
    });
    const form = view.container.querySelector("#account-sign-in-form")!;

    await act(async () => {
      fireEvent.submit(form);
      await Promise.resolve();
    });

    const submit = view.getByRole("button", {
      name: "Sending…",
    }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    expect(submit.getAttribute("aria-busy")).toBe("true");
    expect(submit.querySelector("svg")).toBeTruthy();

    fireEvent.click(submit);
    expect(signInMagicLink).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveRequest({ error: null });
      await request;
    });

    expect(view.getByText("Check your inbox")).toBeTruthy();
  });

  test("sign-in card reports rejected requests and exits the pending state", async () => {
    const request = Promise.reject(new Error("network failure"));
    signInMagicLink.mockImplementationOnce(() => request);
    const { SignInCard } = await import("./sign-in-card");

    const view = render(<SignInCard locale="en-US" />);
    fireEvent.change(view.getByLabelText("Email"), {
      target: { value: "ada@example.test" },
    });
    const form = view.container.querySelector("#account-sign-in-form")!;

    await act(async () => {
      fireEvent.submit(form);
      await request.catch(() => undefined);
    });

    expect(
      view.getByText("We could not send the link. Please try again.")
    ).toBeTruthy();
    const submit = view.getByRole("button", {
      name: "Email me a sign-in link",
    }) as HTMLButtonElement;
    expect(submit.disabled).toBe(false);
    expect(submit.getAttribute("aria-busy")).toBe("false");
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

  test("sign-out button rejects discard before changing auth or navigation", async () => {
    confirmDiscardChanges.mockImplementationOnce(() => false);

    let assigned: string | null = null;
    const originalAssign = window.location.assign;
    window.location.assign = ((href: string) => {
      assigned = href;
    }) as typeof window.location.assign;

    try {
      const { SignOutButton } = await import("./sign-out-button");
      const view = render(<SignOutButton locale="cs-CZ" />);

      await act(async () => {
        fireEvent.click(view.getByRole("button", { name: "Odhlásit se" }));
      });

      expect(confirmDiscardChanges).toHaveBeenCalledWith();
      expect(signOut).not.toHaveBeenCalled();
      expect(assigned).toBeNull();
    } finally {
      window.location.assign = originalAssign;
    }
  });

  test("sign-out button signs out once and redirects to the localized root", async () => {
    const { SignOutButton } = await import("./sign-out-button");

    let assigned: string | null = null;
    const originalAssign = window.location.assign;
    window.location.assign = ((href: string) => {
      assigned = href;
    }) as typeof window.location.assign;

    try {
      const view = render(<SignOutButton locale="cs-CZ" />);
      const signOutButton = view.getByRole("button", { name: "Odhlásit se" });
      expect(signOutButton.className).toContain("bg-red-800");
      await act(async () => {
        fireEvent.click(signOutButton);
      });
      await Promise.resolve();
      await Promise.resolve();

      expect(confirmDiscardChanges).toHaveBeenCalledWith();
      expect(signOut).toHaveBeenCalledTimes(1);
      expect(allowNextUnload).toHaveBeenCalledTimes(1);
      expect(assigned).toBe("/cs-CZ");
    } finally {
      window.location.assign = originalAssign;
    }
  });
});
