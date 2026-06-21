import type { ReactNode } from "react";
import type { Locale } from "@/features/i18n";
import { gdprCzech } from "./cz";
import { gdprEnglish } from "./en";

export const gdprTextsByLocale = {
  "cs-CZ": gdprCzech,
  "en-US": gdprEnglish,
} satisfies Record<Locale, ReactNode>;
