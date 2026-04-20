import { z } from "zod";

export const workspaceServerEnvSchema = z.object({
  EMAIL_API_KEY: z.string().optional(),
});

export const workspaceClientEnvSchema = z.object({
  NEXT_PUBLIC_GTM_ID: z.string().optional(),
});

export type WorkspaceServerEnv = z.infer<typeof workspaceServerEnvSchema>;
export type WorkspaceClientEnv = z.infer<typeof workspaceClientEnvSchema>;

export type WorkspaceEnvContract = {
  server: WorkspaceServerEnv;
  client: WorkspaceClientEnv;
};
