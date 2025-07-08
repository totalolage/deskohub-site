"use client";

import { Languages } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Locale, locales, m, setLocale } from "@/i18n";
import { useLocale } from "@/i18n/translations/use-locale";

export function LanguageSwitcher() {
  const router = useRouter();
  const pathname = usePathname();
  const currentLocale = useLocale();

  const handleLanguageChange = (newLocale: Locale) => {
    // Get the current path without the language prefix
    let basePath = "";

    // Remove current language prefix if it exists
    for (const locale of locales) {
      if (pathname.startsWith(`/${locale}/`)) {
        basePath = pathname.substring(`/${locale}`.length);
        break;
      }
      if (pathname === `/${locale}`) {
        basePath = "";
        break;
      }
    }

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
          {m.language({}, { locale: currentLocale })}
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
