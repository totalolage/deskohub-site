import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { Browser } from "@playwright/test";
import { Effect, Layer, Schema } from "effect";
import { env } from "../../env";
import {
  readWorkspaceE2EAccountJournal,
  workspaceE2EAccountJournalDirectory,
} from "../account/journal";
import type { WorkspaceE2EAccountJournalOwner } from "../account/reconcile";
import { WorkspaceE2EAccountResourceService } from "../account/resources.service";
import {
  resolveWorkspaceE2ESessionSigningSecret,
  signInWorkspaceE2ESyntheticBrowserSession,
} from "../account/seeded-session";
import { openAdminSession } from "../admin-case";
import type { E2EBrowserSession } from "../browser-session";
import { getDatasourceConfig } from "../config";
import { makeWorkspaceE2EEnvironment } from "../e2e-env";
import type { WorkspaceE2EError } from "../errors";
import { E2EDatabase } from "../integrations/database.service";
import {
  type WorkspaceE2ERunId,
  workspaceE2ERunIdSchema,
} from "../run-identifiers";
import {
  assertSafeDatabaseUrl,
  workspaceDir,
  writeJsonAtomically,
} from "../runtime";
import { workspaceE2ETimeouts } from "../timeouts";
import { requireBaseUrl } from "./navigation-test-helpers";

/**
 * Instant navigation runs beside the checkout graph with its own Playwright
 * output directory, which Playwright clears at start, so its seeded
 * administrator keeps its journal and run id there instead of in the
 * checkout suite's artifacts. Its own teardown project reconciles them.
 */
const instantNavigationJournalDirectory =
  workspaceE2EAccountJournalDirectory("instant-navigation");
const administratorRunPath = resolve(
  workspaceDir,
  "e2e-artifacts",
  "instant-navigation",
  "administrator-run.json"
);

export const instantNavigationAdministratorLabel = "nav-admin";

export const instantNavigationAdministratorJournalOwner = {
  journalDirectory: instantNavigationJournalDirectory,
  ownerId: "instant-navigation-administrator",
  recipientLabels: [instantNavigationAdministratorLabel],
} as const satisfies WorkspaceE2EAccountJournalOwner;

/**
 * A seeded administrator needs the protected preview's database and session
 * secret. Local runs against `next dev` have neither, so they skip the
 * administration navigation instead of signing in another way.
 */
export const instantNavigationAdministratorSkipReason =
  env.WORKSPACE_E2E_BASE_URL === undefined
    ? "Administration navigation signs in a seeded administrator and needs a protected preview target (WORKSPACE_E2E_BASE_URL) and its E2E database"
    : undefined;

/**
 * The E2E environment and preview database the administrator setup, the
 * signed-in tests, and the teardown share.
 */
export const makeInstantNavigationAdministratorRuntime = () => {
  const environment = makeWorkspaceE2EEnvironment();
  const datasourceConfig = getDatasourceConfig(environment);
  assertSafeDatabaseUrl(
    datasourceConfig.databaseUrlUnpooled,
    "WORKSPACE_E2E_DATABASE_URL_UNPOOLED",
    environment.WORKSPACE_E2E_DATABASE_ALLOWLIST
  );
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
  return { datasourceConfig, environment, runPromise };
};

const administratorRunSchema = Schema.Struct({
  runId: workspaceE2ERunIdSchema,
});

/** Persisted before the journal, so teardown derives the same recipient. */
export const writeInstantNavigationAdministratorRunId = (
  runId: WorkspaceE2ERunId
) => writeJsonAtomically(administratorRunPath, { runId });

/** The setup's run id, or undefined when the setup never recorded one. */
export const readInstantNavigationAdministratorRunId = async (): Promise<
  WorkspaceE2ERunId | undefined
> => {
  let serialized: string;
  try {
    serialized = await readFile(administratorRunPath, "utf8");
  } catch (cause) {
    if (cause instanceof Error && "code" in cause && cause.code === "ENOENT") {
      return undefined;
    }
    throw cause;
  }
  return Schema.decodeUnknownSync(administratorRunSchema)(
    JSON.parse(serialized)
  ).runId;
};

/**
 * Runs `use` with a browser session for one test, primed for the preview and
 * signed in as the administrator the setup project seeded, with a fresh
 * short-lived session, under the admin failure policy (`openAdminSession`).
 * The session closes once `use` settles.
 */
export const withInstantNavigationAdministratorSession = async (
  input: {
    readonly baseURL: string | undefined;
    readonly browser: Browser;
  },
  use: (session: E2EBrowserSession) => Promise<void>
) => {
  const { environment, runPromise } =
    makeInstantNavigationAdministratorRuntime();
  const journal = await readWorkspaceE2EAccountJournal(
    instantNavigationAdministratorJournalOwner.ownerId,
    instantNavigationAdministratorJournalOwner.journalDirectory
  );
  const [accountId, ...others] = journal?.authUserIds ?? [];
  if (accountId === undefined || others.length > 0) {
    throw new Error(
      "The administrator setup project did not journal exactly one seeded administrator"
    );
  }
  const baseURL = requireBaseUrl(input.baseURL);
  await runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const { origin, session } = yield* openAdminSession({
          baseURL,
          browser: input.browser,
          caseName: "instant-navigation-administrator",
        });
        yield* session.primePreviewAccess(
          origin,
          environment.VERCEL_AUTOMATION_BYPASS_SECRET,
          { timeoutMs: workspaceE2ETimeouts.browserAction }
        );
        yield* signInWorkspaceE2ESyntheticBrowserSession({
          accountId,
          origin,
          secret: resolveWorkspaceE2ESessionSigningSecret(environment),
          session,
        });
        yield* Effect.promise(() => use(session));
      })
    )
  );
};
