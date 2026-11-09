import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { type Browser, test as base } from "@playwright/test";
import { Effect, Schema } from "effect";
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
import type { E2EDatabase } from "../integrations/database.service";
import {
  type WorkspaceE2ERunId,
  workspaceE2ERunIdSchema,
} from "../run-identifiers";
import {
  assertSafeDatabaseUrl,
  workspaceDir,
  writeJsonAtomically,
} from "../runtime";
import { type E2EEffectRunner, withE2ERuntime } from "../runtime-fixture";
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

const makeInstantNavigationAdministratorTarget = () => {
  const environment = makeWorkspaceE2EEnvironment();
  const datasourceConfig = getDatasourceConfig(environment);
  assertSafeDatabaseUrl(
    datasourceConfig.databaseUrlUnpooled,
    "WORKSPACE_E2E_DATABASE_URL_UNPOOLED",
    environment.WORKSPACE_E2E_DATABASE_ALLOWLIST
  );
  return { datasourceConfig, environment };
};

type InstantNavigationAdministratorRuntime = ReturnType<
  typeof makeInstantNavigationAdministratorTarget
> & {
  readonly runEffect: E2EEffectRunner<
    E2EDatabase | WorkspaceE2EAccountResourceService
  >;
};

/**
 * `administratorRuntime` is the E2E environment and preview database the
 * administrator setup, the signed-in tests, and the teardown share: one
 * runtime, with one database pool, per Playwright worker. It reads the
 * environment when a test first uses it, so skip the file, or the test in a
 * hook, before then. `administrator` gives every test its own browser
 * session, signed in as the administrator the setup project seeded with its
 * own short-lived session.
 */
export const instantNavigationAdministratorTest = base.extend<
  { readonly administrator: E2EBrowserSession },
  { readonly administratorRuntime: InstantNavigationAdministratorRuntime }
>({
  administrator: async ({ administratorRuntime, baseURL, browser }, use) =>
    withInstantNavigationAdministratorSession(
      { baseURL, browser, runtime: administratorRuntime },
      use
    ),
  administratorRuntime: [
    async ({ browserName: _browserName }, use) => {
      const target = makeInstantNavigationAdministratorTarget();
      await withE2ERuntime(
        {
          layer: WorkspaceE2EAccountResourceService.layerWithDatabase(
            target.datasourceConfig
          ),
        },
        (runEffect) => use({ ...target, runEffect })
      );
    },
    { scope: "worker" },
  ],
});

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
const withInstantNavigationAdministratorSession = async (
  input: {
    readonly baseURL: string | undefined;
    readonly browser: Browser;
    readonly runtime: InstantNavigationAdministratorRuntime;
  },
  use: (session: E2EBrowserSession) => Promise<void>
) => {
  const { environment, runEffect } = input.runtime;
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
  await runEffect(
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
