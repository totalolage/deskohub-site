import { Locale } from "@/i18n";

export type RouteParams = {
  lang: Locale;
};

export type PropsWithParams<T extends Record<unknown, unknown> = {}> = T & {
  params: Promise<RouteParams>;
};
