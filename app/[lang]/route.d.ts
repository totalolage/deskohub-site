import { Locale } from "@/i18n";

export type RouteParams = {
  lang: Locale;
};

export type PropsWithLocale<
  T extends Record<unknown, unknown> = Record<string, never>,
> = T & {
  params: Promise<RouteParams>;
};
