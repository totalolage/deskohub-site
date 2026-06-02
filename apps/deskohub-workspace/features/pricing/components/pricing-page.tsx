import Link from "next/link";
import type { Locale } from "@/features/i18n";
import { m } from "@/features/i18n";
import {
  getPricingContent,
  type PricingTariff,
} from "@/features/pricing/content";
import { Container } from "@/shared/components/container";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/shared/components/ui/card";

type PricingPageProps = {
  locale: Locale;
};

export function PricingPage({ locale }: PricingPageProps) {
  const content = getPricingContent(locale);

  return (
    <main className="bg-[#f4f1ea] pb-20 pt-16 sm:pb-24 mt-(--site-header-height)">
      <Container className="space-y-10">
        <section className="grid gap-6 lg:grid-cols-[1.15fr_0.85fr] lg:items-start">
          <div className="space-y-6">
            <div className="space-y-3">
              <h2 className="text-3xl leading-tight sm:text-4xl">
                {content.document.coworkingTitle}
              </h2>
              <p className="max-w-3xl text-base leading-8 text-navy-blue/72">
                {content.document.coworkingLead}
              </p>
            </div>

            <div className="grid gap-5">
              {content.tariffs.map((tariff) => (
                <TariffCard
                  key={tariff.id}
                  includesLabel={content.document.tariffIncludesLabel}
                  tariff={tariff}
                  locale={locale}
                />
              ))}
            </div>
          </div>

          <div className="space-y-5">
            <Card className="rounded-[1.9rem] border-white/20 bg-white shadow-[0_24px_70px_-46px_rgba(0,2,79,0.35)]">
              <CardHeader>
                <CardTitle>{content.document.importantInfoTitle}</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-3 text-sm leading-7 text-navy-blue/78">
                  {content.importantInfo.map((item) => (
                    <li key={item} className="flex gap-3">
                      <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-burned-orange" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>

            <Card className="rounded-[1.9rem] border-white/10 bg-navy-blue text-white shadow-[0_30px_80px_-48px_rgba(0,2,79,0.78)]">
              <CardHeader>
                <CardTitle className="text-white">
                  {content.document.eventRentalTitle}
                </CardTitle>
                <CardDescription className="text-base leading-8 text-white/72">
                  {content.document.eventRentalLead}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                <p className="text-2xl text-sunset-yellow">
                  {content.eventPricing.price}
                </p>
                <ul className="space-y-3 text-sm leading-7 text-white/80">
                  {content.document.eventRentalCriteria.map((item) => (
                    <li key={item} className="flex gap-3">
                      <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-sunset-yellow" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
                <p className="text-sm leading-7 text-white/72">
                  {content.document.eventRentalContact}
                </p>
                <Link
                  href={`/${locale}/contact`}
                  className="inline-flex h-11 items-center justify-center rounded-full bg-white px-5 text-sm uppercase tracking-[0.08em] text-navy-blue transition-colors hover:bg-sunset-yellow"
                >
                  {m.landingFooterContactCta({}, { locale })}
                </Link>
              </CardContent>
            </Card>
          </div>
        </section>
      </Container>
    </main>
  );
}

type TariffCardProps = {
  includesLabel: string;
  tariff: PricingTariff;
  locale: Locale;
};

function TariffCard({ includesLabel, tariff, locale }: TariffCardProps) {
  const reservationHref = `/${locale}/checkout/order?tier=${tariff.reservationTier}`;

  return (
    <Link href={reservationHref} className="group block rounded-[1.9rem]">
      <Card className="h-full rounded-[1.9rem] border-white/20 bg-white shadow-[0_24px_70px_-46px_rgba(0,2,79,0.35)] transition duration-200 group-hover:-translate-y-0.5 group-hover:border-burned-orange/35 group-hover:shadow-[0_30px_80px_-46px_rgba(221,72,10,0.4)] group-focus-visible:outline group-focus-visible:outline-offset-4 group-focus-visible:outline-burned-orange">
        <CardHeader>
          <CardTitle>{tariff.name}</CardTitle>
          <CardDescription className="text-2xl text-burned-orange">
            {tariff.price}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <p className="text-sm leading-7 text-navy-blue/78">
            {tariff.description}
          </p>
          <div className="space-y-3">
            <p className="text-sm font-semibold uppercase tracking-[0.08em] text-navy-blue/68">
              {includesLabel}
            </p>
            <ul className="space-y-3 text-sm leading-7 text-navy-blue/78">
              {tariff.includes.map((item) => (
                <li key={item} className="flex gap-3">
                  <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-burned-orange" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
