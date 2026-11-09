import { afterAll, afterEach, describe, expect, mock, test } from "bun:test";
import type { SignInCodeVerification } from "@/features/account/auth-return";
import { m } from "@/features/i18n";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";

registerWorkspaceComponentTestEnv();
// @testing-library/react must load after the happy-dom registration, or
// React's synthetic change events never fire against controlled inputs.
const { act, cleanup, fireEvent, render } = await import(
  "@testing-library/react"
);
const { SignInCodeStep } = await import("./sign-in-code-step");

const locale = "en-US";
type TestLocale = "en-US" | "cs-CZ";
const cooldownOverAt = () => Date.now() - 61 * 1000;
const nextFrame = () =>
  new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

type StepOptions = {
  readonly locale?: TestLocale;
  readonly requestedAt?: number;
  readonly verifyCode?: (code: string) => Promise<SignInCodeVerification>;
  readonly requestNewEmail?: () => Promise<
    "sent" | "address-limit" | "rate-limited" | "failed"
  >;
};

const renderStep = ({
  locale: stepLocale = locale,
  requestedAt = cooldownOverAt(),
  verifyCode = () => Promise.resolve("wrong"),
  requestNewEmail = () => Promise.resolve("sent"),
}: StepOptions = {}) => {
  const props = {
    locale: stepLocale,
    verifiedMessage: m.accountSignInCodeVerified({}, { locale: stepLocale }),
    verifyCode: mock(verifyCode),
    onVerified: mock(() => undefined),
    requestNewEmail: mock(requestNewEmail),
    onUseDifferentEmail: mock(() => undefined),
  } as const;
  const view = render(<SignInCodeStep {...props} requestedAt={requestedAt} />);
  const input = () =>
    view.getByLabelText(
      m.accountSignInCodeLabel({}, { locale: stepLocale })
    ) as HTMLInputElement;
  const status = () =>
    view.container.querySelector("#account-sign-in-code-status")!;
  const resend = () =>
    view.container.querySelector(
      "#account-sign-in-code-resend"
    ) as HTMLButtonElement;
  return { props, view, input, status, resend };
};

const typeCode = async (input: HTMLInputElement, value: string) => {
  await act(async () => {
    fireEvent.change(input, { target: { value } });
  });
};

const pasteCode = async (input: HTMLInputElement, text: string) => {
  await act(async () => {
    input.focus();
    fireEvent.paste(input, {
      clipboardData: { getData: () => text },
    });
  });
};

