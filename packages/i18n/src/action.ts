import { createMiddleware } from "next-safe-action";
import type { RequestLocaleScope } from "./request-locale";

type CreateLocaleActionMiddlewareOptions<Locale extends string> = {
  resolveLocale: () => Promise<Locale | undefined> | Locale | undefined;
  fallbackLocale: Locale;
  scope: Pick<RequestLocaleScope<Locale>, "runWithLocale">;
};

export function createLocaleActionMiddleware<Locale extends string>({
  resolveLocale,
  fallbackLocale,
  scope,
}: CreateLocaleActionMiddlewareOptions<Locale>) {
  return createMiddleware<{ ctx: object }>().define<{ locale: Locale }>(
    async ({ next }) => {
      const locale = (await resolveLocale()) ?? fallbackLocale;

      return scope.runWithLocale(locale, () => next({ ctx: { locale } }));
    }
  );
}
