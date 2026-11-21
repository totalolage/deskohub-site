import { ArrowLeft, KeyRound } from "lucide-react";
import Link from "next/link";
import { getAccountSectionPath } from "@/features/account/routes";
import { CheckoutFlowLayout } from "@/features/checkout/components/checkout-flow-layout";
import { type Locale, m } from "@/features/i18n";
import type { OrderId } from "@/features/order";
import { Button } from "@/shared/components/ui/button";
import {
  formatInstantTime,
  formatPlainDate,
} from "@/shared/utils/date-time-format";
import { formatCount } from "@/shared/utils/number";
import { workspaceSiteConstants } from "@/shared/utils/site-constants";
import { unlimitedPassDays } from "../pass-offer";
import { getPassTierName } from "../pass-offer.i18n";
import { getUnlimitedAccessPath, getUnlimitedRenewalPath } from "../routes";
import type { UnlimitedAccessView } from "../unlimited-access";
import { CopyUnlimitedAccessCode } from "./copy-unlimited-access-code";
import { UnlimitedDayMeter } from "./unlimited-day-meter";

export function UnlimitedAccessPage({
  access,
  locale,
  orderId,
}: {
  readonly access: UnlimitedAccessView;
  readonly locale: Locale;
  readonly orderId: OrderId;
}) {
  const { title, detail } = getAccessCopy(access, locale);

  return (
    <CheckoutFlowLayout activeStepKey="complete" locale={locale} steps={false}>
      <div className="mx-auto w-full max-w-2xl">
        <Link
          className="inline-flex items-center gap-2 text-sm font-semibold text-white/75 hover:text-white"
          href={getAccountSectionPath(locale, "passes")}
        >
          <ArrowLeft aria-hidden="true" className="size-4" />
          {m.accountSectionPasses({}, { locale })}
        </Link>
        <section className="mt-4 overflow-hidden rounded-[2.25rem] border border-white/55 bg-white/94 text-navy-blue shadow-[0_44px_140px_-54px_rgba(0,2,79,0.62)]">
          <div className="p-6 sm:p-10">
            <div className="flex items-center gap-4 sm:gap-6">
              <div className="flex size-13 shrink-0 items-center justify-center rounded-full bg-aquamarine-green/14 text-aquamarine-ink ring-8 ring-aquamarine-green/8 sm:size-16">
                <KeyRound aria-hidden="true" className="size-8 sm:size-9" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-bold uppercase tracking-[0.14em] text-aquamarine-ink">
                  {m.passUnlimited({}, { locale })} ·{" "}
                  {getPassTierName(access.tier, locale)}
                </p>
                <h1 className="mt-2 text-balance text-[1.75rem] leading-none sm:text-5xl">
                  {title}
                </h1>
              </div>
            </div>
            {detail && <p className="mt-5 text-navy-blue/70">{detail}</p>}
            {access.state === "available" && (
              <UnlimitedAccessCode access={access} locale={locale} />
            )}
            {access.state === "retry" && (
              <Button asChild className="mt-6" shape="pill" variant="secondary">
                <a href={getUnlimitedAccessPath(locale, orderId)}>
                  {m.errorPageRetry({}, { locale })}
                </a>
              </Button>
            )}
            {access.state === "ended" && access.renewalOrderId && (
              <Button asChild className="mt-6" shape="pill">
                <Link
                  href={getUnlimitedRenewalPath(locale, access.renewalOrderId)}
                >
                  {m.unlimitedPassRenew({}, { locale })}
                </Link>
              </Button>
            )}
          </div>
          {"day" in access && (
            <div className="flex items-center gap-4 border-t border-navy-blue/10 bg-[#fbfaf7] px-6 py-5 sm:gap-5 sm:px-10">
              {access.state === "available" && access.deskLabel && (
                <div className="shrink-0 rounded-2xl bg-aquamarine-green/10 px-3 py-2 text-center ring-1 ring-aquamarine-green/40 sm:px-4">
                  <p className="text-[0.65rem] font-bold uppercase tracking-[0.14em] text-aquamarine-ink">
                    {m.unlimitedAccessDesk({}, { locale })}
                  </p>
                  <p className="text-2xl leading-9 font-bold">
                    {access.deskLabel}
                  </p>
                </div>
              )}
              <div className="min-w-0 flex-1">
                <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3">
                  <p className="font-semibold">
                    {m.unlimitedAccessDay(
                      {
                        day: formatCount(access.day, locale),
                        total: formatCount(unlimitedPassDays, locale),
                      },
                      { locale }
                    )}
                  </p>
                  <p className="text-sm text-navy-blue/60">
                    {m.unlimitedAccessEnds(
                      {
                        date: formatPlainDate({
                          date: Temporal.PlainDate.from(
                            access.validUntil
                          ).subtract({ days: 1 }),
                          locale,
                        }),
                      },
                      { locale }
                    )}
                  </p>
                </div>
                <UnlimitedDayMeter day={access.day} />
              </div>
            </div>
          )}
        </section>
      </div>
    </CheckoutFlowLayout>
  );
}

