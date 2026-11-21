import { Gift, KeyRound } from "lucide-react";
import type { AccountUnlimitedPass } from "@/features/account/account-unlimited-passes.server";
import { type Locale, m } from "@/features/i18n";
import { UnlimitedDayMeter } from "@/features/passes/components/unlimited-day-meter";
import { unlimitedPassDays } from "@/features/passes/pass-offer";
import { GuardedLink } from "@/shared/components/guarded-link";
import { Button } from "@/shared/components/ui/button";
import { StatusBadge } from "@/shared/components/ui/status-badge";
import { formatCount } from "@/shared/utils/number";

type PassProps = {
  readonly pass: AccountUnlimitedPass;
  readonly locale: Locale;
};

function getPeriodStatus({ pass, locale }: PassProps) {
  switch (pass.status) {
    case "active":
      return m.unlimitedAccessDay(
        {
          day: formatCount(pass.day, locale),
          total: formatCount(unlimitedPassDays, locale),
        },
        { locale }
      );
    case "upcoming":
      return m.unlimitedAccessStarts({ date: pass.startsOn }, { locale });
    case "expired":
      return m.accountPassExpired({}, { locale });
    case "ended":
      return m.accountPassEnded({}, { locale });
  }
}

function UnlimitedDoorCodeLink({
  href,
  locale,
}: {
  readonly href: string;
  readonly locale: Locale;
}) {
  return (
    <Button asChild size="sm" wrap>
      <a href={href}>
        <KeyRound aria-hidden="true" className="size-4 shrink-0" />
        {m.unlimitedAccessTodayTitle({}, { locale })}
      </a>
    </Button>
  );
}

export function UnlimitedReservationItem({ pass, locale }: PassProps) {
  return (
    <li className="grid min-w-0 gap-x-5 gap-y-3 rounded-2xl border border-aquamarine-green/45 bg-aquamarine-green/8 p-4 @2xl:grid-cols-[10rem_minmax(0,1fr)_auto] @2xl:items-center">
      <div className="flex flex-wrap items-baseline gap-x-2 @2xl:block">
        <p className="font-bold">{getPeriodStatus({ pass, locale })}</p>
        <p className="text-sm text-slate-600">{pass.period}</p>
      </div>
      <div className="min-w-0">
        <p className="text-xs font-bold uppercase tracking-wider text-aquamarine-ink">
          {m.passUnlimited({}, { locale })}
        </p>
        <h3 className="break-words font-semibold">{pass.tier}</h3>
        {pass.status === "active" && (
          <div className="mt-1 space-y-2">
            <p className="text-sm text-slate-600">
              {m.accountUnlimitedPassDaysLeft(
                { count: pass.daysLeft },
                { locale }
              )}
            </p>
            <UnlimitedDayMeter day={pass.day} />
          </div>
        )}
      </div>
      {pass.status === "active" && (
        <UnlimitedDoorCodeLink href={pass.accessPath} locale={locale} />
      )}
    </li>
  );
}

export function AccountUnlimitedPassCard({ pass, locale }: PassProps) {
  const desk =
    pass.seating.kind === "shared"
      ? m.accountUnlimitedPassAnyDesk({}, { locale })
      : pass.seating.name;

  return (
    <article className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
      <div className="space-y-4 p-5 @xl:p-6">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-xs font-bold uppercase tracking-wider text-aquamarine-ink">
              {m.passUnlimited({}, { locale })}
            </p>
            <h4 className="break-words text-xl font-semibold">{pass.tier}</h4>
          </div>
          <StatusBadge
            tone={
              (
                {
                  active: "positive",
                  upcoming: "progress",
                  expired: "neutral",
                  ended: "neutral",
                } as const
              )[pass.status]
            }
          >
            {getPeriodStatus({ pass, locale })}
          </StatusBadge>
        </div>
        {pass.status === "active" && (
          <div className="space-y-3">
            <p className="font-semibold">
              {m.accountUnlimitedPassDaysLeft(
                { count: pass.daysLeft },
                { locale }
              )}
            </p>
            <UnlimitedDayMeter day={pass.day} />
          </div>
        )}
        <dl className="grid gap-4 border-t border-slate-200 pt-4 @xl:grid-cols-2">
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wider text-slate-600">
              {m.accountUnlimitedPassPeriod({}, { locale })}
            </dt>
            <dd className="mt-1 text-sm font-semibold">{pass.period}</dd>
          </div>
          {desk && (
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wider text-slate-600">
                {pass.seating.kind === "shared"
                  ? m.accountUnlimitedPassWhere({}, { locale })
                  : m.unlimitedAccessDesk({}, { locale })}
              </dt>
              <dd className="mt-1 break-words text-sm font-semibold">{desk}</dd>
            </div>
          )}
        </dl>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-slate-50 px-5 py-3 @xl:px-6">
        <div className="space-y-1">
          {pass.boughtForYou && (
            <p className="flex items-center gap-2 text-sm font-semibold">
              <Gift aria-hidden="true" className="size-4 shrink-0" />
              {m.accountPassBoughtForYou({}, { locale })}
            </p>
          )}
          <p className="text-sm text-slate-600">
            {m.accountPassBoughtOn({ date: pass.boughtOn }, { locale })}
          </p>
        </div>
        {(pass.renewalPath || pass.status === "active") && (
          <div className="flex flex-wrap items-center gap-2">
            {pass.renewalPath && (
              <Button asChild size="sm" variant="secondary" wrap>
                <GuardedLink href={pass.renewalPath}>
                  {m.unlimitedPassRenew({}, { locale })}
                </GuardedLink>
              </Button>
            )}
            {pass.status === "active" && (
              <UnlimitedDoorCodeLink href={pass.accessPath} locale={locale} />
            )}
          </div>
        )}
      </div>
    </article>
  );
}
