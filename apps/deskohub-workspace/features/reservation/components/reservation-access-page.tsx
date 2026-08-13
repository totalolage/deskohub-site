import { KeyRound } from "lucide-react";
import { CheckoutFlowLayout } from "@/features/checkout/components/checkout-flow-layout";
import type { Locale } from "@/features/i18n";
import { m } from "@/features/i18n";
import type { ReservationAccessViewModel } from "@/features/reservation/backend/reservation-access.service";
import { formatReservationDisplayDateTime } from "@/features/reservation/reservation-date";

type ReservationAccessPageProps = {
  readonly access: ReservationAccessViewModel;
  readonly locale: Locale;
};

export function ReservationAccessPage({
  access,
  locale,
}: ReservationAccessPageProps) {
  const title = {
    available: m.reservationAccessTitle({}, { locale }),
    unavailable: m.reservationAccessUnavailableTitle({}, { locale }),
  }[access.state];

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
                {title}
              </h1>
              {access.state === "unavailable" && (
                <p className="mt-5 text-lg leading-8 text-navy-blue/70">
                  {m.reservationAccessUnavailableLead({}, { locale })}
                </p>
              )}
            </div>
          </div>

          {access.state === "available" && (
            <div className="mt-10 sm:mt-12">
              <output
                aria-label={Array.from(access.code).join(" ")}
                className="flex flex-wrap justify-center gap-[clamp(0.25rem,1.5vw,0.75rem)]"
                data-ph-mask=""
                data-ph-no-capture=""
                data-reservation-access-code=""
              >
                {Array.from(access.code).map((character, index) => (
                  <span
                    aria-hidden="true"
                    className="grid h-[clamp(3.75rem,16vw,5.75rem)] w-[clamp(1.5rem,7.5vw,4rem)] place-items-center rounded-xl bg-navy-blue/5 font-mono text-[clamp(1.35rem,6vw,2.6rem)] font-medium tabular-nums text-navy-blue"
                    key={`${index}-${character}`}
                  >
                    {character}
                  </span>
                ))}
              </output>

              <p className="mt-10 text-center font-mono text-sm text-navy-blue/60 sm:mt-14">
                {m.reservationAccessLead(
                  {
                    startsAt: formatReservationDisplayDateTime(
                      access.accessStartsAt,
                      locale
                    ),
                    endsAt: formatReservationDisplayDateTime(
                      access.accessEndsAt,
                      locale
                    ),
                  },
                  { locale }
                )}
              </p>
            </div>
          )}
        </div>
      </section>
    </CheckoutFlowLayout>
  );
}
