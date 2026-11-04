import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  test,
} from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import { m } from "@/features/i18n";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";

registerWorkspaceComponentTestEnv();
const { act, cleanup, fireEvent, render, waitFor } = await import(
  "@testing-library/react"
);
const { rememberEmailSignInRequest } = await import(
  "@/features/account/email-sign-in-request"
);

const locale = "en-US";
const signedOut = { data: null, error: null };
const signedIn = {
  data: {
    session: { createdAt: new Date() },
    user: { emailVerified: true },
  },
  error: null,
};

const getSession = mock(
  (): Promise<{ readonly data: unknown; readonly error: null }> =>
    Promise.resolve(signedOut)
);
const routerReplace = mock((_href: string) => undefined);
const routerBack = mock(() => undefined);

mock.module("@/features/account/auth.client", () => ({
  authClient: { getSession },
}));
mock.module("next/navigation", () => ({
  useRouter: () => ({ back: routerBack, replace: routerReplace }),
}));

const { SignInVerifyCard } = await import("./sign-in-verify-card");

const navigations: string[] = [];
const originalReplace = window.location.replace;

describe("sign-in verify card", () => {
  beforeEach(() => {
    window.location.replace = ((href: string) => {
      navigations.push(href);
    }) as typeof window.location.replace;
  });

  afterEach(() => {
    cleanup();
    rememberEmailSignInRequest(null);
    sessionStorage.clear();
    window.location.replace = originalReplace;
    navigations.length = 0;
    routerReplace.mockClear();
    routerBack.mockClear();
    getSession.mockClear();
    getSession.mockImplementation(() => Promise.resolve(signedOut));
  });

  afterAll(async () => {
    await unregisterWorkspaceComponentTestEnv();
  });

  test("page sends a signed-out tab with nothing waiting to sign-in with the notice", async () => {
    const view = render(
      <SignInVerifyCard locale={locale} presentation="page" />
    );

    await waitFor(() =>
      expect(navigations).toEqual([
        "/en-US/auth/sign-in?notice=no-longer-waiting",
      ])
    );
    expect(routerReplace).not.toHaveBeenCalled();
    expect(
      view.getByRole("status", {
        name: m.accountSignInLoading({}, { locale }),
      })
    ).toBeTruthy();
  });

  test("modal hands a signed-out tab with nothing waiting to the sign-in modal with the notice", async () => {
    render(<SignInVerifyCard locale="cs-CZ" presentation="modal" />);

    await waitFor(() =>
      expect(routerReplace).toHaveBeenCalledWith(
        "/cs-CZ/auth/sign-in?notice=no-longer-waiting"
      )
    );
    expect(navigations).toEqual([]);
  });

  test.each(["page", "modal"] as const)(
    "%s sends a signed-in tab with nothing waiting to the account",
    async (presentation) => {
      getSession.mockImplementation(() => Promise.resolve(signedIn));

      render(<SignInVerifyCard locale={locale} presentation={presentation} />);

      await waitFor(() => expect(navigations).toEqual(["/en-US/account"]));
      expect(routerReplace).not.toHaveBeenCalled();
    }
  );

  test("a waiting sign-in stays on the email step while signed out", async () => {
    rememberEmailSignInRequest({
      email: testEmailAddress("ada"),
      requestedAt: Date.now(),
      signInCode: false,
    });

    const view = render(
      <SignInVerifyCard locale={locale} presentation="page" />
    );

    expect(
      await view.findByText(m.accountSignInAcceptedTitle({}, { locale }))
    ).toBeTruthy();
    await waitFor(() => expect(getSession).toHaveBeenCalled());
    expect(navigations).toEqual([]);
    expect(routerReplace).not.toHaveBeenCalled();
  });

  describe("using a different email", () => {
    const rememberWaitingRequest = (returnTo?: string) =>
      rememberEmailSignInRequest({
        email: testEmailAddress("ada"),
        requestedAt: Date.now(),
        signInCode: false,
        returnTo,
      });

    const useDifferentEmail = async (view: ReturnType<typeof render>) => {
      await act(async () => {
        fireEvent.click(
          await view.findByRole("button", {
            name: m.accountSignInAcceptedAgain({}, { locale }),
          })
        );
      });
    };

    test("the page opens the form the sign-in returns to and keeps the step until it is gone", async () => {
      rememberWaitingRequest("/en-US/account/billing");
      const view = render(
        <SignInVerifyCard locale={locale} presentation="page" />
      );

      await useDifferentEmail(view);

      expect(routerReplace).toHaveBeenCalledWith("/en-US/account/billing");
      expect(routerBack).not.toHaveBeenCalled();
      // A reload no longer restores the request, but the step stays on screen.
      expect(sessionStorage.length).toBe(0);
      expect(
        view.getByText(m.accountSignInAcceptedTitle({}, { locale }))
      ).toBeTruthy();

      // Once the card is gone, the request is dropped for every view.
      view.unmount();
      render(<SignInVerifyCard locale={locale} presentation="page" />);
      await waitFor(() =>
        expect(navigations).toEqual([
          "/en-US/auth/sign-in?notice=no-longer-waiting",
        ])
      );
    });

    test("the page opens the plain sign-in form for a request without a return path", async () => {
      rememberWaitingRequest();
      const view = render(
        <SignInVerifyCard locale={locale} presentation="page" />
      );

      await useDifferentEmail(view);

      expect(routerReplace).toHaveBeenCalledWith("/en-US/auth/sign-in");
    });

    test("the modal closes back to the form underneath", async () => {
      rememberWaitingRequest("/en-US/account/billing");
      const view = render(
        <SignInVerifyCard locale={locale} presentation="modal" />
      );

      await useDifferentEmail(view);

      expect(routerBack).toHaveBeenCalledTimes(1);
      expect(routerReplace).not.toHaveBeenCalled();
    });
  });
});
