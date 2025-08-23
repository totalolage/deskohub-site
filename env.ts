import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

export const env = createEnv({
  /**
   * Server-side environment variables schema.
   * These are only available on the server and should never be exposed to the client.
   */
  server: {
    // Dotypos API Configuration (Server-only)
    DOTYPOS_CLIENT_ID: z.string().min(1, "DOTYPOS_CLIENT_ID is required"),
    DOTYPOS_CLIENT_SECRET: z
      .string()
      .min(1, "DOTYPOS_CLIENT_SECRET is required"),
    DOTYPOS_REFRESH_TOKEN: z
      .string()
      .min(1, "DOTYPOS_REFRESH_TOKEN is required"),
    DOTYPOS_API_URL: z.url(),
    DOTYPOS_BRANCH_ID: z.string(),
    DOTYPOS_CLOUD_ID: z.string(),
    DOTYPOS_EMPLOYEE_ID: z.string(),
    DOTYPOS_API_TIMEOUT: z.coerce.number().int().positive().default(30000),

    // Statsig Configuration (Server-only)
    STATSIG_SERVER_API_KEY: z.string(),

    // Webhook Security (Server-only)
    DOTYPOS_WEBHOOK_SECRET: z.uuid(),

    // Node environment
    NODE_ENV: z.enum(["development", "test", "production"]),
  },

  /**
   * Client-side environment variables schema.
   * These are exposed to the client via the NEXT_PUBLIC_ prefix.
   */
  client: {
    // Statsig Configuration (Client-accessible)
    NEXT_PUBLIC_STATSIG_CLIENT_KEY: z.string(),
  },

  /**
   * Runtime environment variables.
   * Destructure process.env to provide type-safe access.
   */
  runtimeEnv: {
    // Env
    NODE_ENV: process.env.NODE_ENV,

    // Server variables
    DOTYPOS_CLIENT_ID: process.env.DOTYPOS_CLIENT_ID,
    DOTYPOS_CLIENT_SECRET: process.env.DOTYPOS_CLIENT_SECRET,
    DOTYPOS_REFRESH_TOKEN: process.env.DOTYPOS_REFRESH_TOKEN,
    DOTYPOS_API_URL: process.env.DOTYPOS_API_URL,
    DOTYPOS_BRANCH_ID: process.env.DOTYPOS_BRANCH_ID,
    DOTYPOS_CLOUD_ID: process.env.DOTYPOS_CLOUD_ID,
    DOTYPOS_EMPLOYEE_ID: process.env.DOTYPOS_EMPLOYEE_ID,
    DOTYPOS_API_TIMEOUT: process.env.DOTYPOS_API_TIMEOUT,
    DOTYPOS_WEBHOOK_SECRET: process.env.DOTYPOS_WEBHOOK_SECRET,
    STATSIG_SERVER_API_KEY: process.env.STATSIG_SERVER_API_KEY,

    // Client variables
    NEXT_PUBLIC_STATSIG_CLIENT_KEY: process.env.NEXT_PUBLIC_STATSIG_CLIENT_KEY,
  },

  emptyStringAsUndefined: true,

  /**
   * Called when validation fails.
   * Override this to customize error handling.
   */
  onValidationError: (error) => {
    console.error(
      "❌ Invalid environment variables:",
      JSON.stringify(error, null, 2)
    );
    throw new Error("Invalid environment variables");
  },

  /**
   * Called when trying to access a server-side env var on the client.
   */
  onInvalidAccess: (variable) => {
    throw new Error(
      `❌ Attempted to access server-side environment variable '${variable}' on the client`
    );
  },
});
