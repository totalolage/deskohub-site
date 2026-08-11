import {
  DotyposBranchIdSchema,
  DotyposClientIdSchema,
  DotyposCloudIdSchema,
  DotyposEmployeeIdSchema,
} from "@deskohub/dotypos";
import { createEnv } from "@t3-oss/env-core";
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
const optionalAllocationShard = toEnvironmentSchema(
  Schema.optional(
    Schema.FiniteFromString.check(Schema.isInt())
      .check(Schema.isGreaterThan(0))
      .check(Schema.isLessThanOrEqualTo(3))
  )
);
const optionalDirectPostgresUrl = toEnvironmentSchema(
  Schema.optional(
    Schema.String.check(
      Schema.makeFilter(
        (value) => {
          if (!URL.canParse(value)) return false;
          const url = new URL(value);
          return (
            (url.protocol === "postgres:" || url.protocol === "postgresql:") &&
            !url.hostname.split(".")[0]?.endsWith("-pooler")
          );
        },
        { expected: "a direct PostgreSQL URL" }
      )
    )
  )
);
const nonEmptyString = toEnvironmentSchema(Schema.NonEmptyString);
const optionalNeonResourceId = toEnvironmentSchema(
  Schema.optional(Schema.String.check(Schema.isPattern(/^[a-z0-9-]{1,60}$/)))
);
const optionalUrl = toEnvironmentSchema(Schema.optional(urlStringSchema));
const url = toEnvironmentSchema(urlStringSchema);
type RuntimeEnvironment = Readonly<Record<string, string | undefined>>;

export const e2eEnvironmentSchema = Schema.Struct({
  CI: optionalNonEmptyString,
  DATABASE_URL: nonEmptyString,
  DOTYPOS_API_URL: url,
  DOTYPOS_BRANCH_ID: toEnvironmentSchema(DotyposBranchIdSchema),
  DOTYPOS_CLIENT_ID: toEnvironmentSchema(DotyposClientIdSchema),
  DOTYPOS_CLIENT_SECRET: nonEmptyString,
  DOTYPOS_CLOUD_ID: toEnvironmentSchema(DotyposCloudIdSchema),
  DOTYPOS_EMPLOYEE_ID: toEnvironmentSchema(DotyposEmployeeIdSchema),
  DOTYPOS_REFRESH_TOKEN: nonEmptyString,
  GITHUB_ACTIONS: toEnvironmentSchema(
    Schema.optional(Schema.Literals(["false", "true"]))
  ),
  GITHUB_EVENT_NAME: optionalNonEmptyString,
  GITHUB_RUN_ATTEMPT: optionalPositiveInteger,
  GITHUB_RUN_ID: toEnvironmentSchema(
    Schema.optional(Schema.String.check(Schema.isPattern(/^[1-9][0-9]*$/)))
  ),
  HOME: optionalNonEmptyString,
  LANG: optionalNonEmptyString,
  NEXI_API_ORIGIN: url,
  PATH: optionalNonEmptyString,
  TARGET_SHA: toEnvironmentSchema(
    Schema.optional(Schema.String.check(Schema.isPattern(/^[0-9a-f]{40}$/)))
  ),
  TMPDIR: optionalNonEmptyString,
  USER: optionalNonEmptyString,
  VERCEL_AUTOMATION_BYPASS_SECRET: optionalNonEmptyString,
  WORKSPACE_E2E_EXECUTION_CONTEXT: toEnvironmentSchema(
    Schema.optional(Schema.Literals(["ci", "manual"]))
  ),
  WORKSPACE_E2E_BASE_URL: url,
  WORKSPACE_E2E_ALLOCATION_SHARD: optionalAllocationShard,
  WORKSPACE_E2E_PROVIDER_PERMIT_REQUIRED: toEnvironmentSchema(
    Schema.optional(Schema.Literals(["true"]))
  ),
  WORKSPACE_E2E_PROVIDER_PERMIT_DATABASE_URL: optionalDirectPostgresUrl,
  WORKSPACE_E2E_DATABASE_ALLOWLIST: nonEmptyString,
  WORKSPACE_E2E_DATABASE_URL_UNPOOLED: nonEmptyString,
  WORKSPACE_E2E_NEON_API_KEY: optionalNonEmptyString,
  WORKSPACE_E2E_NEON_BRANCH_ID: optionalNeonResourceId,
  WORKSPACE_E2E_NEON_PROJECT_ID: optionalNeonResourceId,
  WORKSPACE_E2E_POSTHOG_HOST: optionalUrl,
  WORKSPACE_E2E_POSTHOG_PROJECT_TOKEN: optionalNonEmptyString,
  WORKSPACE_E2E_PR_NUMBER: optionalPositiveInteger,
});

