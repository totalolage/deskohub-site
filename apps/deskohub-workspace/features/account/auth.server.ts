import "server-only";

import { createNeonAuth, type NeonAuth } from "@neondatabase/auth/next/server";
import { env } from "@/env";
import { resolveNeonAuthConfiguration } from "./auth-config";

let auth: NeonAuth | undefined;

export const getNeonAuth = () => {
  const configuration = resolveNeonAuthConfiguration(env);
  if (!configuration) return undefined;

  auth ??= createNeonAuth({
    baseUrl: configuration.baseUrl,
    cookies: { secret: configuration.cookieSecret, sameSite: "lax" },
  });
  return auth;
};

export const isNeonAuthConfigured = () => getNeonAuth() !== undefined;
