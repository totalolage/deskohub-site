import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { getLocale, isLocale, type Locale, m } from "@/features/i18n";
import { runWithRequestLocale } from "@/features/i18n/server/request-locale";
import { Container } from "@/shared/components/container";
import { ClientLocaleProbe } from "./client-locale-probe";

type AmbientLocaleTestPageProps = {
  params: Promise<{ locale: string }>;
};

async function getAwaitedServerProbe() {
  await new Promise((resolve) => setTimeout(resolve, 0));

  return {
    locale: getLocale(),
    message: m.languageCzech(),
  };
}

export async function generateMetadata({
  params,
}: AmbientLocaleTestPageProps): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  return runWithRequestLocale(locale, () => ({
    title: `Ambient locale test: ${m.languageEnglish()}`,
  }));
}

async function NestedServerProbe({
  expectedLocale,
}: {
  expectedLocale: Locale;
}) {
  await new Promise((resolve) => setTimeout(resolve, 0));

  const ambientLocale = getLocale();
  const explicitMessage = m.languageCzech({}, { locale: expectedLocale });
  const ambientMessage = m.languageCzech();

  return (
    <section className="rounded-3xl border border-navy-blue/10 bg-white p-6 shadow-sm">
      <h2 className="text-2xl">Nested async server component probe</h2>
      <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
        <dt className="font-semibold">Ambient getLocale()</dt>
        <dd>{ambientLocale}</dd>
        <dt className="font-semibold">Matches route param</dt>
        <dd>{String(ambientLocale === expectedLocale)}</dd>
        <dt className="font-semibold">Explicit message</dt>
        <dd>{explicitMessage}</dd>
        <dt className="font-semibold">Ambient message</dt>
        <dd>{ambientMessage}</dd>
      </dl>
    </section>
  );
}

export default async function AmbientLocaleTestPage({
  params,
}: AmbientLocaleTestPageProps) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  return runWithRequestLocale(locale, () => {
    const ambientLocale = getLocale();
    const explicitMessage = m.landingMetadataTitle({}, { locale });
    const ambientMessage = m.landingMetadataTitle();

    return getAwaitedServerProbe().then((awaitedServerProbe) => (
      <main className="min-h-screen bg-[#f4f1ea] py-20 text-navy-blue">
        <Container>
          <div className="space-y-6">
            <section className="rounded-[2rem] bg-navy-blue p-8 text-white shadow-xl">
              <p className="text-sm font-semibold uppercase tracking-[0.16em] text-sunset-yellow">
                Testing-only route
              </p>
              <h1 className="mt-3 text-4xl leading-none sm:text-5xl">
                Ambient locale experiment
              </h1>
              <p className="mt-4 max-w-3xl text-white/72">
                This route intentionally renders messages both with and without
                explicit locale options while wrapped in runWithRequestLocale.
              </p>
            </section>

            <section className="rounded-3xl border border-navy-blue/10 bg-white p-6 shadow-sm">
              <h2 className="text-2xl">Page server component probe</h2>
              <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
                <dt className="font-semibold">Route param locale</dt>
                <dd>{locale}</dd>
                <dt className="font-semibold">Ambient getLocale()</dt>
                <dd>{ambientLocale}</dd>
                <dt className="font-semibold">Explicit message</dt>
                <dd>{explicitMessage}</dd>
                <dt className="font-semibold">Ambient message</dt>
                <dd>{ambientMessage}</dd>
                <dt className="font-semibold">Awaited helper getLocale()</dt>
                <dd>{awaitedServerProbe.locale}</dd>
                <dt className="font-semibold">
                  Awaited helper ambient message
                </dt>
                <dd>{awaitedServerProbe.message}</dd>
              </dl>
            </section>

            <NestedServerProbe expectedLocale={locale} />
            <Suspense>
              <ClientLocaleProbe expectedLocale={locale} />
            </Suspense>
          </div>
        </Container>
      </main>
    ));
  });
}
