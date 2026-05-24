import { Suspense } from "react";
import type { Locale } from "@/features/i18n";
import { m } from "@/features/i18n";
import { Container } from "@/shared/components/container";
import { ReservationForm } from "./reservation-form";

type ReservationPageProps = {
  locale: Locale;
};

export function ReservationPage({ locale }: ReservationPageProps) {
  return (
    <main className="min-h-screen overflow-x-clip bg-navy-blue text-white">
      <section className="relative isolate overflow-hidden pb-20 pt-28 sm:pb-24 sm:pt-36">
        <div className="absolute left-1/2 top-24 -z-10 h-72 w-3xl -translate-x-1/2 rotate-[-8deg] rounded-full bg-burned-orange/16 blur-3xl" />

        <Container>
          <div className="grid gap-10 lg:grid-cols-[0.9fr_1.1fr] lg:items-start">
            <div className="pt-4 lg:sticky lg:top-28">
              <div className="inline-flex rounded-full border border-white/12 bg-white/6 px-4 py-2 text-[0.72rem] uppercase tracking-[0.18em] text-sunset-yellow">
                {m.reservationHeroEyebrow({}, { locale })}
              </div>
              <h1 className="mt-6 text-balance text-5xl leading-none sm:text-6xl lg:text-7xl">
                {m.reservationHeroTitle({}, { locale })}
              </h1>
              <p className="mt-6 max-w-xl text-lg leading-8 text-white/72">
                {m.reservationHeroLead({}, { locale })}
              </p>

              <div className="mt-10 grid gap-3 text-sm leading-6 text-white/72 sm:grid-cols-3 lg:grid-cols-1">
                <div className="rounded-[1.4rem] border border-white/10 bg-white/7 p-4 backdrop-blur-sm">
                  <strong className="block text-sunset-yellow">
                    {m.reservationHeroPointOneTitle({}, { locale })}
                  </strong>
                  {m.reservationHeroPointOneText({}, { locale })}
                </div>
                <div className="rounded-[1.4rem] border border-white/10 bg-white/7 p-4 backdrop-blur-sm">
                  <strong className="block text-aquamarine-green">
                    {m.reservationHeroPointTwoTitle({}, { locale })}
                  </strong>
                  {m.reservationHeroPointTwoText({}, { locale })}
                </div>
                <div className="rounded-[1.4rem] border border-white/10 bg-white/7 p-4 backdrop-blur-sm">
                  <strong className="block text-white">
                    {m.reservationHeroPointThreeTitle({}, { locale })}
                  </strong>
                  {m.reservationHeroPointThreeText({}, { locale })}
                </div>
              </div>
            </div>

            <Suspense>
              <ReservationForm locale={locale} />
            </Suspense>
          </div>
        </Container>
      </section>
    </main>
  );
}
