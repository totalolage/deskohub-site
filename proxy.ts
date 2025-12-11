import type { MiddlewareConfig } from "next/server";

export { default as proxy } from "@/shared/utils/middleware";

export const config: MiddlewareConfig = {
  matcher:
    "/((?<!.[^/]/)(?!(?:_next|api|images|\\.well-known)(?:/|$))(?![^/]*icon(?=[.-])[^/]*(?:/.*)?$|.*/[^/]*icon(?=[.-])[^/]*$).*)",
};
