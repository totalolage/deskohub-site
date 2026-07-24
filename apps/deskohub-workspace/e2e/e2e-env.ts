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
const nonEmptyString = toEnvironmentSchema(Schema.NonEmptyString);
const optionalUrl = toEnvironmentSchema(Schema.optional(urlStringSchema));
const url = toEnvironmentSchema(urlStringSchema);
type RuntimeEnvironment = Readonly<Record<string, string | undefined>>;

export const e2eEnvironmentSchema = Schema.Struct({
  CI: optionalNonEmptyString,
  DATABASE_URL: nonEmptyString,
  DOTYPOS_API_TIMEOUT: optionalPositiveInteger,
  DOTYPOS_API_URL: url,
  DOTYPOS_BRANCH_ID: nonEmptyString,
  DOTYPOS_CLIENT_ID: nonEmptyString,
  DOTYPOS_CLIENT_SECRET: nonEmptyString,
  DOTYPOS_CLOUD_ID: nonEmptyString,
  DOTYPOS_EMPLOYEE_ID: nonEmptyString,
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
  WORKSPACE_E2E_ARTIFACT_CAPTURE_TIMEOUT_MS: optionalPositiveInteger,
  WORKSPACE_E2E_EXECUTION_CONTEXT: toEnvironmentSchema(
    Schema.optional(Schema.Literals(["ci", "manual"]))
  ),
  WORKSPACE_E2E_BASE_URL: url,
  WORKSPACE_E2E_BROWSER_ACTION_TIMEOUT_MS: optionalPositiveInteger,
  WORKSPACE_E2E_BROWSER_NAVIGATION_TIMEOUT_MS: optionalPositiveInteger,
  WORKSPACE_E2E_CHECKOUT_CASE_TIMEOUT_MS: optionalPositiveInteger,
  WORKSPACE_E2E_CHECKOUT_START_TIMEOUT_MS: optionalPositiveInteger,
  WORKSPACE_E2E_CLEANUP_ACTION_TIMEOUT_MS: optionalPositiveInteger,
  WORKSPACE_E2E_CONTACT_CASE_TIMEOUT_MS: optionalPositiveInteger,
  WORKSPACE_E2E_DATABASE_ALLOWLIST: nonEmptyString,
  WORKSPACE_E2E_DATABASE_URL_UNPOOLED: nonEmptyString,
  WORKSPACE_E2E_DATASOURCE_TIMEOUT_MS: optionalPositiveInteger,
  WORKSPACE_E2E_HOSTED_PAYMENT_TIMEOUT_MS: optionalPositiveInteger,
  WORKSPACE_E2E_LOCALE_CASE_TIMEOUT_MS: optionalPositiveInteger,
  WORKSPACE_E2E_PAYMENT_TERMINAL_CASE_TIMEOUT_MS: optionalPositiveInteger,
  WORKSPACE_E2E_POSTHOG_HOST: optionalUrl,
  WORKSPACE_E2E_POSTHOG_PROJECT_TOKEN: optionalNonEmptyString,
  WORKSPACE_E2E_PR_NUMBER: optionalPositiveInteger,
  WORKSPACE_E2E_PROVIDER_TRANSITION_TIMEOUT_MS: optionalPositiveInteger,
  WORKSPACE_E2E_UI_TRANSITION_TIMEOUT_MS: optionalPositiveInteger,
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
      DOTYPOS_API_TIMEOUT: runtimeEnvironment.DOTYPOS_API_TIMEOUT,
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
      WORKSPACE_E2E_ARTIFACT_CAPTURE_TIMEOUT_MS:
        runtimeEnvironment.WORKSPACE_E2E_ARTIFACT_CAPTURE_TIMEOUT_MS,
      WORKSPACE_E2E_BASE_URL: runtimeEnvironment.WORKSPACE_E2E_BASE_URL,
      WORKSPACE_E2E_BROWSER_ACTION_TIMEOUT_MS:
        runtimeEnvironment.WORKSPACE_E2E_BROWSER_ACTION_TIMEOUT_MS,
      WORKSPACE_E2E_BROWSER_NAVIGATION_TIMEOUT_MS:
        runtimeEnvironment.WORKSPACE_E2E_BROWSER_NAVIGATION_TIMEOUT_MS,
      WORKSPACE_E2E_CHECKOUT_CASE_TIMEOUT_MS:
        runtimeEnvironment.WORKSPACE_E2E_CHECKOUT_CASE_TIMEOUT_MS,
      WORKSPACE_E2E_CHECKOUT_START_TIMEOUT_MS:
        runtimeEnvironment.WORKSPACE_E2E_CHECKOUT_START_TIMEOUT_MS,
      WORKSPACE_E2E_CLEANUP_ACTION_TIMEOUT_MS:
        runtimeEnvironment.WORKSPACE_E2E_CLEANUP_ACTION_TIMEOUT_MS,
      WORKSPACE_E2E_CONTACT_CASE_TIMEOUT_MS:
        runtimeEnvironment.WORKSPACE_E2E_CONTACT_CASE_TIMEOUT_MS,
      WORKSPACE_E2E_DATABASE_ALLOWLIST:
        runtimeEnvironment.WORKSPACE_E2E_DATABASE_ALLOWLIST,
      WORKSPACE_E2E_DATABASE_URL_UNPOOLED:
        runtimeEnvironment.WORKSPACE_E2E_DATABASE_URL_UNPOOLED,
      WORKSPACE_E2E_DATASOURCE_TIMEOUT_MS:
        runtimeEnvironment.WORKSPACE_E2E_DATASOURCE_TIMEOUT_MS,
      WORKSPACE_E2E_EXECUTION_CONTEXT:
        runtimeEnvironment.WORKSPACE_E2E_EXECUTION_CONTEXT,
      WORKSPACE_E2E_HOSTED_PAYMENT_TIMEOUT_MS:
        runtimeEnvironment.WORKSPACE_E2E_HOSTED_PAYMENT_TIMEOUT_MS,
      WORKSPACE_E2E_LOCALE_CASE_TIMEOUT_MS:
        runtimeEnvironment.WORKSPACE_E2E_LOCALE_CASE_TIMEOUT_MS,
      WORKSPACE_E2E_PAYMENT_TERMINAL_CASE_TIMEOUT_MS:
        runtimeEnvironment.WORKSPACE_E2E_PAYMENT_TERMINAL_CASE_TIMEOUT_MS,
      WORKSPACE_E2E_POSTHOG_HOST: runtimeEnvironment.WORKSPACE_E2E_POSTHOG_HOST,
      WORKSPACE_E2E_POSTHOG_PROJECT_TOKEN:
        runtimeEnvironment.WORKSPACE_E2E_POSTHOG_PROJECT_TOKEN,
      WORKSPACE_E2E_PR_NUMBER: runtimeEnvironment.WORKSPACE_E2E_PR_NUMBER,
      WORKSPACE_E2E_PROVIDER_TRANSITION_TIMEOUT_MS:
        runtimeEnvironment.WORKSPACE_E2E_PROVIDER_TRANSITION_TIMEOUT_MS,
      WORKSPACE_E2E_UI_TRANSITION_TIMEOUT_MS:
        runtimeEnvironment.WORKSPACE_E2E_UI_TRANSITION_TIMEOUT_MS,
    },
    server: e2eEnvironmentSchema.fields,
  });

export type E2EEnvironment = ReturnType<typeof makeE2EEnvironment>;
