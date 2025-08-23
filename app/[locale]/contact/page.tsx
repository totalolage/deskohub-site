import {
  ContactForm,
  ContactHero,
  ContactInfo,
  ContactMap,
} from "@/features/contact";
import { m, setLocale } from "@/i18n";
import { contactFormFlag } from "@/shared/lib/feature-flags";
import { metadata } from "@/shared/utils/metadata";
import type { RouteProps_locale } from "../route";

export const generateMetadata = metadata({
  title: m["contact.pageTitle"](),
  description: m["contact.pageDescription"](),
});

export default async function ContactPage({ params }: RouteProps_locale) {
  const { locale } = await params;
  setLocale(locale, { reload: false });
  const contactFormEnabled = await contactFormFlag();

  return (
    <div className="min-h-screen bg-black">
      <ContactHero />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <div
          className={
            contactFormEnabled ? "grid grid-cols-1 lg:grid-cols-2 gap-12" : ""
          }
        >
          <ContactInfo />
          {contactFormEnabled && <ContactForm />}
        </div>

        <ContactMap />
      </div>
    </div>
  );
}
