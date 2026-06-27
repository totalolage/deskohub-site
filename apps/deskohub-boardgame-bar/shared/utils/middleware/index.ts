import { createMiddlewareChain } from "@/shared/utils/middleware-chain";
import { localizationMiddleware } from "./localization";
import { pathHeaderMiddleware } from "./path-header";

export default createMiddlewareChain([
  localizationMiddleware,
  pathHeaderMiddleware,
]);
