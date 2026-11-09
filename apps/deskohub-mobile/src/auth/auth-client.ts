/**
 * Metro bundles `auth-client.native.ts` or `auth-client.web.ts`; this file
 * only gives TypeScript the shape shared code may rely on. Web-only calls
 * (sign-in code, browser passkeys) import `./auth-client.web` directly.
 */
export { apiOrigin, authClient } from "./auth-client.native";
