import { z } from "zod";

export const workspaceServerEnvSchema = z.object({
  WORKSPACE_API_URL: z.url(),
  WORKSPACE_INTERNAL_API_KEY: z.string().min(1),
});

export const workspaceClientEnvSchema = z.object({
  NEXT_PUBLIC_GTM_ID: z.string().optional(),
  NEXT_PUBLIC_WORKSPACE_APP_URL: z.url(),
  NEXT_PUBLIC_WORKSPACE_ENV: z
    .enum(["development", "preview", "production"])
    .default("development"),
});

export type WorkspaceServerEnv = z.infer<typeof workspaceServerEnvSchema>;
export type WorkspaceClientEnv = z.infer<typeof workspaceClientEnvSchema>;

export type WorkspaceEnvContract = {
  server: WorkspaceServerEnv;
  client: WorkspaceClientEnv;
};
