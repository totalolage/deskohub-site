import type { CustomerAccountState } from "@deskohub/workspace-customer-api";
import { useAtom } from "@effect/atom-react";
import { Option } from "effect";
import type { AppLocale } from "../../i18n/app-locale";
import { useAppLocale } from "../../i18n/locale-context";
import { m } from "../../i18n/messages";
import { Button } from "../../ui/controls";
import { Notice } from "../../ui/notice";
import {
  acknowledgeSignupReferralAtom,
  isDismissible,
  type SignupReferralMessage,
  signupReferralMessage,
  signupReferralOf,
} from "./signup-referral";

const message = (kind: SignupReferralMessage, locale: AppLocale) =>
  ({
    applied: m.profile_referral_applied,
    pending: m.profile_referral_pending,
    "already-referred": m.profile_referral_already_referred,
    "not-eligible": m.profile_referral_not_eligible,
    "code-unusable": m.profile_referral_code_unusable,
    "profile-already-completed": m.profile_referral_profile_already_completed,
  })[kind]({}, { locale });

/**
 * What happened to the referral code the customer completed their profile
 * with. It stays on every visit until they dismiss it; a pending code is
 * retried later and has no Dismiss.
 */
export function SignupReferralNotice({
  account,
}: {
  readonly account: CustomerAccountState;
}) {
  const locale = useAppLocale();
  const [dismissal, dismiss] = useAtom(acknowledgeSignupReferralAtom);
  const outcome = signupReferralOf(account);
  const dismissing = dismissal.waiting;
  const failed = !dismissing && dismissal._tag === "Failure";
  return (
    <>
      <Notice
        tone={
          Option.exists(outcome, ({ status }) => status === "not-applied")
            ? "warning"
            : "info"
        }
        message={Option.getOrUndefined(
          Option.map(outcome, (current) =>
            message(signupReferralMessage(current), locale)
          )
        )}
      />
      {Option.exists(outcome, isDismissible) && (
        <Button
          label={m.profile_referral_dismiss({}, { locale })}
          variant="secondary"
          disabled={dismissing}
          onPress={() => dismiss(undefined)}
        />
      )}
      <Notice
        tone="error"
        message={
          failed && Option.isSome(outcome)
            ? m.profile_referral_dismiss_failed({}, { locale })
            : undefined
        }
      />
    </>
  );
}
