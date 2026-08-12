import "server-only";

import { createNeonAuth } from "@neondatabase/auth/next/server";
import { env } from "@/env";

// The integration-managed Auth endpoint is backed by the same Neon branch and
// default database as DATABASE_URL; this is not a second database connection.
export const auth = createNeonAuth({
  baseUrl: env.NEON_AUTH_BASE_URL,
  cookies: {
    secret: env.NEON_AUTH_COOKIE_SECRET,
    sameSite: "lax",
  },
});
