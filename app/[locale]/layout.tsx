import { cache, type PropsWithChildren } from "react";
import {
  assertIsLocale,
  baseLocale,
  locales,
  m,
  overwriteGetLocale,
  setLocale,
} from "@/i18n";
import RootLayout from "../rootLayout";
import type { RouteProps_locale } from "./route";

export async function generateStaticParams() {
  return locales.map((locale) => ({ locale }));
}

export async function generateMetadata({
  params,
}: Readonly<RouteProps_locale>) {
  const { locale } = await params;
  setLocale(locale, { reload: false });

  return {
    title: m["metadata.title"](),
    description: m["metadata.description"](),
    generator: "v0.dev",
  };
}

// scopes the locale per request
const ssrLocale = cache(() => ({
  locale: baseLocale,
}));

// overwrite the getLocale function to use the locale from the request
overwriteGetLocale(() => assertIsLocale(ssrLocale().locale));

export default async function LocaleLayout({
  children,
  params,
}: Readonly<PropsWithChildren<RouteProps_locale>>) {
  ssrLocale().locale = (await params).locale;

  return <RootLayout>{children}</RootLayout>;
}
