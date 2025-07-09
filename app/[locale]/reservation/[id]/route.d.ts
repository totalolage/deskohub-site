import { RouteParams_locale } from "../../route";

export type RouteParams_id = {
  id: string;
};

export type RouteProps_locale_id<
  T extends Record<unknown, unknown> = Record<string, never>,
> = T & {
  params: Promise<RouteParams_locale & RouteParams_id>;
};
