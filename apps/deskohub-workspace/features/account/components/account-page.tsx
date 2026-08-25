import { LogOut, UserRound } from "lucide-react";
import Link from "next/link";
import { type Locale, m } from "@/features/i18n";
import { Button } from "@/shared/components/ui/button";
import type { CustomerReservationHistory } from "../contracts";
import { DeleteAccountCard } from "./delete-account-card";
import { ProfileCard } from "./profile-card";
import { ReservationHistory } from "./reservation-history";

export function AccountPage({
  history,
  locale,
  profile,
}: {
  readonly history: CustomerReservationHistory;
  readonly locale: Locale;
  readonly profile: { readonly email: string; readonly name: string };
}) {
  return (
    <main className="relative min-h-screen overflow-hidden bg-[#f4f3ef] px-4 pb-24 pt-[calc(var(--site-header-height)+3rem)] sm:px-6 lg:pt-[calc(var(--site-header-height)+4.5rem)]">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_8%_8%,rgba(236,164,35,0.19),transparent_31%),radial-gradient(circle_at_92%_40%,rgba(0,223,153,0.11),transparent_28%)]" />
      <div className="relative mx-auto max-w-6xl">
        <header className="mb-10 flex flex-col justify-between gap-6 md:flex-row md:items-end">
          <div className="max-w-2xl">
            <p className="mb-3 inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-burned-orange">
              <UserRound aria-hidden className="size-4" />
              {m.accountEyebrow({}, { locale })}
            </p>
            <h1 className="text-4xl text-navy-blue sm:text-5xl">
              {m.accountTitle({}, { locale })}
            </h1>
            <p className="mt-4 text-base leading-7 text-navy-blue/68">
              {m.accountDescription({}, { locale })}
            </p>
          </div>
          <Button asChild variant="secondary">
            <Link href={`/${locale}/auth/sign-out`} prefetch={false}>
              <LogOut aria-hidden className="size-4" />
              {m.accountSignOut({}, { locale })}
            </Link>
          </Button>
        </header>

        <div className="grid items-start gap-6 lg:grid-cols-[minmax(17rem,0.72fr)_minmax(0,1.28fr)]">
          <ProfileCard locale={locale} {...profile} />
          <ReservationHistory locale={locale} history={history} />
        </div>

        <div className="mt-6">
          <DeleteAccountCard locale={locale} />
        </div>
      </div>
    </main>
  );
}

export function AccountUnavailable({ locale }: { readonly locale: Locale }) {
  return (
    <main className="min-h-[calc(100vh-var(--site-header-height))] bg-[#f4f3ef] px-4 pb-20 pt-[calc(var(--site-header-height)+4rem)] sm:px-6">
      <div className="mx-auto max-w-xl rounded-3xl border border-sunset-yellow/25 bg-white p-8 text-center shadow-sm">
        <h1 className="text-3xl text-navy-blue">
          {m.accountUnavailableTitle({}, { locale })}
        </h1>
        <p className="mt-4 leading-7 text-navy-blue/68">
          {m.accountUnavailableDescription({}, { locale })}
        </p>
      </div>
    </main>
  );
}
