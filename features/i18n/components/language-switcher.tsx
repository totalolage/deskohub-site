"use client";

import { Languages } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { Button } from "@/shared/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/shared/components/ui/dropdown-menu";
import { type Locale, locales, m, setLocale } from "@/i18n";
import { getLocaleFromPathname } from "@/i18n/utils/get-locale-from-pathname";
import { useLocale } from "@/i18n/utils/use-locale";

export function LanguageSwitcher() {
  const router = useRouter();
  const pathname = usePathname();
  const currentLocale = useLocale();

  const handleLanguageChange = (newLocale: Locale) => {
    const localeLength = getLocaleFromPathname(pathname)?.length ?? 0;
    const basePath = pathname.substring(localeLength + 1); // Account for leading slash

    router.push(`/${newLocale}${basePath}`);
    setLocale(newLocale, { reload: false });
    document.documentElement.lang = newLocale;
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="text-white hover:text-green-400 hover:bg-white/10"
        >
          <Languages className="h-4 w-4 mr-2" />
          {m.language({})}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {locales.map((locale) => (
          <DropdownMenuItem
            key={locale}
            onClick={() => handleLanguageChange(locale)}
            className={currentLocale === locale ? "bg-accent" : ""}
          >
            {m.language({}, { locale })}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
