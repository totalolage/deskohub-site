import Interpolate from "@doist/react-interpolate";
import { UserRound } from "lucide-react";
import Link from "next/link";
import { DeleteAccountCard } from "@/features/account/components/delete-account-card";
import { ProfileForm } from "@/features/account/components/profile-form";
import { ReservationHistory } from "@/features/account/components/reservation-history";
import { SessionRefresh } from "@/features/account/components/session-refresh";
import { SignOutButton } from "@/features/account/components/sign-out-button";
import type { CustomerAccountPageState } from "@/features/account/page-data.server";
import { type Locale, m } from "@/features/i18n";
import { Card, CardContent } from "@/shared/components/ui/card";

const pageShellClassName =
  "relative min-h-screen overflow-hidden bg-[#f4f3ef] px-4 pb-24 pt-[calc(var(--site-header-height)+3rem)] sm:px-6 lg:pt-[calc(var(--site-header-height)+4.5rem)]";
const pageBackdropClassName =
  "pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_8%_8%,rgba(236,164,35,0.19),transparent_31%),radial-gradient(circle_at_92%_40%,rgba(0,223,153,0.11),transparent_28%)]";
const cardClassName =
  "rounded-3xl border-white/70 bg-white/92 shadow-[0_26px_80px_-48px_rgba(0,2,79,0.55)]";

export function AccountPage({
  locale,
  state,
}: {
  readonly locale: Locale;
  readonly state: CustomerAccountPageState;
}) {
  return (
    <main className={pageShellClassName}>
      <div className={pageBackdropClassName} />
      <div className="relative mx-auto max-w-6xl">
        {state.kind !== "unavailable" && <SessionRefresh />}
        {renderState(locale, state)}
      </div>
    </main>
  );
}

function renderState(
  locale: Locale,
  state: CustomerAccountPageState
): React.ReactNode {
  switch (state.kind) {
    case "unavailable":
      return <UnavailableCard locale={locale} />;
    case "completion-required":
      return <CompletionCard email={state.email} locale={locale} />;
    case "support-required":
      return <SupportRequiredCard email={state.email} locale={locale} />;
    case "deletion-pending":
      return (
        <div className="grid items-start gap-6">
          <LinkedAccountHeader
            locale={locale}
            title={m.accountTitle({}, { locale })}
          />
          <DeleteAccountCard
            email={state.email}
            locale={locale}
            deletionPending
          />
        </div>
      );
    case "linked":
      return (
        <div className="grid items-start gap-6">
          <LinkedAccountHeader
            locale={locale}
            title={m.accountTitle({}, { locale })}
          />
          <div className="grid items-start gap-6 lg:grid-cols-[minmax(17rem,0.72fr)_minmax(0,1.28fr)]">
            <Card className={cardClassName}>
              <CardContent className="p-6 sm:p-8">
                <h2 className="text-2xl text-navy-blue">
                  {m.accountProfileTitle({}, { locale })}
                </h2>
                <p className="mb-6 mt-2 text-sm leading-6 text-navy-blue/68">
                  {m.accountProfileDescription({}, { locale })}
                </p>
                <ProfileForm
                  mode="edit"
                  locale={locale}
                  email={state.email}
                  profile={state.profile}
                />
              </CardContent>
            </Card>
            <ReservationHistory locale={locale} history={state.history} />
          </div>
          <DeleteAccountCard
            email={state.email}
            locale={locale}
            deletionPending={false}
          />
        </div>
      );
  }
}

function LinkedAccountHeader({
  locale,
  title,
}: {
  readonly locale: Locale;
  readonly title: string;
}) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-6">
      <div className="max-w-2xl">
        <h1 className="text-4xl text-navy-blue sm:text-5xl">{title}</h1>
      </div>
      <SignOutButton locale={locale} />
    </header>
  );
}

function UnavailableCard({ locale }: { readonly locale: Locale }) {
  return (
    <Card className="mx-auto max-w-xl p-8 text-center">
      <h1 className="text-3xl text-navy-blue">
        {m.accountUnavailableTitle({}, { locale })}
      </h1>
      <p className="mt-4 leading-7 text-navy-blue/68">
        {m.accountUnavailableDescription({}, { locale })}
      </p>
    </Card>
  );
}

function CompletionCard({
  email,
  locale,
}: {
  readonly email: string;
  readonly locale: Locale;
}) {
  return (
    <div className="grid items-start gap-6">
      <Card className={`mx-auto max-w-2xl ${cardClassName}`}>
        <CardContent className="p-6 sm:p-10">
          <p className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-burned-orange">
            <UserRound aria-hidden className="size-4" />
            {m.accountTitle({}, { locale })}
          </p>
          <h1 className="mt-3 text-3xl text-navy-blue sm:text-4xl">
            {m.accountCompletionTitle({}, { locale })}
          </h1>
          <p className="mt-3 text-sm leading-6 text-navy-blue/68">
            {m.accountCompletionBody({}, { locale })}
          </p>
          <div className="mt-8">
            <ProfileForm mode="complete" locale={locale} email={email} />
          </div>
        </CardContent>
      </Card>
      <DeleteAccountCard
        email={email}
        locale={locale}
        deletionPending={false}
      />
    </div>
  );
}

function SupportRequiredCard({
  email,
  locale,
}: {
  readonly email: string;
  readonly locale: Locale;
}) {
  return (
    <div className="grid items-start gap-6">
      <Card className={`mx-auto max-w-2xl ${cardClassName}`}>
        <CardContent className="p-6 text-center sm:p-10">
          <h1 className="text-3xl text-navy-blue sm:text-4xl">
            {m.accountSupportTitle({}, { locale })}
          </h1>
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
          <div className="mt-8 flex justify-center">
            <SignOutButton locale={locale} />
          </div>
        </CardContent>
      </Card>
      <DeleteAccountCard
        email={email}
        locale={locale}
        deletionPending={false}
      />
    </div>
  );
}
