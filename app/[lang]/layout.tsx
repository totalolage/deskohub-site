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
import type { RouteProps_lang } from "./route";

export async function generateStaticParams() {
  return locales.map((lang) => ({ lang }));
}

export async function generateMetadata({ params }: Readonly<RouteProps_lang>) {
  const { lang } = await params;
  setLocale(lang, { reload: false });

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

export default async function LangLayout({
  children,
  params,
}: Readonly<PropsWithChildren<RouteProps_lang>>) {
  ssrLocale().locale = (await params).lang;

  return <RootLayout>{children}</RootLayout>;
}
