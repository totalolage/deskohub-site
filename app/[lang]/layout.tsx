import { locales, setLocale } from "@/src/paraglide/runtime";
import { PropsWithParams } from "./route";
import { m } from "@/i18n";
import { PropsWithChildren } from "react";

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

export default function LangLayout({ children }: Readonly<PropsWithChildren>) {
  return { children };
}
