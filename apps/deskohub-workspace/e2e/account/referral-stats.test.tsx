import { afterAll, afterEach, beforeAll, expect, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import { getAccountSectionPath } from "@/features/account/routes";
import { m } from "@/features/i18n";
import {
  formatReferralDiscount,
  formatReferralDiscountReduction,
  parseReferralCode,
} from "@/features/referrals/client";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";
import { accountSectionLabels } from "./account-sections";
import { referralStatsCondition } from "./referral-stats";

// Radix resolves its layout-effect hook on import, so load the components
// only after the component test DOM is registered.
let ReferralScreen: typeof import("@/features/account/components/referral-screen").ReferralScreen;
let AccountShell: typeof import("@/features/account/components/shell/account-shell").AccountShell;

const locale = "en-US" as const;
const code = parseReferralCode("RFL12345");
if (code === undefined) throw new Error("Invalid referral test code");

beforeAll(async () => {
  registerWorkspaceComponentTestEnv();
  ({ ReferralScreen } = await import(
    "@/features/account/components/referral-screen"
  ));
  ({ AccountShell } = await import(
    "@/features/account/components/shell/account-shell"
  ));
});
afterEach(cleanup);
afterAll(unregisterWorkspaceComponentTestEnv);

const renderReferrals = (input: {
  readonly eligible: number;
  readonly total: number;
  readonly discount: string;
  readonly saved: boolean;
}) =>
  render(
    <AccountShell
      activeSection="referrals"
      labels={{
        mobileSection: "Account section",
        navigation: "Account navigation",
        sections: accountSectionLabels,
      }}
      onSectionChange={() => {}}
      sectionHref={(section) => getAccountSectionPath(locale, section)}
      referralBadge={
        input.discount === "0"
          ? undefined
          : {
              text: formatReferralDiscountReduction(input.discount, locale),
              label: m.accountReferralsNavigationBadgeLabel(
                { discount: formatReferralDiscount(input.discount, locale) },
                { locale }
              ),
            }
      }
      signOut={null}
      title="My Workspace"
    >
      <ReferralScreen
        locale={locale}
        referrals={{
          summary: {
            code,
            inviteeCount: input.total,
            eligibleInviteeCount: input.eligible,
            discount: input.discount,
            savings: input.saved
              ? [{ value: 9234, exponent: 2, currency: "CZK" }]
              : [],
          },
          shareUrl: "https://workspace.example/account?ref=RFL12345",
        }}
      />
    </AccountShell>
  );

const holds = (condition: string): unknown =>
  // biome-ignore lint/security/noGlobalEval: The E2E runners evaluate this exact browser expression.
  globalThis.eval(condition);

test("matches the rendered referral stats, savings state, and navigation badge", () => {
  renderReferrals({ eligible: 1, total: 1, discount: "5", saved: false });

  expect(
    holds(
      referralStatsCondition({ count: 1, locale, savings: "empty", total: 1 })
    )
  ).toBe(true);
  expect(holds(referralStatsCondition({ count: 1, locale }))).toBe(true);
  expect(holds(referralStatsCondition({ count: 2, locale }))).toBe(false);
  expect(holds(referralStatsCondition({ count: 1, locale, total: 2 }))).toBe(
    false
  );
  expect(
    holds(referralStatsCondition({ count: 1, locale, savings: "saved" }))
  ).toBe(false);
});

test("expects no navigation badge without eligible referrals", () => {
  renderReferrals({ eligible: 0, total: 3, discount: "0", saved: true });

  expect(
    holds(
      referralStatsCondition({ count: 0, locale, savings: "saved", total: 3 })
    )
  ).toBe(true);
});
