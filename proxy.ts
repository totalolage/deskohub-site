import type { MiddlewareConfig } from "next/server";

export { default as proxy } from "@/shared/utils/middleware";

export const config: MiddlewareConfig = {
  matcher: ["/((?!api|_next|_vercel|\\.well-known|.*\\..*).*)"],
};