function getAccessCopy(access: UnlimitedAccessView, locale: Locale) {
  switch (access.state) {
    case "available":
      return { title: m.unlimitedAccessTodayTitle({}, { locale }) };
    case "before-start":
      return {
        title: m.unlimitedAccessStarts(
          {
            date: formatPlainDate({
              date: Temporal.PlainDate.from(access.validFrom),
              locale,
            }),
          },
          { locale }
        ),
        detail: m.unlimitedAccessBeforeStart({}, { locale }),
      };
    case "closed":
      return {
        title: m.unlimitedAccessClosed({}, { locale }),
        detail: access.continuesTomorrow
          ? m.unlimitedAccessTomorrow({}, { locale })
          : m.unlimitedAccessLastDay({}, { locale }),
      };
    case "ended":
      return { title: m.unlimitedAccessEnded({}, { locale }) };
    case "retry":
      return {
        title: m.reservationAccessUnavailableTitle({}, { locale }),
        detail: m.unlimitedAccessRetry({}, { locale }),
      };
  }
}

function UnlimitedAccessCode({
  access,
  locale,
}: {
  readonly access: Extract<UnlimitedAccessView, { state: "available" }>;
  readonly locale: Locale;
}) {
  const ends =
    access.tier === "open-space"
      ? formatInstantTime({
          instant: access.endsAt,
          locale,
          timeZone: workspaceSiteConstants.location.timeZone,
        })
      : m.unlimitedAccessMidnight({}, { locale });

  return (
    <div className="mt-10 sm:mt-12">
      <div className="text-center">
        <span className="sr-only">{Array.from(access.code).join(" ")}</span>
        <span
          aria-hidden="true"
          className="flex flex-wrap justify-center gap-[clamp(0.25rem,1.2vw,0.6rem)]"
        >
          {Array.from(access.code).map((character, index) => (
            <span
              className="grid h-[clamp(3.5rem,15vw,5.25rem)] w-[clamp(1.6rem,7.4vw,3.5rem)] place-items-center rounded-xl bg-navy-blue/5 font-mono text-[clamp(1.35rem,6vw,2.4rem)] font-medium tabular-nums"
              // biome-ignore lint/suspicious/noArrayIndexKey: PIN digits are positional.
              key={index}
            >
              {character}
            </span>
          ))}
        </span>
      </div>
      <p className="mt-8 text-center text-lg font-semibold">
        {m.unlimitedAccessValidToday(
          {
            date: formatPlainDate({
              date: access.date,
              dateStyle: "full",
              locale,
            }),
            ends,
          },
          { locale }
        )}
      </p>
      <p className="mt-1 text-center text-sm text-navy-blue/60">
        {access.continuesTomorrow
          ? m.unlimitedAccessKeypadDaily({}, { locale })
          : m.unlimitedAccessKeypad({}, { locale })}
      </p>
      <CopyUnlimitedAccessCode code={access.code} locale={locale} />
    </div>
  );
}
