import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ContactPage } from "@/features/contact";
import type { ContactFormInitialValues } from "@/features/contact/components/contact-form";
import { isLocale, locales, m } from "@/features/i18n";
import { runWithRequestLocale } from "@/features/i18n/server/request-locale";
import {
  getSearchParam,
  getWorkspaceLocalizedCanonicalUrl,
  type SearchParamsRecord,
  workspaceSiteConstants,
} from "@/shared/utils";

type LocalizedWorkspaceContactPageProps = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<SearchParamsRecord>;
};

const getPrefillValue = (
  searchParams: SearchParamsRecord,
  key: keyof ContactFormInitialValues,
  maxLength: number
) => getSearchParam(searchParams, key)?.slice(0, maxLength);

const getContactInitialValues = (
  searchParams: SearchParamsRecord
): ContactFormInitialValues => ({
  name: getPrefillValue(searchParams, "name", 100),
  email: getPrefillValue(searchParams, "email", 255),
  phone: getPrefillValue(searchParams, "phone", 20),
  message: getPrefillValue(searchParams, "message", 1000),
});

export async function generateMetadata({
  params,
}: LocalizedWorkspaceContactPageProps): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  return runWithRequestLocale(locale, () => {
    const title = m.contactMetadataTitle({}, { locale });
    const description = m.contactMetadataDescription({}, { locale });
    const url = getWorkspaceLocalizedCanonicalUrl(locale, "/contact");

    return {
      title,
      description,
      alternates: {
        canonical: url,
        languages: Object.fromEntries(
          locales.map((itemLocale) => [
            itemLocale,
            getWorkspaceLocalizedCanonicalUrl(itemLocale, "/contact"),
          ])
        ),
      },
      openGraph: {
        title,
        description,
        url,
        siteName: workspaceSiteConstants.brand.name,
        locale,
        type: "website",
      },
    } satisfies Metadata;
  });
}

export default async function LocalizedWorkspaceContactPage({
  params,
  searchParams,
}: LocalizedWorkspaceContactPageProps) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const initialValues = getContactInitialValues(await searchParams);

  return runWithRequestLocale(locale, () => (
    <ContactPage locale={locale} initialValues={initialValues} />
  ));
}
