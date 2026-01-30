import { Data } from "effect";
import type { ReactNode } from "react";
import type { Locale } from "@/features/i18n";
import { gdprCzech } from "./cz";
import { gdprEnglish } from "./en";

export const gdprTextsByLocale = Data.struct<Record<Locale, ReactNode>>({
  "cs-CZ": gdprCzech,
  "en-US": gdprEnglish,
});
