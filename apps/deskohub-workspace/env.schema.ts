import { z } from "zod";

export const workspaceServerEnvSchema = z.object({
  CLOUDINARY_API_KEY: z.string(),
  CLOUDINARY_API_SECRET: z.string(),
  DATABASE_URL: z.url(),
  DOTYPOS_API_TIMEOUT: z.coerce.number().int().positive().default(30000),
  DOTYPOS_API_URL: z.url(),
  DOTYPOS_BRANCH_ID: z.string(),
  DOTYPOS_CLIENT_ID: z.string(),
  DOTYPOS_CLIENT_SECRET: z.string(),
  DOTYPOS_CLOUD_ID: z.string(),
  DOTYPOS_EMPLOYEE_ID: z.string(),
  DOTYPOS_REFRESH_TOKEN: z.string(),
  WORKSPACE_DOTYPOS_TABLE_ID: z.string(),
  EMAIL_API_KEY: z.string().optional(),
  NEXI_API_KEY: z.string(),
  NEXI_API_ORIGIN: z.url(),
  NEXI_CHECKOUT_CURRENCY_OVERRIDE: z.enum(["EUR"]).optional(),
  VERCEL_ENV: z.enum(["production", "preview", "development"]),
  VERCEL_AUTOMATION_BYPASS_SECRET: z.string().optional(),
  VERCEL_PROJECT_PRODUCTION_URL: z.string().optional(),
  VERCEL_URL: z.string().optional(),
});

export const workspaceClientEnvSchema = z.object({
  NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME: z.string(),
  NEXT_PUBLIC_GTM_ID: z.string().optional(),
});

export type WorkspaceServerEnv = z.infer<typeof workspaceServerEnvSchema>;
export type WorkspaceClientEnv = z.infer<typeof workspaceClientEnvSchema>;

export type WorkspaceEnvContract = {
  server: WorkspaceServerEnv;
  client: WorkspaceClientEnv;
};
