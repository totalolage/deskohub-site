"use client";

import { Check, Copy, Info } from "lucide-react";
import { type ReactNode, useState } from "react";
import { AccountSectionPanel } from "@/features/account/components/shell/account-section-panel";
import { formatDiscountAdjustment } from "@/features/checkout/format-discount-adjustment";
import { type Locale, m } from "@/features/i18n";
import { formatReferralDiscount } from "@/features/referrals/client";
import type { ReferralAccountOverview } from "@/features/referrals/contracts";
import {
  referralDiscountBenchmark,
  referralInvitationDiscountBasisPoints,
  referralsToPassBenchmark,
  referralVisitWindowDays,
  referrerDiscountBasisPointsPerInvitee,
} from "@/features/referrals/program";
import { Button } from "@/shared/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/shared/components/ui/tooltip";
import { formatMoney } from "@/shared/money/money";
import { formatDuration } from "@/shared/utils/format-duration";

export function ReferralScreen({
  locale,
  referrals,
}: {
  readonly locale: Locale;
  readonly referrals?: ReferralAccountOverview;
}) {
  if (!referrals) {
    return (
      <div className="min-w-0" data-screen="referrals-screen">
        <AccountSectionPanel
          size="compact"
          title={m.accountReferralsCountTitle({}, { locale })}
        >
          <p
            className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-950"
            role="status"
          >
            {m.accountReferralsSummaryUnavailable({}, { locale })}
          </p>
        </AccountSectionPanel>
      </div>
    );
  }

  const { shareUrl, summary } = referrals;
  const shareLink = new URL(shareUrl);
  const total = String(summary.inviteeCount);
  const eligible = String(summary.eligibleInviteeCount);
  const formatPercentage = (basisPoints: number) =>
    formatDiscountAdjustment({ kind: "percentage", basisPoints }, locale);

  return (
    <div className="min-w-0 space-y-8" data-screen="referrals-screen">
      <div className="grid min-w-0 gap-4 @xl:grid-cols-2">
        <AccountSectionPanel
          size="compact"
          actions={
            <InfoTooltip
              label={m.accountReferralsCountInfoLabel({}, { locale })}
            >
              {m.accountReferralsCountInfo({}, { locale })}
            </InfoTooltip>
          }
          bodyClassName="flex flex-1 flex-col items-center text-center"
          className="flex flex-col"
          title={m.accountReferralsCountTitle({}, { locale })}
        >
          <p
            aria-hidden="true"
            className="flex flex-wrap items-baseline justify-center gap-x-3 leading-none"
          >
            <span
              className="text-5xl font-bold tabular-nums tracking-tight text-sunset-yellow-ink @sm:text-6xl"
              id="account-referrals-eligible-count"
            >
              {eligible}
            </span>
            <span
              className="text-2xl font-semibold tabular-nums text-[#64748b]"
              id="account-referrals-total-count"
            >
              / {total}
            </span>
          </p>
          <p className="sr-only">
            {m.accountReferralsCountSummary({ eligible, total }, { locale })}
          </p>
          {summary.inviteeCount === 0 && (
            <p className="mt-3 text-sm leading-6 text-[#51627c] @xl:mt-5">
              {m.accountReferralsCountEmpty({}, { locale })}
            </p>
          )}
        </AccountSectionPanel>

        <AccountSectionPanel
          size="compact"
          actions={
            <InfoTooltip
              label={m.accountReferralsDiscountInfoLabel({}, { locale })}
            >
              {m.accountReferralsDiscountInfo({}, { locale })}
            </InfoTooltip>
          }
          bodyClassName="flex flex-1 flex-col items-center text-center"
          className="flex flex-col"
          title={m.accountReferralsDiscountTitle({}, { locale })}
        >
          <p
            className="text-5xl font-bold tabular-nums tracking-tight leading-none text-aquamarine-ink @sm:text-6xl"
            id="account-referrals-discount"
          >
            {formatReferralDiscount(summary.discount, locale)}
          </p>
          {summary.savings.length > 0 ? (
            <ul
              className="m-0 mt-3 flex list-none flex-wrap justify-center gap-2 p-0 @xl:mt-5"
              data-state="saved"
              id="account-referrals-savings"
            >
              {summary.savings.map((amount) => (
                <li
                  className="rounded-full bg-aquamarine-ink px-4 py-1.5 text-sm font-semibold text-white"
                  key={amount.currency}
                >
                  {m.accountReferralsSaved(
                    { amount: formatMoney(amount, locale) },
                    { locale }
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p
              className="mt-3 text-sm leading-6 text-[#51627c] @xl:mt-5"
              data-state="empty"
              id="account-referrals-savings"
            >
              {m.accountReferralsSavedNothing({}, { locale })}
            </p>
          )}
        </AccountSectionPanel>
      </div>

      <div className="grid min-w-0 gap-4 @xl:grid-cols-2">
        <AccountSectionPanel
          bodyClassName="flex flex-1 flex-col"
          className="flex flex-col"
          size="compact"
          title={m.accountReferralsCodeLabel({}, { locale })}
        >
          <CopyableValue
            copiedLabel={m.accountReferralsCodeCopied({}, { locale })}
            copyLabel={m.accountReferralsCopyCode({}, { locale })}
            locale={locale}
            value={summary.code}
          >
            <code
              className="block break-all text-lg font-semibold tracking-wide text-[#344258]"
              id="account-referrals-code"
            >
              {summary.code}
            </code>
          </CopyableValue>
        </AccountSectionPanel>
        <AccountSectionPanel
          bodyClassName="flex flex-1 flex-col"
          className="flex flex-col"
          size="compact"
          title={m.accountReferralsLinkLabel({}, { locale })}
        >
          <CopyableValue
            copiedLabel={m.accountReferralsLinkCopied({}, { locale })}
            copyLabel={m.accountReferralsCopyLink({}, { locale })}
            locale={locale}
            value={shareUrl}
          >
            {/* Wrap only between the origin, path, and query, keeping the code
                whole; break inside a part only if it alone overflows. */}
            <a
              className="block text-sm text-burned-orange underline underline-offset-4 [overflow-wrap:anywhere]"
              href={shareUrl}
              id="account-referrals-link"
            >
              {shareLink.origin}
              <wbr />
              {shareLink.pathname}
              <wbr />
              {shareLink.search}
            </a>
          </CopyableValue>
        </AccountSectionPanel>
      </div>

      <AccountSectionPanel
        size="compact"
        title={m.accountReferralsHowTitle({}, { locale })}
      >
        <ul className="m-0 min-w-0 list-disc space-y-3 pl-5 text-sm leading-6 text-[#344258] marker:text-[#8291a6]">
          <li>
            {m.accountReferralsHowInvite(
              {
                discount: formatPercentage(
                  referralInvitationDiscountBasisPoints
                ),
              },
              { locale }
            )}
          </li>
          <li>
            {m.accountReferralsHowCompound(
              {
                discount: formatPercentage(
                  referrerDiscountBasisPointsPerInvitee
                ),
                duration: formatDuration(
                  [{ value: referralVisitWindowDays, unit: "day" }],
                  locale
                ),
              },
              { locale }
            )}
          </li>
          <li>
            {m.accountReferralsHowBenchmark(
              {
                benchmark: formatPercentage(referralDiscountBenchmark * 10_000),
                count: referralsToPassBenchmark,
              },
              { locale }
            )}
          </li>
        </ul>
      </AccountSectionPanel>
    </div>
  );
}

function InfoTooltip({
  children,
  label,
}: {
  readonly children: ReactNode;
  readonly label: string;
}) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            aria-label={label}
            size="icon-sm"
            tone="muted"
            type="button"
            variant="ghost"
          >
            <Info aria-hidden="true" className="size-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent
          align="end"
          className="w-[min(20rem,calc(100vw-2rem))] break-words whitespace-normal"
          collisionPadding={16}
        >
          {children}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function CopyableValue({
  children,
  copiedLabel,
  copyLabel,
  locale,
  value,
}: {
  readonly children: ReactNode;
  readonly copiedLabel: string;
  readonly copyLabel: string;
  readonly locale: Locale;
  readonly value: string;
}) {
  const [copyStatus, setCopyStatus] = useState<"copied" | "failed">();
  const label = copyStatus === "copied" ? copiedLabel : copyLabel;

  const copy = async () => {
    setCopyStatus(undefined);
    try {
      if (!navigator.clipboard?.writeText)
        throw new Error("clipboard unavailable");
      await navigator.clipboard.writeText(value);
      setCopyStatus("copied");
    } catch {
      setCopyStatus("failed");
    }
  };

  return (
    <>
      <div className="flex min-w-0 flex-1 items-end gap-3">
        <div className="min-w-0 flex-1 self-start">{children}</div>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                aria-label={label}
                className="shrink-0"
                onClick={copy}
                size="icon"
                type="button"
                variant="secondary"
              >
                {copyStatus === "copied" ? (
                  <Check aria-hidden="true" className="size-4" />
                ) : (
                  <Copy aria-hidden="true" className="size-4" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent align="end" collisionPadding={16}>
              {label}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
      <p className="text-sm leading-5 text-burned-orange-ink" role="status">
        {copyStatus === "copied" && (
          <span className="sr-only">{copiedLabel}</span>
        )}
        {copyStatus === "failed" && (
          <span className="mt-2 block">
            {m.accountReferralsCopyUnavailable({}, { locale })}
          </span>
        )}
      </p>
    </>
  );
}
