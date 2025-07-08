"use client";

import { useLocale } from "@/i18n/translations/use-locale";
import { useEffect } from "react";

export function LanguageHtmlUpdater() {
  const locale = useLocale();

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  return null;
}
