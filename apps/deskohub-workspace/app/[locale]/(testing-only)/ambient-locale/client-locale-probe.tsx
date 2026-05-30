"use client";

import Link from "next/link";
import { useParams, usePathname, useSearchParams } from "next/navigation";
import { getLocale, isLocale, type Locale, locales, m } from "@/features/i18n";
import {
  getLocaleFromPathname,
  withLocalePrefixAndSearch,
} from "@/features/i18n/routing";

function useRouteLocale(): Locale | undefined {
  const params = useParams<{ locale?: string }>();
  const pathname = usePathname();

  if (isLocale(params.locale)) return params.locale;

  return getLocaleFromPathname(pathname);
}

type ClientLocaleProbeProps = {
  expectedLocale: Locale;
};

export function ClientLocaleProbe({ expectedLocale }: ClientLocaleProbeProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const routeLocale = useRouteLocale();
  const directLocale = getLocale();
  const explicitMessage = m.languageEnglish({}, { locale: expectedLocale });
  const ambientMessage = m.languageEnglish();

  return (
    <section className="rounded-3xl border border-navy-blue/10 bg-white p-6 shadow-sm">
      <h2 className="text-2xl">Client component probe</h2>
      <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
        <dt className="font-semibold">Locale from route hook</dt>
        <dd>{routeLocale ?? "missing"}</dd>
        <dt className="font-semibold">Direct client getLocale()</dt>
        <dd>{directLocale}</dd>
        <dt className="font-semibold">Explicit message</dt>
        <dd>{explicitMessage}</dd>
        <dt className="font-semibold">Ambient client message</dt>
        <dd>{ambientMessage}</dd>
      </dl>
      <p className="mt-4 text-sm text-navy-blue/70">
        Route-derived locale should switch immediately after navigating between
        the links below. Direct client getLocale() only reflects Paraglide
        client state, not server async storage.
      </p>
      <nav className="mt-5 flex flex-wrap gap-3" aria-label="Locale test links">
        {locales.map((locale) => (
          <Link
            key={locale}
            href={withLocalePrefixAndSearch(pathname, locale, searchParams)}
            scroll={false}
            className="rounded-full border border-navy-blue/20 px-4 py-2 text-sm font-semibold text-navy-blue transition-colors hover:bg-navy-blue hover:text-white"
          >
            Switch to {locale}
          </Link>
        ))}
      </nav>
    </section>
  );
}
