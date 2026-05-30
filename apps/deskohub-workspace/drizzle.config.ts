import { defineConfig } from "drizzle-kit";
import { workspaceServerEnvSchema } from "./env.schema";

const { DATABASE_URL } = workspaceServerEnvSchema
  .pick({ DATABASE_URL: true })
  .parse({ DATABASE_URL: process.env.DATABASE_URL });

export default defineConfig({
  schema: "./db/schema/index.ts",
  out: "./db/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: DATABASE_URL,
  },
});
