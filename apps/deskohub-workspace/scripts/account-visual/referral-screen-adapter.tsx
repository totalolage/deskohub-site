import { AccountLayoutShell } from "@/features/account/components/account-layout-shell";
import { AccountPage } from "@/features/account/components/account-page";
import type { CustomerAccountPageState } from "@/features/account/page-data.server";
import { parseReferralCode } from "@/features/referrals/client";
import type { ReferralAccountSummary } from "@/features/referrals/contracts";
import type { AccountVisualAdapterProps } from "./types";

const referralCode = parseReferralCode("RFL12345");
if (referralCode === undefined) {
  throw new Error("The fixed synthetic referral code is invalid");
}

const summary = {
  code: referralCode,
  eligibleInviteeCount: 1,
  discount: "5",
} as const satisfies ReferralAccountSummary;

const linkedFixture = {
  kind: "linked",
  email: "ada@example.test",
  profile: {
    firstName: "Ada",
    lastName: "Example",
    phone: null,
    billing: null,
  },
  avatar: { kind: "hidden" },
  history: {
    kind: "available",
    groups: { current: [], past: [], unavailable: [] },
  },
} as const satisfies CustomerAccountPageState;

export const accountVisualAdapterMetadata = {
  owner: "synthetic referral component renderer",
  fixture:
    "fixed synthetic linked-account display; referral code and links are masked in screenshots",
} as const;

export function ReferralScreenContent({
  locale,
  summary,
}: AccountVisualAdapterProps & {
  readonly summary?: ReferralAccountSummary;
}) {
  const query = new URLSearchParams(window.location.search);
  const referralValues = query.getAll("ref");
  const invitationCode =
    referralValues.length === 1
      ? parseReferralCode(referralValues[0])
      : undefined;

  return (
    <AccountLayoutShell accountsEnabled locale={locale} signedIn>
      <AccountPage
        locale={locale}
        referralCode={invitationCode}
        state={{
          ...linkedFixture,
          referrals: summary,
        }}
      />
    </AccountLayoutShell>
  );
}

export function ReferralScreenAdapter(props: AccountVisualAdapterProps) {
  return <ReferralScreenContent {...props} summary={summary} />;
}

export default ReferralScreenAdapter;
