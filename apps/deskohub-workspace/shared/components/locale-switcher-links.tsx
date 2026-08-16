"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { Fragment, type ReactNode } from "react";
import {
  type Locale,
  locales,
  withLocalePrefixAndSearch,
} from "@/features/i18n";
import { cn } from "@/shared/utils";

type LocaleSwitcherLinksProps = {
  readonly currentLocale: Locale;
  readonly languageLabels: Record<Locale, string>;
  readonly closeMenu?: () => void;
  readonly isMobile?: boolean;
};

export function LocaleSwitcherLinks({
  currentLocale,
  languageLabels,
  closeMenu,
  isMobile = false,
}: LocaleSwitcherLinksProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const getLocaleHref = (locale: Locale) =>
    withLocalePrefixAndSearch(pathname, locale, searchParams);

  return (
    <LocaleSwitcherLabels
      currentLocale={currentLocale}
      languageLabels={languageLabels}
      closeMenu={closeMenu}
      getLocaleHref={getLocaleHref}
      isMobile={isMobile}
    />
  );
}

export function LocaleSwitcherLabels({
  currentLocale,
  languageLabels,
  closeMenu,
  getLocaleHref,
  isMobile = false,
}: LocaleSwitcherLinksProps & {
  readonly getLocaleHref?: (locale: Locale) => string;
}) {
  return locales.map((locale, index) => {
    const isCurrent = locale === currentLocale;
    let label: ReactNode = languageLabels[locale];

    if (isCurrent) {
      label = <strong className="text-white">{languageLabels[locale]}</strong>;
    } else if (getLocaleHref) {
      label = (
        <a
          href={getLocaleHref(locale)}
          onClick={closeMenu}
          className="transition-colors hover:text-sunset-yellow"
        >
          {languageLabels[locale]}
        </a>
      );
    }

    if (isMobile) {
      return <Fragment key={locale}>{label}</Fragment>;
    }

    return (
      <span
        key={locale}
        className={cn(
          index > 0 &&
            "before:absolute before:translate-x-[0.5ch] before:text-white/28 before:content-['/']"
        )}
      >
        {index > 0 && <br />}
        {label}
      </span>
    );
  });
}
