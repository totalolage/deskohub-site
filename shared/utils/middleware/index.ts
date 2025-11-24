import { createMiddlewareChain } from "@/shared/utils/middleware-chain";
import { botProtectionMiddleware } from "./bot-protection";
import { localizationMiddleware } from "./localization";
import { pathHeaderMiddleware } from "./path-header";

export default createMiddlewareChain([
  botProtectionMiddleware,
  localizationMiddleware,
  pathHeaderMiddleware,
]);