describe("sign-in code step", () => {
  afterEach(() => {
    cleanup();
  });

  afterAll(async () => {
    await unregisterWorkspaceComponentTestEnv();
  });

  test("labels a one-time-code input and keeps the live region mounted", () => {
    const { input, status } = renderStep();

    expect(input().getAttribute("autocomplete")).toBe("one-time-code");
    expect(input().getAttribute("inputmode")).toBe("numeric");
    expect(input().maxLength).toBe(6);
    expect(input().getAttribute("aria-describedby")).toBe(
      "account-sign-in-code-status"
    );
    expect(status().getAttribute("aria-live")).toBe("polite");
    expect(status().textContent).toBe("");
  });

  test("submits automatically on the sixth digit, not before", async () => {
    const { props, input } = renderStep();

    await typeCode(input(), "48291");
    expect(props.verifyCode).not.toHaveBeenCalled();

    await typeCode(input(), "482913");
    expect(props.verifyCode).toHaveBeenCalledTimes(1);
    expect(props.verifyCode).toHaveBeenCalledWith("482913");
  });

  test.each(["en-US", "cs-CZ"] as const)(
    "shows the automated-request message in %s with error styling",
    async (stepLocale) => {
      const { input, status } = renderStep({
        locale: stepLocale,
        verifyCode: () => Promise.resolve("automated"),
      });

      await typeCode(input(), "482913");

      expect(status().textContent).toBe(
        m.accountSignInAutomatedRequest({}, { locale: stepLocale })
      );
      expect(status().classList.contains("text-red-700")).toBe(true);
    }
  );

  test.each(["482 913", "482913", " 482-913\n"])(
    "normalises a pasted code %p and submits it",
    async (pasted) => {
      const { props, input } = renderStep();

      await pasteCode(input(), pasted);

      expect(props.verifyCode).toHaveBeenCalledWith("482913");
    }
  );

  test("rejects typed non-digits", async () => {
    const { props, input } = renderStep();

    await typeCode(input(), "48a");

    expect(input().value).toBe("");
    expect(props.verifyCode).not.toHaveBeenCalled();
  });

  test("announces a wrong code, clears it, and refocuses the input", async () => {
    const { input, status } = renderStep({
      verifyCode: () => Promise.resolve("wrong"),
    });

    await typeCode(input(), "000000");
    await act(nextFrame);

    expect(status().textContent).toBe(
      m.accountSignInCodeInvalid({}, { locale })
    );
    expect(input().value).toBe("");
    expect(input().disabled).toBe(false);
    expect(input().getAttribute("aria-invalid")).toBe("true");
    expect(document.activeElement).toBe(input());
  });

  test("reports a failed check and lets the customer try again", async () => {
    const { props, input, status } = renderStep({
      verifyCode: () => Promise.resolve("failed"),
    });

    await typeCode(input(), "482913");
    await act(nextFrame);

    expect(status().textContent).toBe(
      m.accountSignInCodeFailed({}, { locale })
    );
    expect(input().disabled).toBe(false);
    expect(document.activeElement).toBe(input());

    await typeCode(input(), "482913");
    expect(props.verifyCode).toHaveBeenCalledTimes(2);
  });

  test.each([
    ["expired", () => m.accountSignInCodeExpired({}, { locale })],
    [
      "too-many-attempts",
      () => m.accountSignInCodeTooManyAttempts({}, { locale }),
    ],
  ] as const)(
    "locks the input for a %s code and moves focus to a new email",
    async (verification, message) => {
      const { input, status, resend } = renderStep({
        verifyCode: () => Promise.resolve(verification),
      });

      await typeCode(input(), "482913");
      await act(nextFrame);

      expect(status().textContent).toBe(message());
      expect(input().disabled).toBe(true);
      expect(resend().disabled).toBe(false);
      expect(document.activeElement).toBe(resend());
    }
  );

  test("focuses the explanation when a dead code can't be resent yet", async () => {
    const { input, status, resend } = renderStep({
      requestedAt: Date.now(),
      verifyCode: () => Promise.resolve("too-many-attempts"),
    });

    await typeCode(input(), "482913");
    await act(nextFrame);

    expect(resend().disabled).toBe(true);
    expect(document.activeElement).toBe(status());
  });

  test("shows the verified state and hands over", async () => {
    const { props, input, status, resend } = renderStep({
      verifyCode: () => Promise.resolve("verified"),
    });

    await typeCode(input(), "482913");

    expect(props.onVerified).toHaveBeenCalledTimes(1);
    expect(status().textContent).toBe(
      m.accountSignInCodeVerified({}, { locale })
    );
    expect(input().disabled).toBe(true);
    expect(resend().disabled).toBe(true);
  });

  test("counts the resend cooldown down inside the disabled button", () => {
    const { resend } = renderStep({ requestedAt: Date.now() - 58_500 });

    expect(resend().disabled).toBe(true);
    expect(resend().textContent).toBe(
      m.accountSignInCodeResendCooldown({ seconds: 2 }, { locale })
    );
  });

  test("sends a new email once the cooldown is over", async () => {
    const { props, input, status, resend } = renderStep();

    expect(resend().textContent).toBe(
      m.accountSignInCodeResend({}, { locale })
    );
    await act(async () => {
      fireEvent.click(resend());
    });

    expect(props.requestNewEmail).toHaveBeenCalledTimes(1);
    expect(status().textContent).toBe(
      m.accountSignInCodeResent({}, { locale })
    );
    expect(document.activeElement).toBe(input());
  });

  test.each([
    ["address-limit", () => m.accountSignInEmailLimitReached({}, { locale })],
    ["rate-limited", () => m.accountSignInRateLimited({}, { locale })],
    ["failed", () => m.accountSignInRequestFailed({}, { locale })],
  ] as const)("explains a %s resend rejection", async (outcome, message) => {
    const { status, resend } = renderStep({
      requestNewEmail: () => Promise.resolve(outcome),
    });

    await act(async () => {
      fireEvent.click(resend());
    });

    expect(status().textContent).toBe(message());
  });

  test("starts the entry over for a new email", async () => {
    const { props, view, input, status } = renderStep({
      verifyCode: () => Promise.resolve("expired"),
    });
    await typeCode(input(), "482913");
    expect(input().disabled).toBe(true);

    view.rerender(<SignInCodeStep {...props} requestedAt={Date.now()} />);

    expect(input().disabled).toBe(false);
    expect(status().textContent).toBe("");
  });

  test("offers to change the email", () => {
    const { props, view } = renderStep();

    fireEvent.click(
      view.getByRole("button", {
        name: m.accountSignInCodeChangeEmail({}, { locale }),
      })
    );

    expect(props.onUseDifferentEmail).toHaveBeenCalledTimes(1);
  });

  test("reports an address limit after an expired code", async () => {
    const { input, status, resend } = renderStep({
      verifyCode: () => Promise.resolve("expired"),
      requestNewEmail: () => Promise.resolve("address-limit"),
    });

    await typeCode(input(), "482913");
    await act(nextFrame);
    await act(async () => {
      fireEvent.click(resend());
    });

    expect(status().textContent).toBe(
      m.accountSignInEmailLimitReached({}, { locale })
    );
  });

  test("reports a resend rate limit after a wrong code", async () => {
    const { input, status, resend } = renderStep({
      verifyCode: () => Promise.resolve("wrong"),
      requestNewEmail: () => Promise.resolve("rate-limited"),
    });

    await typeCode(input(), "482913");
    await act(nextFrame);
    await act(async () => {
      fireEvent.click(resend());
    });

    expect(status().textContent).toBe(
      m.accountSignInRateLimited({}, { locale })
    );
  });
});
