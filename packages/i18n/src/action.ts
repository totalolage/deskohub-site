import { createMiddleware } from "next-safe-action";

type CreateLocaleActionMiddlewareOptions<Locale extends string> = {
  resolveLocale: () => Promise<Locale | undefined> | Locale | undefined;
  fallbackLocale: Locale;
  setLocale: (locale: Locale) => unknown;
};

export function createLocaleActionMiddleware<Locale extends string>({
  resolveLocale,
  fallbackLocale,
  setLocale,
}: CreateLocaleActionMiddlewareOptions<Locale>) {
  return createMiddleware<{ ctx: object }>().define<{ locale: Locale }>(
    async ({ next }) => {
      const locale = (await resolveLocale()) ?? fallbackLocale;
      setLocale(locale);

      return next({
        ctx: {
          locale,
        },
      });
    }
  );
}
