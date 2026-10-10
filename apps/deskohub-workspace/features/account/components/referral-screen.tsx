"use client";

import { Check, Copy, Gift } from "lucide-react";
import { useState } from "react";
import type { AccountReferralAcceptanceResult } from "@/features/account/referral-acceptance";
import { acceptAccountReferral } from "@/features/account/referral-actions";
import { type Locale, m } from "@/features/i18n";
import type { ReferralCode } from "@/features/referrals/client";
import type { ReferralAccountSummary } from "@/features/referrals/contracts";
import { Button } from "@/shared/components/ui/button";
import { useWorkspaceAction } from "@/shared/utils/use-workspace-action";

export function ReferralScreen({
  invitationCode,
  locale,
  summary,
}: {
  readonly invitationCode?: ReferralCode;
  readonly locale: Locale;
  readonly summary?: ReferralAccountSummary;
}) {
  const link = summary
    ? `/${locale}/account?${new URLSearchParams({ ref: summary.code })}`
    : undefined;
  const discount = summary
    ? `${new Intl.NumberFormat(locale, { maximumFractionDigits: 4 }).format(
        Number(summary.discount)
      )}%`
    : undefined;

  return (
    <section
      aria-labelledby="account-referrals-title"
      className="min-w-0"
      data-screen="referrals-screen"
    >
      <div className="rounded-3xl border border-[#dfe4ec] bg-white p-5 shadow-sm sm:p-8">
        <div className="flex items-start gap-3">
          <span className="mt-1 flex size-10 shrink-0 items-center justify-center rounded-2xl bg-[#fff2df] text-[#a84e12]">
            <Gift aria-hidden="true" className="size-5" />
          </span>
          <div className="min-w-0">
            <h2
              className="text-2xl font-semibold text-navy-blue sm:text-3xl"
              id="account-referrals-title"
            >
              {m.accountReferralsTitle({}, { locale })}
            </h2>
            <p className="mt-2 text-sm leading-6 text-navy-blue/68">
              {m.accountReferralsDescription({}, { locale })}
            </p>
          </div>
        </div>

        {summary && link && (
          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            <div className="min-w-0 rounded-2xl border border-[#dfe4ec] bg-[#fbfaf7] p-4">
              <p className="text-sm font-semibold text-[#344258]">
                {m.accountReferralsCodeLabel({}, { locale })}
              </p>
              <code className="mt-2 block break-all text-lg font-semibold tracking-wide text-navy-blue">
                {summary.code}
              </code>
            </div>
            <div className="min-w-0 rounded-2xl border border-[#dfe4ec] bg-[#fbfaf7] p-4">
              <p className="text-sm font-semibold text-[#344258]">
                {m.accountReferralsLinkLabel({}, { locale })}
              </p>
              <a
                className="mt-2 block break-all text-sm text-burned-orange underline underline-offset-4"
                href={link}
              >
                {link}
              </a>
              <CopyReferralLinkButton link={link} locale={locale} />
            </div>
          </div>
        )}
        {!summary && (
          <p
            className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-950"
            role="status"
          >
            {m.accountReferralsSummaryUnavailable({}, { locale })}
          </p>
        )}

        {summary && discount && (
          <div className="mt-5 rounded-2xl bg-[#f4f6f8] p-4 text-sm leading-6 text-[#344258]">
            <p>
              {m.accountReferralsEligibleInvitees(
                { count: String(summary.eligibleInviteeCount) },
                { locale }
              )}
            </p>
            <p className="mt-1">
              {m.accountReferralsCurrentDiscount({ discount }, { locale })}
            </p>
            <p className="mt-3 text-[#52647c]">
              {m.accountReferralsRewardTerms({}, { locale })}
            </p>
          </div>
        )}

        {invitationCode && (
          <ReferralInvitation code={invitationCode} locale={locale} />
        )}
      </div>
    </section>
  );
}

