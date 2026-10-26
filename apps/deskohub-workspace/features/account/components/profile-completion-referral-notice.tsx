"use client";

import { useRouter } from "next/navigation";
import { acknowledgeSignupReferralNotice } from "@/features/account/actions";
import type { ProfileCompletionReferralOutcome } from "@/features/account/contracts";
import { type Locale, m } from "@/features/i18n";
import { formatReferralInvitationDiscount } from "@/features/referrals/client";
import { Button } from "@/shared/components/ui/button";
import { useWorkspaceAction } from "@/shared/utils/use-workspace-action";

const getProfileCompletionReferralMessage = (
  outcome: ProfileCompletionReferralOutcome,
  locale: Locale
) => {
  if (outcome.status === "applied") {
    return m.accountProfileReferralApplied(
      { discount: formatReferralInvitationDiscount(locale) },
      { locale }
    );
  }
  if (outcome.status === "pending") {
    return m.accountProfileReferralPending({}, { locale });
  }
  return {
    "already-referred": m.accountProfileReferralAlreadyReferred({}, { locale }),
    "not-eligible": m.accountProfileReferralNotEligible({}, { locale }),
    "code-unusable": m.accountProfileReferralCodeNotUsable({}, { locale }),
    "profile-already-completed":
      m.accountProfileReferralProfileAlreadyCompleted({}, { locale }),
  }[outcome.reason];
};

/**
 * Shows the outcome of the referral code entered at profile completion, from
 * the account's stored state alone. A pending code shows until it settles; a
 * settled outcome shows on every visit until the customer dismisses it, so a
 * refresh, a second tab, or an abandoned response cannot lose or revive it.
 */
export function ProfileCompletionReferralNotice({
  locale,
  outcome,
}: {
  readonly locale: Locale;
  readonly outcome?: ProfileCompletionReferralOutcome;
}) {
  const router = useRouter();
  const dismiss = useWorkspaceAction(acknowledgeSignupReferralNotice, {
    onSuccess: () => router.refresh(),
  });

  return (
    <div role="status">
      {outcome && (
        <div
          className={`mb-6 flex items-start justify-between gap-4 rounded-2xl border px-4 py-3 text-sm leading-6 ${
            outcome.status === "applied"
              ? "border-emerald-200 bg-emerald-50 text-emerald-900"
              : "border-navy-blue/12 bg-white/92 text-navy-blue"
          }`}
        >
          <p className="min-w-0">
            {getProfileCompletionReferralMessage(outcome, locale)}
          </p>
          {outcome.status !== "pending" && (
            <Button
              className="shrink-0"
              disabled={dismiss.isExecuting}
              onClick={() => dismiss.execute({})}
              size="xs"
              type="button"
              variant="ghost"
            >
              {m.accountProfileReferralNoticeDismiss({}, { locale })}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
