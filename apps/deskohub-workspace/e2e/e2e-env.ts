import { createEnv } from "@t3-oss/env-nextjs";
import { Schema } from "effect";
import { urlStringSchema } from "../shared/utils/url-schema";

const toEnvironmentSchema = <S extends Schema.Decoder<unknown>>(schema: S) =>
  Schema.toStandardSchemaV1(schema);

const optionalNonEmptyString = toEnvironmentSchema(
  Schema.optional(Schema.NonEmptyString)
);
const optionalPositiveInteger = toEnvironmentSchema(
  Schema.optional(
    Schema.FiniteFromString.check(Schema.isInt()).check(Schema.isGreaterThan(0))
  )
);

export const e2eEnvironmentSchema = Schema.Struct({
  GITHUB_ACTIONS: toEnvironmentSchema(
    Schema.optional(Schema.Literals(["false", "true"]))
  ),
  GITHUB_EVENT_NAME: optionalNonEmptyString,
  GITHUB_RUN_ATTEMPT: optionalPositiveInteger,
  GITHUB_RUN_ID: toEnvironmentSchema(
    Schema.optional(Schema.String.check(Schema.isPattern(/^[1-9][0-9]*$/)))
  ),
  TARGET_SHA: toEnvironmentSchema(
    Schema.optional(Schema.String.check(Schema.isPattern(/^[0-9a-f]{40}$/)))
  ),
  WORKSPACE_E2E_EXECUTION_CONTEXT: toEnvironmentSchema(
    Schema.optional(Schema.Literals(["ci", "manual"]))
  ),
  WORKSPACE_E2E_POSTHOG_HOST: toEnvironmentSchema(
    Schema.optional(urlStringSchema)
  ),
  WORKSPACE_E2E_POSTHOG_PROJECT_TOKEN: optionalNonEmptyString,
  WORKSPACE_E2E_PR_NUMBER: optionalPositiveInteger,
});

const e2eClientEnvironmentSchema = Schema.Struct({
  NEXT_PUBLIC_POSTHOG_HOST: toEnvironmentSchema(
    Schema.optional(urlStringSchema)
  ),
  NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN: optionalNonEmptyString,
});

export const makeE2EEnvironment = (
  runtimeEnvironment: NodeJS.ProcessEnv = process.env
) =>
  createEnv({
    client: e2eClientEnvironmentSchema.fields,
    emptyStringAsUndefined: true,
    onValidationError: () => {
      throw new Error("Invalid workspace E2E environment variables.");
    },
    runtimeEnv: {
      GITHUB_ACTIONS: runtimeEnvironment.GITHUB_ACTIONS,
      GITHUB_EVENT_NAME: runtimeEnvironment.GITHUB_EVENT_NAME,
      GITHUB_RUN_ATTEMPT: runtimeEnvironment.GITHUB_RUN_ATTEMPT,
      GITHUB_RUN_ID: runtimeEnvironment.GITHUB_RUN_ID,
      NEXT_PUBLIC_POSTHOG_HOST: runtimeEnvironment.NEXT_PUBLIC_POSTHOG_HOST,
      NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN:
        runtimeEnvironment.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN,
      TARGET_SHA: runtimeEnvironment.TARGET_SHA,
      WORKSPACE_E2E_EXECUTION_CONTEXT:
        runtimeEnvironment.WORKSPACE_E2E_EXECUTION_CONTEXT,
      WORKSPACE_E2E_POSTHOG_HOST: runtimeEnvironment.WORKSPACE_E2E_POSTHOG_HOST,
      WORKSPACE_E2E_POSTHOG_PROJECT_TOKEN:
        runtimeEnvironment.WORKSPACE_E2E_POSTHOG_PROJECT_TOKEN,
      WORKSPACE_E2E_PR_NUMBER: runtimeEnvironment.WORKSPACE_E2E_PR_NUMBER,
    },
    server: e2eEnvironmentSchema.fields,
  });

export type E2EEnvironment = ReturnType<typeof makeE2EEnvironment>;
