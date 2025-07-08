import { LanguageHtmlUpdater } from "@/components/language-html-updater";
import { locales, setLocale } from "@/src/paraglide/runtime";
import { PropsWithChildren } from "react";
import { PropsWithParams } from "./route";
import { m } from "@/i18n";

export async function generateStaticParams() {
  return locales.map((lang) => ({ lang }));
}

export async function generateMetadata({ params }: Readonly<PropsWithParams>) {
  const { lang } = await params;
  setLocale(lang, { reload: false });

  return {
    title: m["metadata.title"](),
    description: m["metadata.description"](),
    generator: "v0.dev",
  };
}

export default async function LangLayout({
  children,
}: Readonly<PropsWithChildren>) {
  return (
    <>
      <LanguageHtmlUpdater />
      {children}
    </>
  );
}
