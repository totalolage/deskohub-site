import { Locale } from "@/i18n";

export type RouteParams_lang = {
  lang: Locale;
};

export type RouteProps_lang<
  T extends Record<unknown, unknown> = Record<string, never>,
> = T & {
  params: Promise<RouteParams_lang>;
};
