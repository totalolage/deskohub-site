import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  mock,
  test,
} from "bun:test";
import {
  act,
  cleanup,
  fireEvent,
  render,
  waitFor,
} from "@testing-library/react";
import { useState } from "react";
import type { AccountReferralAcceptanceResult } from "@/features/account/referral-acceptance";
import type { ReferralCode } from "@/features/referrals/client";
import { parseReferralCode } from "@/features/referrals/client";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";

type MockActionResult = {
  readonly data?: AccountReferralAcceptanceResult;
  readonly serverError?: boolean;
  readonly validationErrors?: boolean;
};
type MockActionInput = { readonly code: ReferralCode };

let actionResult: MockActionResult = { data: { status: "accepted" } };
const acceptAccountReferral = mock((_input: MockActionInput) =>
  Promise.resolve(actionResult)
);

mock.module("@/features/account/referral-actions", () => ({
  acceptAccountReferral,
}));
// Keep the real workspace-action wrapper in the component test. This native
// hook stand-in leaves result empty on a rejected request and rejects
// executeAsync, matching the transport path the wrapper translates.
mock.module("next-safe-action/hooks", () => ({
  useAction: (
    action: (input: MockActionInput) => Promise<MockActionResult>
  ) => {
    const [result, setResult] = useState<MockActionResult>({});
    const [isExecuting, setExecuting] = useState(false);
    const executeAsync = async (input: MockActionInput) => {
      setExecuting(true);
      try {
        const nextResult = await action(input);
        setResult(nextResult);
        setExecuting(false);
        return nextResult;
      } catch (error) {
        setExecuting(false);
        throw error;
      }
    };

    return {
      execute: (input: MockActionInput) => {
        void executeAsync(input).catch(() => undefined);
      },
      executeAsync,
      isExecuting,
      result,
    };
  },
}));

const { ReferralScreen } = await import("./referral-screen");

const code = parseReferralCode("RFL12345");
if (code === undefined) throw new Error("Invalid referral test code");

const summary = {
  code,
  eligibleInviteeCount: 3,
  discount: "14.2625",
} as const;
const originalClipboard = Object.getOwnPropertyDescriptor(
  navigator,
  "clipboard"
);

