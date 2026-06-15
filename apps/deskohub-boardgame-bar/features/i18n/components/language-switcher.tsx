"use client";

import { track } from "@vercel/analytics";
import { Languages } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { type Locale, locales, m, setLocale } from "@/features/i18n";
import { setLocaleInPathname } from "@/features/i18n/utils/locale-url";
import { useLocale } from "@/features/i18n/utils/use-locale";
import { Button } from "@/shared/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/shared/components/ui/dropdown-menu";

export function LanguageSwitcher() {
  const router = useRouter();
  const pathname = usePathname();
  const currentLocale = useLocale();

  const handleLanguageChange = (newLocale: Locale) => {
    track("Language Switch", {
      from: currentLocale,
      to: newLocale,
    });
    const newPath = setLocaleInPathname(pathname, newLocale);
    setLocale(newLocale, { reload: false });
    document.documentElement.lang = newLocale;
    router.replace(newPath, { scroll: false });
    router.refresh(); // Clear the router cache to ensure all preloaded routes use the new locale
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