export const makeE2EEnvironment = (
  runtimeEnvironment: RuntimeEnvironment = process.env
) =>
  createEnv({
    emptyStringAsUndefined: true,
    onValidationError: () => {
      throw new Error("Invalid workspace E2E environment variables.");
    },
    runtimeEnv: {
      CI: runtimeEnvironment.CI,
      DATABASE_URL: runtimeEnvironment.DATABASE_URL,
      DOTYPOS_API_URL: runtimeEnvironment.DOTYPOS_API_URL,
      DOTYPOS_BRANCH_ID: runtimeEnvironment.DOTYPOS_BRANCH_ID,
      DOTYPOS_CLIENT_ID: runtimeEnvironment.DOTYPOS_CLIENT_ID,
      DOTYPOS_CLIENT_SECRET: runtimeEnvironment.DOTYPOS_CLIENT_SECRET,
      DOTYPOS_CLOUD_ID: runtimeEnvironment.DOTYPOS_CLOUD_ID,
      DOTYPOS_EMPLOYEE_ID: runtimeEnvironment.DOTYPOS_EMPLOYEE_ID,
      DOTYPOS_REFRESH_TOKEN: runtimeEnvironment.DOTYPOS_REFRESH_TOKEN,
      GITHUB_ACTIONS: runtimeEnvironment.GITHUB_ACTIONS,
      GITHUB_EVENT_NAME: runtimeEnvironment.GITHUB_EVENT_NAME,
      GITHUB_RUN_ATTEMPT: runtimeEnvironment.GITHUB_RUN_ATTEMPT,
      GITHUB_RUN_ID: runtimeEnvironment.GITHUB_RUN_ID,
      HOME: runtimeEnvironment.HOME,
      LANG: runtimeEnvironment.LANG,
      NEXI_API_ORIGIN: runtimeEnvironment.NEXI_API_ORIGIN,
      PATH: runtimeEnvironment.PATH,
      TARGET_SHA: runtimeEnvironment.TARGET_SHA,
      TMPDIR: runtimeEnvironment.TMPDIR,
      USER: runtimeEnvironment.USER,
      VERCEL_AUTOMATION_BYPASS_SECRET:
        runtimeEnvironment.VERCEL_AUTOMATION_BYPASS_SECRET,
      WORKSPACE_E2E_BASE_URL: runtimeEnvironment.WORKSPACE_E2E_BASE_URL,
      WORKSPACE_E2E_ALLOCATION_SHARD:
        runtimeEnvironment.WORKSPACE_E2E_ALLOCATION_SHARD,
      WORKSPACE_E2E_PROVIDER_PERMIT_REQUIRED:
        runtimeEnvironment.WORKSPACE_E2E_PROVIDER_PERMIT_REQUIRED,
      WORKSPACE_E2E_PROVIDER_PERMIT_DATABASE_URL:
        runtimeEnvironment.WORKSPACE_E2E_PROVIDER_PERMIT_DATABASE_URL,
      WORKSPACE_E2E_DATABASE_ALLOWLIST:
        runtimeEnvironment.WORKSPACE_E2E_DATABASE_ALLOWLIST,
      WORKSPACE_E2E_DATABASE_URL_UNPOOLED:
        runtimeEnvironment.WORKSPACE_E2E_DATABASE_URL_UNPOOLED,
      WORKSPACE_E2E_NEON_API_KEY: runtimeEnvironment.WORKSPACE_E2E_NEON_API_KEY,
      WORKSPACE_E2E_NEON_BRANCH_ID:
        runtimeEnvironment.WORKSPACE_E2E_NEON_BRANCH_ID,
      WORKSPACE_E2E_NEON_PROJECT_ID:
        runtimeEnvironment.WORKSPACE_E2E_NEON_PROJECT_ID,
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

export const makeWorkspaceE2EEnvironment = (
  runtimeEnvironment: RuntimeEnvironment = process.env
) => {
  const environment = makeE2EEnvironment(runtimeEnvironment);
  if (
    environment.WORKSPACE_E2E_PROVIDER_PERMIT_REQUIRED === "true" &&
    !environment.WORKSPACE_E2E_PROVIDER_PERMIT_DATABASE_URL
  ) {
    throw new Error("Invalid workspace E2E environment variables.");
  }
  const neonApiKey = environment.WORKSPACE_E2E_NEON_API_KEY;
  const neonBranchId = environment.WORKSPACE_E2E_NEON_BRANCH_ID;
  const neonProjectId = environment.WORKSPACE_E2E_NEON_PROJECT_ID;
  if (!(neonApiKey && neonBranchId && neonProjectId)) {
    throw new Error("Invalid workspace E2E environment variables.");
  }
  return {
    ...environment,
    WORKSPACE_E2E_NEON_API_KEY: neonApiKey,
    WORKSPACE_E2E_NEON_BRANCH_ID: neonBranchId,
    WORKSPACE_E2E_NEON_PROJECT_ID: neonProjectId,
  };
};

export type WorkspaceE2EEnvironment = ReturnType<
  typeof makeWorkspaceE2EEnvironment
>;
