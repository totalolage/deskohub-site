export { default as middleware } from "@/shared/utils/middleware";

export const config = {
  matcher: [
    "/((?!_next|api|favicon.ico|icon.ico|apple-icon|images|.*\\.ico$|.well-known).*)",
  ],
};
