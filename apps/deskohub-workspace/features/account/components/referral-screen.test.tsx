import {
  afterAll,
  afterEach,
  beforeAll,
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
  within,
} from "@testing-library/react";
import { parseReferralCode } from "@/features/referrals/client";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";

// Radix resolves its layout-effect hook on import, so load the screen only
// after the component test DOM is registered.
let ReferralScreen: typeof import("./referral-screen").ReferralScreen;

const code = parseReferralCode("RFL12345");
if (code === undefined) throw new Error("Invalid referral test code");

const shareUrl = "https://workspace.example/account?ref=RFL12345";
const referrals = {
  summary: {
    code,
    inviteeCount: 5,
    eligibleInviteeCount: 3,
    discount: "14.2625",
    savings: [{ value: 9234, exponent: 2, currency: "CZK" }],
  },
  shareUrl,
} as const;
const originalClipboard = Object.getOwnPropertyDescriptor(
  navigator,
  "clipboard"
);

describe("ReferralScreen", () => {
  beforeAll(async () => {
    registerWorkspaceComponentTestEnv();
    ({ ReferralScreen } = await import("./referral-screen"));
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
    {
      locale: "en-US",
      headings: [
        "Referrals",
        "Global discount",
        "Your referral code",
        "Your referral link",
        "How referrals work",
      ],
      countSummary: "Referrals counting toward your discount: 3 of 5.",
      discount: "15%",
      saved: "CZK 92.34 saved!",
    },
    {
      locale: "cs-CZ",
      headings: [
        "Doporučení",
        "Globální sleva",
        "Tvůj doporučovací kód",
        "Tvůj doporučovací odkaz",
        "Jak doporučení fungují",
      ],
      countSummary: "Doporučení započítaná do tvé slevy: 3 z 5.",
      discount: "15 %",
      // Text queries collapse the no-break space Intl puts before the symbol.
      saved: "Ušetřeno 92,34 Kč!",
    },
  ] as const)(
    "shows the referral counts, rounded-up discount, savings, and share details in $locale",
    ({ countSummary, discount, headings, locale, saved }) => {
      const view = render(
        <ReferralScreen locale={locale} referrals={referrals} />
      );

      expect(
        view.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)
      ).toEqual([...headings]);
      const referralCount = within(
        view.getByRole("region", { name: headings[0] })
      );
      expect(
        view.container.querySelector("#account-referrals-eligible-count")
          ?.textContent
      ).toBe("3");
      expect(referralCount.getByText("/ 5")).toBeTruthy();
      expect(referralCount.getByText(countSummary)).toBeTruthy();
      expect(
        view.container.querySelector("#account-referrals-discount")?.textContent
      ).toBe(discount);
      expect(
        within(view.getByRole("region", { name: headings[1] })).getByText(saved)
      ).toBeTruthy();
      expect(
        within(view.getByRole("region", { name: headings[2] })).getByText(
          "RFL12345"
        )
      ).toBeTruthy();
      const link = within(
        view.getByRole("region", { name: headings[3] })
      ).getByRole("link");
      expect(link.getAttribute("href")).toBe(shareUrl);
      expect(link.textContent).toBe(shareUrl);
      expect(view.queryByText(/@/)).toBeNull();
    }
  );

  test.each([
    [
      "en-US",
      [
        "Share your code or link to grant a 15% discount on the first Workspace reservation!",
        "For each invitee who visited us in the past 30 days, you get a compounding 5% discount!",
        "That means with just 5 referrals, you get over 20% off!",
      ],
    ],
    [
      "cs-CZ",
      [
        "Sdílej svůj kód nebo odkaz a nový zákazník získá slevu 15 % na svou první rezervaci ve Workspace!",
        "Za každého pozvaného, který nás navštívil během posledních 30 dnů, získáš další slevu 5 %. Slevy se skládají!",
        "To znamená, že stačí jen 5 doporučení a máš slevu přes 20 %!",
      ],
    ],
  ] as const)(
    "explains the program terms from its configuration in %s",
    (locale, terms) => {
      const view = render(
        <ReferralScreen locale={locale} referrals={referrals} />
      );
      const howItWorks = within(
        view.getAllByRole("region").at(-1) as HTMLElement
      );

      expect(
        howItWorks.getAllByRole("listitem").map((item) => item.textContent)
      ).toHaveLength(3);
      for (const term of terms) expect(howItWorks.getByText(term)).toBeTruthy();
    }
  );

  test("offers only the customer's own share code and link, with no way to accept another code", () => {
    const view = render(
      <ReferralScreen locale="en-US" referrals={referrals} />
    );
    const screen = view.container.querySelector(
      '[data-screen="referrals-screen"]'
    );

    expect(screen?.querySelector("#account-referrals-code")?.textContent).toBe(
      "RFL12345"
    );
    expect(
      screen?.querySelector("#account-referrals-link")?.getAttribute("href")
    ).toBe(shareUrl);
    expect(view.queryByRole("textbox")).toBeNull();
    expect(
      view
        .getAllByRole("button")
        .map((button) => button.getAttribute("aria-label"))
    ).toEqual([
      "What the referral numbers mean",
      "About your global discount",
      "Copy referral code",
      "Copy referral link",
    ]);
  });

  test.each([
    ["Copy referral code", "Referral code copied.", "RFL12345"],
    ["Copy referral link", "Referral link copied.", shareUrl],
  ] as const)(
    "%s copies the exact value and reports success and failure",
    async (copyLabel, copiedLabel, value) => {
      const writeText = mock(() => Promise.resolve());
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: { writeText },
      });
      const view = render(
        <ReferralScreen locale="en-US" referrals={referrals} />
      );
      const button = view.getByRole("button", { name: copyLabel });
      const card = within(button.closest("section") as HTMLElement);

      await act(async () => {
        fireEvent.click(button);
        await Promise.resolve();
      });
      expect(writeText).toHaveBeenCalledWith(value);
      expect(view.getByRole("button", { name: copiedLabel })).toBeTruthy();
      expect(card.getByRole("status").textContent).toBe(copiedLabel);

      writeText.mockImplementation(() =>
        Promise.reject(new Error("clipboard denied"))
      );
      await act(async () => {
        fireEvent.click(view.getByRole("button", { name: copiedLabel }));
        await Promise.resolve();
      });
      expect(card.getByRole("status").textContent).toBe(
        "Your browser could not copy it. Select and copy it instead."
      );
    }
  );
});
