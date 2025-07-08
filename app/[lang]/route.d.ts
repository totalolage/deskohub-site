import { Locale } from "@/src/paraglide/runtime";

export type RouteParams = {
  lang: Locale;
};

export type PropsWithParams<T extends Record<unknown, unknown> = {}> = T & {
  params: Promise<RouteParams>;
};
