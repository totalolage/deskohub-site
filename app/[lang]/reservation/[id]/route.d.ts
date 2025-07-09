import { RouteParams_lang } from "../../route";

export type RouteParams_id = {
  id: string;
};

export type RouteProps_lang_id<
  T extends Record<unknown, unknown> = Record<string, never>,
> = T & {
  params: Promise<RouteParams_lang & RouteParams_id>;
};
