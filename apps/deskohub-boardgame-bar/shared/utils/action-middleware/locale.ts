import { createLocaleActionMiddleware } from "@deskohub/i18n/action";
import { baseLocale, setLocale } from "@/features/i18n";
import { getLocaleFromServer } from "@/features/i18n/utils/get-locale.server";

/**
 * Middleware to automatically set the locale for all server actions
 * This eliminates the need to manually set locale in each action
 */
export const localeMiddleware = createLocaleActionMiddleware({
  resolveLocale: getLocaleFromServer,
  fallbackLocale: baseLocale,
  setLocale,
});
