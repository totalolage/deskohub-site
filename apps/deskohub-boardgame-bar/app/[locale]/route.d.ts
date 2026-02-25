import type { Locale } from "@/features/i18n";

export type RouteParams_locale = {
  locale: Locale;
};

export type RouteProps_locale<
  T extends Record<unknown, unknown> = Record<string, never>,
> = T & {
  params: Promise<RouteParams_locale>;
};
