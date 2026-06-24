import { Context } from "effect";
import type { Locale } from "@/features/i18n";

export class LocaleValue extends Context.Service<LocaleValue, Locale>()(
  "Locale"
) {}
