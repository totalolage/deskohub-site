import type { ReferralAccountOverview } from "@deskohub/workspace-customer-api";
import { Effect, Match } from "effect";
import { CustomerApi } from "../../customer-api/customer-api.service";
import { customerDataRuntime } from "../../customer-api/customer-data-runtime";
import { customerRead } from "../../customer-api/customer-request";
import type { CustomerViewError } from "../../customer-api/customer-view-error";
import { Clipboard, ShareSheet } from "../../customer-api/device-capabilities";
import type { AppLocale } from "../../i18n/app-locale";
import { formatMoney } from "../../i18n/money-format";

/**
 * The account's referral summary and share link (GET /account/referrals).
 * The API answers 404 feature-unavailable while referrals aren't released.
 */
export const referralsAtom = customerDataRuntime.atom(
  Effect.flatMap(Effect.service(CustomerApi), (api) =>
    api.account.getReferrals()
  ).pipe(customerRead({ accountRead: false }))
);

/** Copies the referral code. It is meant to be passed on, so not sensitive. */
export const copyReferralCodeAtom = customerDataRuntime.fn((code: string) =>
  Effect.flatMap(Effect.service(Clipboard), (clipboard) =>
    clipboard.copy(code, { sensitive: false })
  )
);

/** Opens the share sheet with the referral link and an invitation. */
export const shareReferralLinkAtom = customerDataRuntime.fn(
  (link: { readonly url: string; readonly message: string }) =>
    Effect.flatMap(Effect.service(ShareSheet), (share) => share.shareLink(link))
);

/**
 * The referrer discount as the site shows it: a whole percentage rounded up,
 * such as "11%" for "10.25".
 */
export const formatReferralDiscount = (
  discount: string,
  locale: AppLocale
): string => {
  const [whole = "0", fraction = ""] = discount.split(".");
  const percent = Number(whole) + (/[1-9]/.test(fraction) ? 1 : 0);
  return new Intl.NumberFormat(locale, {
    style: "percent",
    maximumFractionDigits: 2,
  }).format(percent / 100);
};

/** What the Referrals screen shows for a summary. */
export interface ReferralsView {
  readonly code: string;
  readonly shareUrl: string;
  readonly eligibleInvitees: number;
  readonly invitees: number;
  /** Whether no one has joined with the referral yet. */
  readonly noInvitees: boolean;
  readonly discount: string;
  /** One formatted total per currency; empty when nothing was saved. */
  readonly savings: ReadonlyArray<string>;
}

export const referralsView = (
  { summary, shareUrl }: ReferralAccountOverview,
  locale: AppLocale
): ReferralsView => ({
  code: summary.code,
  shareUrl,
  eligibleInvitees: summary.eligibleInviteeCount,
  invitees: summary.inviteeCount,
  noInvitees: summary.inviteeCount === 0,
  discount: formatReferralDiscount(summary.discount, locale),
  savings: summary.savings.map((money) => formatMoney(money, locale)),
});

/**
 * How the Referrals screen words a failed read: referrals not released, or
 * the summary unavailable for now. Session, rate-limit and link failures keep
 * the shared wording.
 */
export type ReferralsFailure = "not-released" | "summary-unavailable";

export const referralsFailure = (
  error: CustomerViewError
): ReferralsFailure | undefined =>
  Match.value(error).pipe(
    Match.tag("FeatureUnavailable", () => "not-released" as const),
    Match.tag(
      "Unavailable",
      "TimedOut",
      "Unexpected",
      () => "summary-unavailable" as const
    ),
    Match.orElse(() => undefined)
  );
