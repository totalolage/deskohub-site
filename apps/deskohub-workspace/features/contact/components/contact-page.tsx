import type { Locale } from "@/features/i18n";
import { m } from "@/features/i18n";
import { Container } from "@/shared/components/container";
import { ContactForm, type ContactFormInitialValues } from "./contact-form";

type ContactPageProps = {
  locale: Locale;
  initialValues?: ContactFormInitialValues;
};

export function ContactPage({ locale, initialValues }: ContactPageProps) {
  return (
    <main className="min-h-screen overflow-x-clip bg-navy-blue text-white">
      <section className="relative isolate overflow-hidden pb-20 pt-28 sm:pb-24 sm:pt-36">
        <div className="absolute inset-x-0 top-16 -z-10 h-56 bg-[radial-gradient(circle,rgba(221,72,10,0.18),transparent_60%)] blur-3xl" />

        <Container>
          <div className="mx-auto max-w-3xl text-center">
            <div className="inline-flex rounded-full border border-white/12 bg-white/6 px-4 py-2 text-[0.72rem] uppercase tracking-[0.18em] text-sunset-yellow">
              {m.contactHeroEyebrow({}, { locale })}
            </div>
            <h1 className="mt-6 text-balance text-5xl leading-none sm:text-6xl">
              {m.contactHeroTitle({}, { locale })}
            </h1>
            <p className="mx-auto mt-6 max-w-2xl text-lg leading-8 text-white/72">
              {m.contactHeroLead({}, { locale })}
            </p>
          </div>

          <div className="mx-auto mt-14 max-w-3xl">
            <ContactForm locale={locale} initialValues={initialValues} />
          </div>
        </Container>
      </section>
    </main>
  );
}
