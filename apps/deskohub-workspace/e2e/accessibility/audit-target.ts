import { Effect, Layer } from "effect";
import { parseBetterAuthSecrets } from "@/features/account/backend/auth/auth-secrets";
import { WorkspaceE2EAccountResourceService } from "../account/resources.service";
import {
  resolveWorkspaceE2ESessionSigningSecret,
  type WorkspaceE2ESessionSigningSecret,
} from "../account/seeded-session";
import {
  assertNexiSandbox,
  type DatasourceConfig,
  getDatasourceConfig,
} from "../config";
import { makeE2EEnvironment, makeWorkspaceE2EEnvironment } from "../e2e-env";
import type { WorkspaceE2EError } from "../errors";
import { E2EDatabase } from "../integrations/database.service";
import { assertSafeDatabaseUrl } from "../runtime";
import { workspaceE2ETimeouts } from "../timeouts";

/**
 * The audit runs against a protected preview (`WORKSPACE_E2E_BASE_URL`), a
 * separately started server (`WORKSPACE_ACCESSIBILITY_BASE_URL`), or the
 * `next dev` server the config starts. That server reads the disposable
 * `WORKSPACE_TEST_DATABASE_URL` database and the test environment's
 * synthetic secrets, which this process shares.
 */
const previewTarget = process.env.WORKSPACE_E2E_BASE_URL !== undefined;
const localDatabaseUrl =
  process.env.WORKSPACE_ACCESSIBILITY_BASE_URL === undefined
    ? process.env.WORKSPACE_TEST_DATABASE_URL
    : undefined;

/**
 * Fixture rows the audit reads through a deployment's own access checks, such
 * as a reservation opened with an access token, need the local server: the
 * suite holds its synthetic `RESERVATION_ACCESS_TOKEN_SECRET`, never a
 * preview's.
 */
export const localFixtureSkipReason =
  localDatabaseUrl !== undefined && !previewTarget
    ? undefined
    : "Seeded reservation states need the next dev server this suite starts on a disposable WORKSPACE_TEST_DATABASE_URL database";

const placeholderHostSuffix = ".example";

/**
 * Reservation forms need live availability (Dotypos and Google Calendar),
 * and seeded accounts a Dotypos profile. A preview has its sandboxes. Locally
 * the server gets them only when the run passes the app's development sandbox
 * credentials explicitly (`bun --env-file=.env.local
 * --env-file=.env.development.local run test:accessibility`); otherwise the
 * test environment's placeholders stand in and nothing loads.
 */
export const sandboxSkipReason = (() => {
  if (previewTarget) return undefined;
  const dotyposHost = URL.parse(process.env.DOTYPOS_API_URL ?? "")?.hostname;
  return dotyposHost === undefined ||
    dotyposHost.endsWith(placeholderHostSuffix)
    ? "Needs the Dotypos and Google Calendar sandboxes: pass the development sandbox credentials (bun --env-file=.env.local --env-file=.env.development.local run test:accessibility) or target a protected preview"
    : undefined;
})();

/**
 * Seeded accounts need a deployment whose session store and signing secret
 * the suite can reach, and the sandboxes for their linked profile. A
 * separately started server offers neither.
 */
export const seededAccountSkipReason =
  sandboxSkipReason ??
  (previewTarget || localDatabaseUrl !== undefined
    ? undefined
    : "Seeded accounts need a protected preview (WORKSPACE_E2E_BASE_URL and its E2E database) or the next dev server this suite starts on a disposable WORKSPACE_TEST_DATABASE_URL database");

/** Runs an E2E database effect against the local server's database. */
export const runWithLocalDatabase = <A>(
  effect: Effect.Effect<A, WorkspaceE2EError, E2EDatabase>
) => {
  if (localFixtureSkipReason !== undefined || localDatabaseUrl === undefined) {
    throw new Error(localFixtureSkipReason);
  }
  return Effect.runPromise(
    effect.pipe(
      Effect.provide(
        E2EDatabase.layer({
          databaseUrlUnpooled: localDatabaseUrl,
          timeouts: workspaceE2ETimeouts,
        })
      )
    )
  );
};

type SeededAccountTarget = {
  readonly datasourceConfig: DatasourceConfig;
  readonly secret: WorkspaceE2ESessionSigningSecret;
};

/**
 * A preview's E2E datasource behind the database allowlist, signed with the
 * runner's copy of the Preview `BETTER_AUTH_SECRETS`. Locally, the suite's
 * database, the sandbox credentials the server loaded, and the synthetic
 * secret the test environment gives the server.
 */
const resolveSeededAccountTarget = (origin: string): SeededAccountTarget => {
  if (previewTarget) {
    const environment = makeWorkspaceE2EEnvironment();
    const datasourceConfig = getDatasourceConfig(environment);
    assertSafeDatabaseUrl(
      datasourceConfig.databaseUrlUnpooled,
      "WORKSPACE_E2E_DATABASE_URL_UNPOOLED",
      environment.WORKSPACE_E2E_DATABASE_ALLOWLIST
    );
    return {
      datasourceConfig,
      secret: resolveWorkspaceE2ESessionSigningSecret(environment),
    };
  }
  const secrets = parseBetterAuthSecrets(process.env.BETTER_AUTH_SECRETS);
  if (
    seededAccountSkipReason !== undefined ||
    localDatabaseUrl === undefined ||
    secrets.kind === "invalid"
  ) {
    throw new Error(
      seededAccountSkipReason ??
        "The local server's synthetic BETTER_AUTH_SECRETS is invalid"
    );
  }
  const datasourceConfig = getDatasourceConfig(
    makeE2EEnvironment({
      ...process.env,
      DATABASE_URL: localDatabaseUrl,
      WORKSPACE_E2E_BASE_URL: origin,
      WORKSPACE_E2E_DATABASE_ALLOWLIST: localDatabaseUrl,
      WORKSPACE_E2E_DATABASE_URL_UNPOOLED: localDatabaseUrl,
    })
  );
  assertNexiSandbox(datasourceConfig.nexiApiOrigin);
  return { datasourceConfig, secret: { value: secrets.secrets[0].value } };
};

/**
 * Runs the E2E fixtures that seed, sign in, and reconcile synthetic accounts
 * against the audited deployment's database and Dotypos sandbox.
 */
export const makeSeededAccountRuntime = (origin: string) => {
  const { datasourceConfig, secret } = resolveSeededAccountTarget(origin);
  const layer = WorkspaceE2EAccountResourceService.layer(datasourceConfig).pipe(
    Layer.provideMerge(E2EDatabase.layer(datasourceConfig))
  );
  const runPromise = <A>(
    effect: Effect.Effect<
      A,
      WorkspaceE2EError,
      E2EDatabase | WorkspaceE2EAccountResourceService
    >
  ) => Effect.runPromise(effect.pipe(Effect.provide(layer)));
  return { datasourceConfig, runPromise, secret };
};
