import { createEnv } from "@t3-oss/env-nextjs";
import { Schema } from "effect";
import {
  postHogBrowserEnvironmentCheck,
  workspaceClientEnvSchema,
} from "./client-env.schema";

const validateClientEnv = () =>
  createEnv({
    client: workspaceClientEnvSchema.fields,
    runtimeEnv: {
      NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME:
        process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME,
      NEXT_PUBLIC_GTM_ID: process.env.NEXT_PUBLIC_GTM_ID,
      NEXT_PUBLIC_POSTHOG_HOST: process.env.NEXT_PUBLIC_POSTHOG_HOST,
      NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN:
        process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN,
      NEXT_PUBLIC_VERCEL_ENV: process.env.NEXT_PUBLIC_VERCEL_ENV,
    },
    createFinalSchema: (fields) =>
      Schema.toStandardSchemaV1(
        Schema.Struct(fields).check(postHogBrowserEnvironmentCheck)
      ),
    emptyStringAsUndefined: true,
    onValidationError: (error) => {
      throw new Error(
        `Invalid workspace environment variables: ${JSON.stringify(error, null, 2)}`
      );
    },
  });

let validatedClientEnv: ReturnType<typeof validateClientEnv> | undefined;

/**
 * Browser-visible workspace environment for client modules, validated on the
 * first call so modules that read it only on some paths stay importable
 * without it. Import `env` from `./env` only in server code: it carries the
 * server schema and its dependencies, which must stay out of browser bundles.
 */
export const getClientEnv = () => {
  validatedClientEnv ??= validateClientEnv();
  return validatedClientEnv;
};
