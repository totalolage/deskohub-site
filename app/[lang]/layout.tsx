import type { PropsWithChildren } from "react";
import { locales, m, setLocale } from "@/i18n";
import type { PropsWithParams } from "./route";

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
