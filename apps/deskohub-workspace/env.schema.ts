import { z } from "zod";

export const workspaceServerEnvSchema = z.object({
  CLOUDINARY_API_KEY: z.string().min(1),
  CLOUDINARY_API_SECRET: z.string().min(1),
  DATABASE_URL: z.url(),
  DATABASE_URL_UNPOOLED: z.url().optional(),
  DOTYPOS_API_TIMEOUT: z.coerce.number().int().positive().default(5_000),
  DOTYPOS_API_URL: z.url(),
  DOTYPOS_BRANCH_ID: z.string().min(1),
  DOTYPOS_CLIENT_ID: z.string().min(1),
  DOTYPOS_CLIENT_SECRET: z.string().min(1),
  DOTYPOS_CLOUD_ID: z.string().min(1),
  DOTYPOS_EMPLOYEE_ID: z.string().min(1),
  DOTYPOS_REFRESH_TOKEN: z.string().min(1),
  EMAIL_API_KEY: z.string().optional(),
  GOOGLE_CALENDAR_ID: z.string().min(1),
  GOOGLE_CALENDAR_PRIVATE_KEY: z.string().min(1),
  GOOGLE_CALENDAR_SERVICE_ACCOUNT_EMAIL: z.string().min(1),
  RESEND_WEBHOOK_SECRET: z.string().optional(),
  CHECKOUT_PAY_STATE_KEYS: z.string().min(1),
  CHECKOUT_RETURN_STATE_TOKEN_SECRET: z.string().min(32).optional(),
  CRON_SECRET: z.string().min(1).optional(),
  NEXI_API_KEY: z.string().min(1),
  NEXI_API_ORIGIN: z.url(),
  NEXI_CHECKOUT_CURRENCY_OVERRIDE: z.enum(["EUR"]).optional(),
  POSTHOG_SERVICE_NAME: z.string().min(1).default("deskohub-workspace"),
  POSTHOG_SERVICE_NAMESPACE: z.string().min(1).default("deskohub"),
  VERCEL_ENV: z.enum(["production", "preview", "development"]),
  VERCEL_AUTOMATION_BYPASS_SECRET: z.string().optional(),
  VERCEL_PROJECT_PRODUCTION_URL: z.string().min(1),
  VERCEL_URL: z.string().min(1),
  WORKSPACE_CALLBACK_ORIGIN: z.url().optional(),
});

export const workspaceClientEnvSchema = z.object({
  NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME: z.string(),
  NEXT_PUBLIC_GTM_ID: z.string().optional(),
  NEXT_PUBLIC_POSTHOG_HOST: z.url().optional(),
  NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN: z.string().min(1).optional(),
});

export type WorkspaceServerEnv = z.infer<typeof workspaceServerEnvSchema>;
export type WorkspaceClientEnv = z.infer<typeof workspaceClientEnvSchema>;
