import { Data } from "effect";
import type { Locale } from "@/features/i18n";
import { gdprCzech } from "./cz";
import { gdprEnglish } from "./en";

export const gdprTextsByLocale = Data.struct<Record<Locale, string>>({
  "cs-CZ": gdprCzech,
  "en-US": gdprEnglish,
});
