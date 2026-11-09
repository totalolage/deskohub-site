import { appLinkRoute } from "../src/routing/app-link";

/** Maps incoming native links before Expo Router matches a route. */
export const redirectSystemPath = ({
  path,
}: {
  readonly path: string;
  readonly initial: boolean;
}): string => appLinkRoute(path);
