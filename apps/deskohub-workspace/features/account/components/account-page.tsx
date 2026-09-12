import Interpolate from "@doist/react-interpolate";
import Link from "next/link";
import { AccountSignInRedirect } from "@/features/account/components/account-sign-in-redirect";
import { DeleteAccountCard } from "@/features/account/components/delete-account-card";
import { LinkedAccount } from "@/features/account/components/linked-account";
import { ProfileForm } from "@/features/account/components/profile-form";
import { SessionRefresh } from "@/features/account/components/session-refresh";
import type { CustomerAccountPageState } from "@/features/account/page-data.server";
import { type Locale, m } from "@/features/i18n";
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
        <LinkedAccount
          email={state.email}
          history={state.history}
          locale={locale}
          profile={state.profile}
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
        <div className="grid items-start gap-6">
          <UnavailableCard locale={locale} />
          <DeleteAccountCard
            email={state.email}
            locale={locale}
            deletionPending={false}
          />
        </div>
      );
    case "completion-required":
      return <CompletionCard email={state.email} locale={locale} />;
    case "support-required":
      return <SupportRequiredCard email={state.email} locale={locale} />;
    case "deletion-pending":
      return (
        <div className="grid items-start gap-6">
          <DeleteAccountCard
            email={state.email}
            locale={locale}
            deletionPending
          />
        </div>
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
}: {
  readonly email: string;
  readonly locale: Locale;
}) {
  return (
    <div className="grid items-start gap-6">
      <Card className={`mx-auto max-w-2xl ${cardClassName}`}>
        <CardContent className="p-6 sm:p-10">
          <h2 className="text-3xl text-navy-blue sm:text-4xl">
            {m.accountCompletionTitle({}, { locale })}
          </h2>
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
          <h2 className="text-3xl text-navy-blue sm:text-4xl">
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
      <DeleteAccountCard
        email={email}
        locale={locale}
        deletionPending={false}
      />
    </div>
  );
}
