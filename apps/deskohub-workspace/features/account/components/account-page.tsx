import Interpolate from "@doist/react-interpolate";
import Link from "next/link";
import { getAccountScreenCopy } from "@/features/account/components/account-screen-copy";
import { AccountSignInRedirect } from "@/features/account/components/account-sign-in-redirect";
import { AccountWithoutProfile } from "@/features/account/components/account-without-profile";
import { LinkedAccount } from "@/features/account/components/linked-account";
import { ProfileForm } from "@/features/account/components/profile-form";
import { ReservationHistory } from "@/features/account/components/reservation-history";
import { SessionRefresh } from "@/features/account/components/session-refresh";
import type { CustomerAccountPageState } from "@/features/account/page-data.server";
import { type Locale, m } from "@/features/i18n";
import type { ReferralCode } from "@/features/referrals/client";
import { ForgetRememberedReferralCode } from "@/features/referrals/forget-remembered-referral-code";
import { Card, CardContent } from "@/shared/components/ui/card";

const cardClassName =
  "rounded-3xl border-white/70 bg-white/92 shadow-[0_26px_80px_-48px_rgba(0,2,79,0.55)]";

export function AccountPage({
  locale,
  state,
}: {
  readonly locale: Locale;
  readonly state: CustomerAccountPageState;
}) {
  if (state.kind === "unauthenticated") {
    return <AccountSignInRedirect locale={locale} />;
  }
  if (state.kind === "linked") {
    return (
      <>
        <SessionRefresh />
        {state.rememberedReferralCodeUsed && <ForgetRememberedReferralCode />}
        <LinkedAccount
          avatarPresentation={state.avatar}
          email={state.email}
          locale={locale}
          passkeys={state.passkeys}
          profile={state.profile}
          referrals={state.referrals}
          referralsEnabled={state.referralsEnabled}
          reservationCount={
            state.history.kind === "available"
              ? state.history.groups.current.length
              : undefined
          }
          reservations={
            <ReservationHistory
              copy={getAccountScreenCopy(locale).reservations}
              history={state.history}
              locale={locale}
            />
          }
          signupReferral={state.signupReferral}
        />
      </>
    );
  }

  return (
    <>
      {state.kind !== "unavailable" && <SessionRefresh />}
      {renderState(locale, state)}
    </>
  );
}

function renderState(
  locale: Locale,
  state: Exclude<
    CustomerAccountPageState,
    { readonly kind: "unauthenticated" | "linked" }
  >
): React.ReactNode {
  switch (state.kind) {
    case "unavailable":
      return <UnavailableCard locale={locale} />;
    case "authenticated-unavailable":
      return (
        <AccountWithoutProfile
          email={state.email}
          locale={locale}
          passkeys={state.passkeys}
        >
          <UnavailableCard locale={locale} />
        </AccountWithoutProfile>
      );
    case "completion-required":
      return (
        <AccountWithoutProfile
          email={state.email}
          locale={locale}
          passkeys={state.passkeys}
        >
          <CompletionCard
            email={state.email}
            locale={locale}
            referralCode={state.referralCode}
            referralsEnabled={state.referralsEnabled}
          />
        </AccountWithoutProfile>
      );
    case "support-required":
      return (
        <AccountWithoutProfile
          email={state.email}
          locale={locale}
          passkeys={state.passkeys}
        >
          <SupportRequiredCard locale={locale} />
        </AccountWithoutProfile>
      );
    case "deletion-pending":
      return (
        <AccountWithoutProfile
          deletionPending
          email={state.email}
          locale={locale}
          passkeys={state.passkeys}
        />
      );
  }
}

function UnavailableCard({ locale }: { readonly locale: Locale }) {
  return (
    <Card className="mx-auto max-w-xl p-8 text-center">
      <h2 className="text-3xl text-navy-blue">
        {m.accountUnavailableTitle({}, { locale })}
      </h2>
      <p className="mt-4 leading-7 text-navy-blue/68">
        {m.accountUnavailableDescription({}, { locale })}
      </p>
    </Card>
  );
}

function CompletionCard({
  email,
  locale,
  referralCode,
  referralsEnabled,
}: {
  readonly email: string;
  readonly locale: Locale;
  readonly referralCode?: ReferralCode;
  readonly referralsEnabled: boolean;
}) {
  return (
    <Card className={`mx-auto max-w-2xl ${cardClassName}`}>
      <CardContent className="p-6 @xl:p-10">
        <h2 className="text-3xl text-navy-blue @xl:text-4xl">
          {m.accountCompletionTitle({}, { locale })}
        </h2>
        <p className="mt-3 text-sm leading-6 text-navy-blue/68">
          {m.accountCompletionBody({}, { locale })}
        </p>
        <div className="mt-8">
          <ProfileForm
            email={email}
            locale={locale}
            mode="complete"
            referralCode={referralCode}
            referralsEnabled={referralsEnabled}
          />
        </div>
      </CardContent>
    </Card>
  );
}

function SupportRequiredCard({ locale }: { readonly locale: Locale }) {
  return (
    <Card className={`mx-auto max-w-2xl ${cardClassName}`}>
      <CardContent className="p-6 text-center @xl:p-10">
        <h2 className="text-3xl text-navy-blue @xl:text-4xl">
          {m.accountSupportTitle({}, { locale })}
        </h2>
        <p className="mt-4 leading-7 text-navy-blue/68">
          <Interpolate
            string={m.accountSupportContact({}, { locale })}
            mapping={{
              contact: (label) => (
                <Link
                  href={`/${locale}/contact`}
                  className="text-burned-orange underline underline-offset-4"
                >
                  {label}
                </Link>
              ),
            }}
          />
        </p>
      </CardContent>
    </Card>
  );
}
