import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";
import { siteConstants } from "@/shared/utils/constants";

const normalizeOptionalUrl = (
  input: string | undefined
): string | undefined => {
  if (!input) return undefined;
  if (input.startsWith("http://") || input.startsWith("https://")) {
    return input;
  }
  return `https://${input}`;
};

export const boardgameBarServerSchema = {
  DOTYPOS_CLIENT_ID: z.string().min(1, "DOTYPOS_CLIENT_ID is required"),
  DOTYPOS_CLIENT_SECRET: z.string().min(1, "DOTYPOS_CLIENT_SECRET is required"),
  DOTYPOS_REFRESH_TOKEN: z.string().min(1, "DOTYPOS_REFRESH_TOKEN is required"),
  DOTYPOS_API_URL: z.url(),
  DOTYPOS_BRANCH_ID: z.string(),
  DOTYPOS_CLOUD_ID: z.string(),
  DOTYPOS_EMPLOYEE_ID: z.string(),
  DOTYPOS_API_TIMEOUT: z.coerce.number().int().positive().default(30000),
  DOTYPOS_WEBHOOK_SECRET: z.uuid(),
  EMAIL_API_KEY: z.string().optional(),
  VERCEL_PROJECT_PRODUCTION_URL: z.url().optional(),
  CLOUDINARY_API_KEY: z.string(),
  CLOUDINARY_API_SECRET: z.string(),
} as const;

export const boardgameBarClientSchema = {
  NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME: z.string(),
  NEXT_PUBLIC_DOMAIN: z.url(),
  NEXT_PUBLIC_VERCEL_ENV: z
    .enum(["production", "preview", "development"])
    .optional(),
  NEXT_PUBLIC_NODE_ENV: z.enum(["development", "test", "production"]),
  NEXT_PUBLIC_VERCEL_URL: z.url().optional(),
  NEXT_PUBLIC_GTM_ID: z.string().optional(),
} as const;

export const env = createEnv({
  server: boardgameBarServerSchema,
  client: boardgameBarClientSchema,
  runtimeEnv: {
    NEXT_PUBLIC_NODE_ENV: process.env.NODE_ENV,
    DOTYPOS_CLIENT_ID: process.env.DOTYPOS_CLIENT_ID,
    DOTYPOS_CLIENT_SECRET: process.env.DOTYPOS_CLIENT_SECRET,
    DOTYPOS_REFRESH_TOKEN: process.env.DOTYPOS_REFRESH_TOKEN,
    DOTYPOS_API_URL: process.env.DOTYPOS_API_URL,
    DOTYPOS_BRANCH_ID: process.env.DOTYPOS_BRANCH_ID,
    DOTYPOS_CLOUD_ID: process.env.DOTYPOS_CLOUD_ID,
    DOTYPOS_EMPLOYEE_ID: process.env.DOTYPOS_EMPLOYEE_ID,
    DOTYPOS_API_TIMEOUT: process.env.DOTYPOS_API_TIMEOUT,
    DOTYPOS_WEBHOOK_SECRET: process.env.DOTYPOS_WEBHOOK_SECRET,
    EMAIL_API_KEY: process.env.EMAIL_API_KEY,
    VERCEL_PROJECT_PRODUCTION_URL: normalizeOptionalUrl(
      process.env.VERCEL_PROJECT_PRODUCTION_URL
    ),
    NEXT_PUBLIC_VERCEL_URL: normalizeOptionalUrl(
      process.env.NEXT_PUBLIC_VERCEL_URL
    ),
    NEXT_PUBLIC_VERCEL_ENV: process.env.NEXT_PUBLIC_VERCEL_ENV,
    CLOUDINARY_API_KEY: process.env.CLOUDINARY_API_KEY,
    CLOUDINARY_API_SECRET: process.env.CLOUDINARY_API_SECRET,
    NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME:
      process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME,
    get NEXT_PUBLIC_DOMAIN() {
      if (typeof window !== "undefined") return window.location.origin;
      if (this.NEXT_PUBLIC_VERCEL_URL) return this.NEXT_PUBLIC_VERCEL_URL;
      if (this.VERCEL_PROJECT_PRODUCTION_URL) {
        return this.VERCEL_PROJECT_PRODUCTION_URL;
      }
      if (this.NEXT_PUBLIC_NODE_ENV === "development") {
        return `http://localhost:${process.env.PORT || 3000}`;
      }
      return `https://${siteConstants.brand.publicDomain}`;
    },
    NEXT_PUBLIC_GTM_ID: process.env.NEXT_PUBLIC_GTM_ID,
  },
  emptyStringAsUndefined: true,
  onValidationError: (error) => {
    console.error(
      "❌ Invalid environment variables:",
      JSON.stringify(error, null, 2)
    );
    throw new Error("Invalid environment variables");
  },
  onInvalidAccess: (variable) => {
    throw new Error(
      `❌ Attempted to access server-side environment variable '${variable}' on the client`
    );
  },
});

export type BoardgameBarServerEnv = {
  [K in keyof typeof boardgameBarServerSchema]: z.infer<
    (typeof boardgameBarServerSchema)[K]
  >;
};

export type BoardgameBarClientEnv = {
  [K in keyof typeof boardgameBarClientSchema]: z.infer<
    (typeof boardgameBarClientSchema)[K]
  >;
};

export const publicEnv = {
  NEXT_PUBLIC_DOMAIN: env.NEXT_PUBLIC_DOMAIN,
  NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME: env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME,
  NEXT_PUBLIC_VERCEL_ENV: env.NEXT_PUBLIC_VERCEL_ENV,
  NEXT_PUBLIC_NODE_ENV: env.NEXT_PUBLIC_NODE_ENV,
  NEXT_PUBLIC_VERCEL_URL: env.NEXT_PUBLIC_VERCEL_URL,
  NEXT_PUBLIC_GTM_ID: env.NEXT_PUBLIC_GTM_ID,
} as const;

export type BoardgameBarPublicEnv = typeof publicEnv;
