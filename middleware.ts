import type { MiddlewareConfig } from "next/server";

export { default } from "@/shared/utils/middleware";

export const config: MiddlewareConfig = {
  matcher: ["/((?![\\w-_]icon\\.\\w+)$)((?!_next|api|images|.well-known).*)"],
};
