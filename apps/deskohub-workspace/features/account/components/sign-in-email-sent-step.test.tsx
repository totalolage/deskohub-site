import { afterAll, afterEach, describe, expect, mock, test } from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import type { AuthReturnLifecycle } from "@/features/account/auth-return";
import type { EmailSignInRequest } from "@/features/account/email-sign-in-request";
import { m } from "@/features/i18n";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";

registerWorkspaceComponentTestEnv();
// @testing-library/react must load after the happy-dom registration.
const { cleanup, render } = await import("@testing-library/react");
const { SignInEmailSentStep } = await import("./sign-in-email-sent-step");

const authReturn: AuthReturnLifecycle = {
  cancel: () => undefined,
  sendSignInEmail: () => Promise.resolve({ status: "cancelled" }),
  resumeSignInEmail: () => undefined,
  verifySignInCode: () => new Promise(() => undefined),
  continueWithVerifiedCode: () => false,
  signInWithPassword: () => new Promise(() => undefined),
  continueWithPassword: () => false,
  continueIfSignedIn: () => Promise.resolve(false),
};

const renderStep = (
  locale: "en-US" | "cs-CZ",
  signInCode: boolean
): ReturnType<typeof render> => {
  const request: EmailSignInRequest = {
    email: testEmailAddress("ada"),
    requestedAt: Date.now(),
    signInCode,
    returnTo: `/${locale}/cowork`,
  };
  return render(
    <SignInEmailSentStep
      locale={locale}
      authReturn={authReturn}
      request={request}
      onRequestChange={mock(() => undefined)}
      onUseDifferentEmail={mock(() => undefined)}
    />
  );
};

describe("SignInEmailSentStep handoff copy", () => {
  afterEach(cleanup);
  afterAll(unregisterWorkspaceComponentTestEnv);

  test.each(["en-US", "cs-CZ"] as const)(
    "link-only (%s) names this browser and the assistant's browser, without a code",
    (locale) => {
      const view = renderStep(locale, false);

      expect(
        view.getByRole("heading", {
          name: m.accountSignInAcceptedTitle({}, { locale }),
        })
      ).toBeTruthy();
      expect(
        view.getByText(m.accountSignInAcceptedSameBrowser({}, { locale }))
      ).toBeTruthy();
      expect(
        view.getByText(m.accountSignInAssistantBrowserHint({}, { locale }))
      ).toBeTruthy();
      expect(
        view.queryByText(m.accountSignInCodeAssistantHint({}, { locale }))
      ).toBeNull();
      expect(
        view.queryByLabelText(m.accountSignInCodeLabel({}, { locale }))
      ).toBeNull();
    }
  );

  test.each(["en-US", "cs-CZ"] as const)(
    "with sign-in codes (%s) also offers typing or reading out the code",
    (locale) => {
      const view = renderStep(locale, true);

      expect(
        view.getByRole("heading", {
          name: m.accountSignInCodeTitle({}, { locale }),
        })
      ).toBeTruthy();
      expect(
        view.getByText(m.accountSignInCodeLinkHint({}, { locale }))
      ).toBeTruthy();
      expect(
        view.getByText(m.accountSignInCodeAssistantHint({}, { locale }))
      ).toBeTruthy();
      expect(
        view.getByText(m.accountSignInAssistantBrowserHint({}, { locale }))
      ).toBeTruthy();
      // The code step's link hint already covers this browser.
      expect(
        view.queryByText(m.accountSignInAcceptedSameBrowser({}, { locale }))
      ).toBeNull();
    }
  );
});
