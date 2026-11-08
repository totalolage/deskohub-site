import { productionApiOrigin } from "./api-origin";

/**
 * Vercel BotID screens the sign-in email and the sign-in code on the
 * production deployment only (the Workspace's `initializeWorkspaceBotId`
 * policy); previews and development must not load it. The web bundle reads
 * `EXPO_PUBLIC_VERCEL_ENV` when its build sets it, and otherwise treats the
 * production host as the production deployment.
 */
export const isBotProtectionEnforced = (
  vercelEnvironment: string | undefined,
  servingOrigin: string | undefined
): boolean =>
  vercelEnvironment === undefined || vercelEnvironment === ""
    ? servingOrigin === productionApiOrigin
    : vercelEnvironment === "production";

/** The requests the web bundle sends that the server checks with BotID. */
export const botProtectedAuthRequests = [
  { path: "/api/auth/sign-in/magic-link", method: "POST" },
  { path: "/api/auth/sign-in/email-otp", method: "POST" },
] as const;
