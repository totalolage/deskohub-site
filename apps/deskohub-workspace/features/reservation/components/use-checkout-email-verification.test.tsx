import { afterAll, afterEach, describe, expect, mock, test } from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import type { SignInEmailResult } from "@/features/account/auth-return";
import { m } from "@/features/i18n";
import { workspaceRouterPush } from "@/shared/testing/workspace-component-module-mocks";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";

type Contact = { readonly email: string; readonly name: string };
type SealResult = {
  readonly data?: { readonly token: string };
  readonly thrown?: Error;
};
type ActionOptions = {
  readonly onError: () => void;
  readonly onSuccess: (args: {
    readonly data?: { readonly token: string };
    readonly input: Contact;
  }) => Promise<void>;
};

const adaEmail = testEmailAddress("ada");
const contact = { email: adaEmail, name: "Ada Lovelace" };

let sealResult: SealResult = { data: { token: "sealed-contact" } };
const sealCheckoutContact = mock((_contact: Contact) => undefined);
const startEmailSignIn = mock(
  async (_request: {
    readonly email: string;
    readonly locale: string;
    readonly returnTo: string;
  }): Promise<SignInEmailResult> => ({ status: "sent", signInCode: false })
);

mock.module("@/features/reservation/actions/seal-checkout-contact", () => ({
  sealCheckoutContact,
}));

const authReturn = await import("@/features/account/auth-return");
mock.module("@/features/account/auth-return", () => ({
  ...authReturn,
  startEmailSignIn,
}));

// The action resolves as the safe-action hook does: a thrown action runs
// onError, anything else onSuccess with the sealed data.
mock.module("@/shared/utils/use-workspace-action", () => ({
  useWorkspaceAction: (
    action: typeof sealCheckoutContact,
    options: ActionOptions
  ) => ({
    isExecuting: false,
    execute: (input: Contact) => {
      action(input);
      if (sealResult.thrown) {
        options.onError();
        return;
      }
      void options.onSuccess({ data: sealResult.data, input });
    },
  }),
}));

// React DOM detects input events when it loads, so the DOM must exist first.
registerWorkspaceComponentTestEnv();
const { act, cleanup, renderHook, waitFor } = await import(
  "@testing-library/react"
);
const { useCheckoutEmailVerification } = await import(
  "./use-checkout-email-verification"
);

const en = { locale: "en-US" } as const;

const verify = async () => {
  const view = renderHook(() => useCheckoutEmailVerification(en));
  await act(async () => {
    view.result.current.verify(contact as never);
  });
  return view;
};

describe("useCheckoutEmailVerification", () => {
  afterEach(() => {
    cleanup();
    sealResult = { data: { token: "sealed-contact" } };
    sealCheckoutContact.mockClear();
    startEmailSignIn.mockClear();
    workspaceRouterPush.mockClear();
  });

  afterAll(async () => {
    await unregisterWorkspaceComponentTestEnv();
  });

  test("seals the contact into the sign-in's return and opens the verify page", async () => {
    window.happyDOM.setURL(
      "https://workspace.test/en-US/coworking?date=2026-10-25&contact=old"
    );

    const view = await verify();

    expect(sealCheckoutContact).toHaveBeenCalledWith(contact);
    await waitFor(() => expect(workspaceRouterPush).toHaveBeenCalledTimes(1));
    expect(startEmailSignIn.mock.calls[0]?.[0]).toEqual({
      email: adaEmail,
      locale: "en-US",
      returnTo: "/en-US/coworking?date=2026-10-25&contact=sealed-contact",
    });
    expect(workspaceRouterPush.mock.calls[0]).toEqual([
      "/en-US/auth/verify",
      { scroll: false },
    ] as never);
    expect(view.result.current.error).toBeUndefined();
    expect(view.result.current.isVerifying).toBe(false);
  });

  test("continues a review login to its password on the verify page", async () => {
    startEmailSignIn.mockImplementationOnce(async () => ({
      status: "password",
    }));

    await verify();

    await waitFor(() => expect(workspaceRouterPush).toHaveBeenCalledTimes(1));
  });

  test("shows why the sign-in email was not sent", async () => {
    startEmailSignIn.mockImplementationOnce(async () => ({
      status: "failed",
      reason: "rate-limited",
    }));

    const view = await verify();

    await waitFor(() =>
      expect(view.result.current.error).toBe(m.accountSignInRateLimited({}, en))
    );
    expect(workspaceRouterPush).not.toHaveBeenCalled();

    act(() => view.result.current.clearError());
    expect(view.result.current.error).toBeUndefined();
  });

  test("stays put without an error when a later send replaced the request", async () => {
    startEmailSignIn.mockImplementationOnce(async () => ({
      status: "cancelled",
    }));

    const view = await verify();

    await waitFor(() => expect(startEmailSignIn).toHaveBeenCalledTimes(1));
    await act(async () => {});
    expect(view.result.current.error).toBeUndefined();
    expect(workspaceRouterPush).not.toHaveBeenCalled();
  });

  test("reports a failure when the contact could not be sealed", async () => {
    sealResult = {};
    const unsealed = await verify();
    expect(unsealed.result.current.error).toBe(
      m.reservationErrorMessage({}, en)
    );
    expect(startEmailSignIn).not.toHaveBeenCalled();
    cleanup();

    sealResult = { thrown: new Error("offline") };
    const thrown = await verify();
    expect(thrown.result.current.error).toBe(m.reservationErrorMessage({}, en));
    expect(startEmailSignIn).not.toHaveBeenCalled();
  });

  test("counts the sign-in email's send as verifying", async () => {
    let finishSend: (result: SignInEmailResult) => void = () => undefined;
    startEmailSignIn.mockImplementationOnce(
      () =>
        new Promise<SignInEmailResult>((resolve) => {
          finishSend = resolve;
        })
    );

    const view = await verify();
    expect(view.result.current.isVerifying).toBe(true);

    await act(async () => {
      finishSend({ status: "sent", signInCode: true });
    });
    expect(view.result.current.isVerifying).toBe(false);
  });
});