function CopyReferralLinkButton({
  link,
  locale,
}: {
  readonly link: string;
  readonly locale: Locale;
}) {
  const [copyStatus, setCopyStatus] = useState<"copied" | "failed">();

  const copyLink = async () => {
    setCopyStatus(undefined);
    try {
      if (!navigator.clipboard?.writeText)
        throw new Error("clipboard unavailable");
      await navigator.clipboard.writeText(
        new URL(link, window.location.origin).href
      );
      setCopyStatus("copied");
    } catch {
      setCopyStatus("failed");
    }
  };

  return (
    <div className="mt-3">
      <Button
        className="h-auto min-h-10 whitespace-normal rounded-full px-4 py-2 text-sm"
        onClick={copyLink}
        type="button"
        variant="secondary"
      >
        {copyStatus === "copied" ? (
          <Check aria-hidden="true" className="size-4" />
        ) : (
          <Copy aria-hidden="true" className="size-4" />
        )}
        {copyStatus === "copied"
          ? m.accountReferralsCopied({}, { locale })
          : m.accountReferralsCopyLink({}, { locale })}
      </Button>
      {copyStatus === "failed" && (
        <p
          className="mt-2 text-sm leading-5 text-burned-orange-ink"
          role="status"
        >
          {m.accountReferralsCopyUnavailable({}, { locale })}
        </p>
      )}
    </div>
  );
}

function ReferralInvitation({
  code,
  locale,
}: {
  readonly code: ReferralCode;
  readonly locale: Locale;
}) {
  const [transportError, setTransportError] = useState(false);
  const { execute, isExecuting, result } = useWorkspaceAction(
    acceptAccountReferral,
    {
      actionName: "account.accept-referral",
      onTransportError: () => setTransportError(true),
    }
  );
  const status = result.data?.status;
  const submit = () => {
    setTransportError(false);
    execute({ code });
  };

  const invitationStatusMessage = {
    accepted: m.accountReferralsAccepted({}, { locale }),
    already_accepted: m.accountReferralsAlreadyAccepted({}, { locale }),
    self_referral: m.accountReferralsSelfReferral({}, { locale }),
    already_attributed: m.accountReferralsAlreadyAttributed({}, { locale }),
    ineligible: m.accountReferralsIneligible({}, { locale }),
    unavailable: m.accountReferralsUnavailable({}, { locale }),
  } satisfies Record<AccountReferralAcceptanceResult["status"], string>;
  const statusMessage =
    status === undefined ? undefined : invitationStatusMessage[status];
  const message =
    (transportError && m.accountReferralsUnavailable({}, { locale })) ||
    statusMessage ||
    ((result.serverError || result.validationErrors) &&
      m.accountReferralsUnavailable({}, { locale }));

  return (
    <div className="mt-6 rounded-2xl border border-[#e7d5bd] bg-[#fffaf2] p-4 sm:p-5">
      <h3 className="text-base font-semibold text-[#344258]">
        {m.accountReferralsInvitationTitle({}, { locale })}
      </h3>
      <p className="mt-2 text-sm leading-6 text-[#52647c]">
        {m.accountReferralsInvitationDescription({}, { locale })}
      </p>
      <p className="mt-3 text-sm font-semibold text-navy-blue">
        <span className="sr-only">
          {m.accountReferralsCodeLabel({}, { locale })}:
        </span>
        <code>{code}</code>
      </p>
      <Button
        className="mt-4 h-auto min-h-11 whitespace-normal rounded-full px-5 py-3 text-center leading-5"
        disabled={
          isExecuting || status === "accepted" || status === "already_accepted"
        }
        onClick={submit}
        type="button"
      >
        {isExecuting
          ? m.accountReferralsAccepting({}, { locale })
          : m.accountReferralsAccept({}, { locale })}
      </Button>
      {message && (
        <p
          className="mt-3 rounded-xl bg-white px-3 py-2 text-sm leading-5 text-[#344258]"
          role="status"
        >
          {message}
        </p>
      )}
    </div>
  );
}
