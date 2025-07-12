import { createMiddleware } from "next-safe-action";
import { baseLocale, setLocale } from "@/i18n";
import { getLocaleFromServer } from "@/i18n/utils/get-locale.server";

/**
 * Middleware to automatically set the locale for all server actions
 * This eliminates the need to manually set locale in each action
 */
export const localeMiddleware = createMiddleware().define(async ({ next }) => {
  // Get the locale from the request (headers, cookies, etc.)
  const locale = (await getLocaleFromServer()) ?? baseLocale;

  // Set the locale for Paraglide
  setLocale(locale);

  // Continue with the action execution
  return next({
    ctx: {
      locale,
    },
  });
});
