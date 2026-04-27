import { createLocaleActionMiddleware } from "@deskohub/i18n/action";
import { baseLocale, setLocale } from "@/features/i18n";
import { getLocaleFromServer } from "@/features/i18n/utils/get-locale.server";

export const localeMiddleware = createLocaleActionMiddleware({
  resolveLocale: getLocaleFromServer,
  fallbackLocale: baseLocale,
  setLocale,
});