describe("ReferralScreen", () => {
  beforeAll(registerWorkspaceComponentTestEnv);
  beforeEach(() => {
    actionResult = { data: { status: "accepted" } };
    acceptAccountReferral.mockClear();
    acceptAccountReferral.mockImplementation(() =>
      Promise.resolve(actionResult)
    );
  });
  afterEach(() => {
    cleanup();
    if (originalClipboard) {
      Object.defineProperty(navigator, "clipboard", originalClipboard);
    } else {
      Reflect.deleteProperty(navigator, "clipboard");
    }
  });
  afterAll(unregisterWorkspaceComponentTestEnv);

  test.each([
    [
      "en-US",
      "Invite other Workspace customers",
      "Currently eligible invited customers: 3",
    ],
    [
      "cs-CZ",
      "Pozvěte další zákazníky Workspace",
      "Právě způsobilí pozvaní zákazníci: 3",
    ],
  ] as const)(
    "shows the share code and eligible count in %s",
    (locale, title, countLabel) => {
      const view = render(<ReferralScreen locale={locale} summary={summary} />);

      expect(view.getByRole("heading", { name: title })).toBeTruthy();
      expect(view.getByText("RFL12345")).toBeTruthy();
      expect(view.getByText(countLabel)).toBeTruthy();
      expect(view.getByText(/14[,.]2625%/)).toBeTruthy();
      expect(
        view.getByRole("link", { name: `/${locale}/account?ref=RFL12345` })
      ).toBeTruthy();
      expect(view.queryByText(/@/)).toBeNull();
      expect(acceptAccountReferral).not.toHaveBeenCalled();
    }
  );

  test.each([
    [
      "en-US",
      "Each invited customer with a confirmed, paid Workspace booking that ended within the past 30 days adds a compounding 5% discount to your reservations.",
    ],
    [
      "cs-CZ",
      "Každý pozvaný zákazník s potvrzenou a zaplacenou rezervací ve Workspace, která skončila během posledních 30 dnů, zvyšuje vaši slevu na rezervace o dalších 5 %. Slevy se skládají.",
    ],
  ] as const)(
    "explains the booking-end reward window in %s",
    (locale, terms) => {
      const view = render(<ReferralScreen locale={locale} summary={summary} />);

      expect(view.getByText(terms)).toBeTruthy();
    }
  );

  test("accepts an invitation only after the linked account presses the action", async () => {
    const view = render(
      <ReferralScreen invitationCode={code} locale="en-US" summary={summary} />
    );

    expect(view.getByText(/gives you 15% off/)).toBeTruthy();
    expect(acceptAccountReferral).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.click(view.getByRole("button", { name: "Accept invitation" }));
      await Promise.resolve();
    });

    expect(acceptAccountReferral).toHaveBeenCalledWith({ code: "RFL12345" });
    expect(view.getByRole("status").textContent).toContain("Referral accepted");
  });

  test("shows unavailable account summary while preserving an explicit invitation action", async () => {
    actionResult = { data: { status: "unavailable" } };
    const view = render(
      <ReferralScreen invitationCode={code} locale="cs-CZ" />
    );

    expect(
      view.getByText("Informace o doporučeních jsou dočasně nedostupné.")
    ).toBeTruthy();
    await act(async () => {
      fireEvent.click(
        view.getByRole("button", { name: "Přijmout doporučení" })
      );
      await Promise.resolve();
    });
    expect(view.getAllByRole("status").at(-1)?.textContent).toContain(
      "Toto doporučení není dostupné"
    );
  });

  test("shows a clear result when an invitation code is unavailable", async () => {
    actionResult = { data: { status: "unavailable" } };
    const view = render(
      <ReferralScreen invitationCode={code} locale="en-US" />
    );

    await act(async () => {
      fireEvent.click(view.getByRole("button", { name: "Accept invitation" }));
      await Promise.resolve();
    });

    expect(view.getAllByRole("status").at(-1)?.textContent).toContain(
      "This referral invitation is unavailable"
    );
  });

  test.each([
    [
      "en-US",
      "Accept invitation",
      "This referral invitation is unavailable. Confirm that you are signed in with a linked account, then try again.",
      "This referral is already linked to your customer account.",
    ],
    [
      "cs-CZ",
      "Přijmout doporučení",
      "Toto doporučení není dostupné. Ověřte, že jste přihlášeni k propojenému účtu, a zkuste to znovu.",
      "Toto doporučení už je propojené s vaším zákaznickým účtem.",
    ],
  ] as const)(
    "shows recoverable transport feedback and an idempotent retry in %s",
    async (locale, acceptLabel, unavailableMessage, alreadyAcceptedMessage) => {
      let resolveRetry!: (result: MockActionResult) => void;
      const retry = new Promise<MockActionResult>((resolve) => {
        resolveRetry = resolve;
      });
      let attempts = 0;
      acceptAccountReferral.mockImplementation(() => {
        attempts += 1;
        if (attempts === 1)
          return Promise.reject(new Error("synthetic network details"));
        return retry;
      });

      const view = render(
        <ReferralScreen invitationCode={code} locale={locale} />
      );
      const button = view.getByRole("button", { name: acceptLabel });

      fireEvent.click(button);
      await waitFor(() => {
        expect(view.getAllByRole("status").at(-1)?.textContent).toBe(
          unavailableMessage
        );
        expect(button.disabled).toBe(false);
      });
      expect(view.queryByText("synthetic network details")).toBeNull();

      await act(async () => {
        fireEvent.click(button);
        await Promise.resolve();
      });
      expect(button.disabled).toBe(true);
      expect(view.queryByText(unavailableMessage)).toBeNull();

      await act(async () => {
        resolveRetry({ data: { status: "already_accepted" } });
        await retry;
      });
      expect(view.getAllByRole("status").at(-1)?.textContent).toBe(
        alreadyAcceptedMessage
      );
      expect(button.disabled).toBe(true);
      expect(acceptAccountReferral).toHaveBeenNthCalledWith(1, {
        code: "RFL12345",
      });
      expect(acceptAccountReferral).toHaveBeenNthCalledWith(2, {
        code: "RFL12345",
      });
    }
  );

  test.each([
    [
      "already_accepted",
      "This referral is already linked to your customer account.",
    ],
    ["self_referral", "You can’t accept your own referral code."],
    ["already_attributed", "Your customer account already has a referrer."],
  ] as const)("shows the %s invitation result", async (status, message) => {
    actionResult = { data: { status } };
    const view = render(
      <ReferralScreen invitationCode={code} locale="en-US" />
    );

    await act(async () => {
      fireEvent.click(view.getByRole("button", { name: "Accept invitation" }));
      await Promise.resolve();
    });

    expect(view.getAllByRole("status").at(-1)?.textContent).toContain(message);
  });

  test.each([
    [
      "en-US",
      "This invitation can’t be used because your account does not meet the first-booking and booking-history eligibility requirements.",
    ],
    [
      "cs-CZ",
      "Toto doporučení nelze použít, protože váš účet nesplňuje podmínky způsobilosti pro první rezervaci a historii rezervací.",
    ],
  ] as const)(
    "shows neutral first-booking eligibility guidance in %s",
    async (locale, message) => {
      actionResult = { data: { status: "ineligible" } };
      const view = render(
        <ReferralScreen invitationCode={code} locale={locale} />
      );

      await act(async () => {
        fireEvent.click(
          view.getByRole("button", {
            name:
              locale === "en-US" ? "Accept invitation" : "Přijmout doporučení",
          })
        );
        await Promise.resolve();
      });

      expect(view.getAllByRole("status").at(-1)?.textContent).toContain(
        message
      );
    }
  );

  test("shows copied and failed share-link feedback", async () => {
    window.location.href = "http://localhost/en-US/account";
    const writeText = mock(() => Promise.resolve());
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    const view = render(<ReferralScreen locale="en-US" summary={summary} />);

    await act(async () => {
      fireEvent.click(view.getByRole("button", { name: "Copy referral link" }));
      await Promise.resolve();
    });
    expect(writeText).toHaveBeenCalledWith(
      new URL("/en-US/account?ref=RFL12345", window.location.origin).href
    );
    expect(
      view.getByRole("button", { name: "Referral link copied." })
    ).toBeTruthy();

    writeText.mockImplementation(() =>
      Promise.reject(new Error("clipboard denied"))
    );
    await act(async () => {
      fireEvent.click(
        view.getByRole("button", { name: "Referral link copied." })
      );
      await Promise.resolve();
    });
    expect(view.getByRole("status").textContent).toContain(
      "Your browser could not copy the link. Select and copy it instead."
    );
  });
});
