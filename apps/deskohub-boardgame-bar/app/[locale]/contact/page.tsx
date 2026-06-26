import {
  ContactForm,
  type ContactFormInitialValues,
  ContactHero,
  ContactInfo,
  ContactMap,
} from "@/features/contact";
import { type Locale, m, setLocale } from "@/features/i18n";
import { siteConstants } from "@/shared/utils/constants";
import { metadata } from "@/shared/utils/metadata";

type SearchParamsRecord = Record<string, string | string[] | undefined>;

type ContactPageProps = {
  params: Promise<{ locale: Locale }>;
  searchParams: Promise<SearchParamsRecord>;
};

const getPrefillValue = (
  searchParams: SearchParamsRecord,
  key: keyof ContactFormInitialValues,
  maxLength: number
) => {
  const value = searchParams[key];
  const rawValue = Array.isArray(value) ? value[0] : value;

  return rawValue?.slice(0, maxLength) ?? "";
};

const getContactInitialValues = (
  searchParams: SearchParamsRecord
): ContactFormInitialValues => ({
  name: getPrefillValue(searchParams, "name", 100),
  email: getPrefillValue(searchParams, "email", 255),
  phone: getPrefillValue(searchParams, "phone", 20),
  message: getPrefillValue(searchParams, "message", 1000),
});

export const generateMetadata = metadata({
  title: m["contact.pageTitle"](),
  description: m["contact.pageDescription"](),
});

export default async function ContactPage({
  params,
  searchParams,
}: ContactPageProps) {
  const { locale } = await params;
  setLocale(locale, { reload: false });
  const contactFormEnabled = siteConstants.featureFlags.contactForm;
  const initialValues = getContactInitialValues(await searchParams);

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
          {contactFormEnabled && <ContactForm initialValues={initialValues} />}
        </div>

        <ContactMap />
      </div>
    </div>
  );
}
