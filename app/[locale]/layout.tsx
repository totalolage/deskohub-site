import type { Metadata } from "next";
import type { PropsWithChildren } from "react";
import { locales, setLocale } from "@/i18n";
import { localeAsyncLocalStorage } from "@/i18n/utils/setup-server";
import RootLayout from "../rootLayout";
import type { RouteProps_locale } from "./route";

export async function generateStaticParams() {
  return locales.map((locale) => ({ locale }));
}

export async function generateMetadata(): Promise<Metadata> {
  const origin =
    process.env.NEXT_PUBLIC_BASE_URL ||
    (process.env.NODE_ENV !== "production"
      ? `http://localhost:${process.env.PORT || 3000}`
      : undefined);

  return {
    metadataBase: origin ? new URL(origin) : undefined,
  };
}

export default async function LocaleLayout({
  children,
  params,
}: Readonly<PropsWithChildren<RouteProps_locale>>) {
  const { locale } = await params;

  // Run the layout in async local storage context
  return localeAsyncLocalStorage.run(
    {
      locale,
      origin:
        process.env.NEXT_PUBLIC_BASE_URL ||
        `http://localhost:${process.env.PORT || 3000}`,
    },
    async () => {
      setLocale(locale, { reload: false });
      return <RootLayout>{children}</RootLayout>;
    }
  );
}
