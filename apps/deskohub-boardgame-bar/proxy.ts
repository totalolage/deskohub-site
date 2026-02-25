import type { MiddlewareConfig } from "next/server";

export { default as proxy } from "@/shared/utils/middleware";

export const config: MiddlewareConfig = {
  matcher:
    "/((?<!.[^/]/)(?!(?:_next|_debug|api|images|\\.well-known)(?:/|$))(?![^/]*icon(?=[.-])[^/]*(?:/.*)?$|.*/[^/]*icon(?=[.-])[^/]*$).*)",
};
