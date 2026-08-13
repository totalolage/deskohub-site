import { Match } from "effect";
import { KeyRound } from "lucide-react";
import { CheckoutFlowLayout } from "@/features/checkout/components/checkout-flow-layout";
import type { Locale } from "@/features/i18n";
import { m } from "@/features/i18n";
import type { ReservationAccessViewModel } from "@/features/reservation/backend/reservation-access.service";
import { formatReservationDisplayDateTime } from "@/features/reservation/reservation-date";
import { ReservationAccessCountdown } from "./reservation-access-countdown";

type ReservationAccessPageProps = {
  readonly access: ReservationAccessViewModel;
  readonly locale: Locale;
};

export function ReservationAccessPage({
  access,
  locale,
}: ReservationAccessPageProps) {
  const copy = Match.value(access).pipe(
    Match.discriminatorsExhaustive("state")({
      upcoming: ({ availableAt }) => ({
        title: m.reservationAccessUpcomingTitle({}, { locale }),
        lead: m.reservationAccessUpcomingLead(
          {
            availableAt: formatReservationDisplayDateTime(availableAt, locale),
          },
          { locale }
        ),
      }),
      available: ({ code, unavailableAt }) => ({
        title: m.reservationAccessAvailableTitle({}, { locale }),
        lead: m.reservationAccessAvailableLead(
          {
            unavailableAt: formatReservationDisplayDateTime(
              unavailableAt,
              locale
            ),
          },
          { locale }
        ),
        code,
      }),
      ended: () => ({
        title: m.reservationAccessEndedTitle({}, { locale }),
        lead: m.reservationAccessEndedLead({}, { locale }),
      }),
      unavailable: () => ({
        title: m.reservationAccessUnavailableTitle({}, { locale }),
        lead: m.reservationAccessUnavailableLead({}, { locale }),
      }),
    })
  );

  return (
    <CheckoutFlowLayout activeStepKey="access" locale={locale}>
      <section
        className="overflow-hidden rounded-[2.25rem] border border-white/55 bg-white/94 text-navy-blue shadow-[0_44px_140px_-54px_rgba(0,2,79,0.62)] backdrop-blur-sm"
        data-reservation-access=""
      >
        <div className="p-6 sm:p-10">
          <div className="flex items-center gap-4 sm:gap-6">
            <div className="flex h-13 w-13 shrink-0 items-center justify-center rounded-full bg-aquamarine-green/14 text-aquamarine-ink ring-8 ring-aquamarine-green/8 sm:h-16 sm:w-16">
              <KeyRound className="h-8 w-8 sm:h-9 sm:w-9" aria-hidden="true" />
            </div>
            <div className="min-w-0 flex-1">
              <h1 className="text-balance text-[1.75rem] leading-none sm:text-5xl">
                {copy.title}
              </h1>
              {access.state !== "upcoming" && (
                <p className="mt-5 text-lg leading-8 text-navy-blue/70">
                  {copy.lead}
                </p>
              )}
            </div>
          </div>

          {access.state === "upcoming" && (
            <>
              <noscript>
                <p className="mt-6 text-center text-lg leading-8 text-navy-blue/70">
                  {copy.lead}
                </p>
              </noscript>
              <ReservationAccessCountdown
                availableAt={access.availableAt.toString()}
                locale={locale}
              />
            </>
          )}
        </div>

        {"code" in copy && copy.code && (
          <div className="border-t border-navy-blue/10 bg-navy-blue px-6 py-8 text-center text-white sm:px-10 sm:py-10">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-aquamarine-green">
              {m.reservationAccessPinLabel({}, { locale })}
            </p>
            <output
              className="mt-3 block font-mono text-5xl font-bold tracking-[0.16em] text-white sm:text-6xl"
              data-ph-mask=""
              data-ph-no-capture=""
              data-reservation-access-code=""
            >
              {copy.code}
            </output>
          </div>
        )}
      </section>
    </CheckoutFlowLayout>
  );
}
