"use client";

import { usePathname, useSearchParams } from "next/navigation";
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

  return locales.map((locale, index) => {
    const isCurrent = locale === currentLocale;

    if (isMobile) {
      return isCurrent ? (
        <strong key={locale} className="text-white">
          {languageLabels[locale]}
        </strong>
      ) : (
        <a
          key={locale}
          href={getLocaleHref(locale)}
          onClick={closeMenu}
          className="transition-colors hover:text-sunset-yellow"
        >
          {languageLabels[locale]}
        </a>
      );
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
        {isCurrent ? (
          <strong className="text-white">{languageLabels[locale]}</strong>
        ) : (
          <a
            href={getLocaleHref(locale)}
            className="transition-colors hover:text-sunset-yellow"
          >
            {languageLabels[locale]}
          </a>
        )}
      </span>
    );
  });
}
