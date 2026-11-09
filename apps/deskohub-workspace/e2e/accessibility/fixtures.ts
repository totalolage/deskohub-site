import { test as base } from "@playwright/test";
import { requireBaseUrl } from "../instant-navigation/navigation-test-helpers";
import type { E2EDatabase } from "../integrations/database.service";
import { type E2EEffectRunner, withE2ERuntime } from "../runtime-fixture";
import {
  localDatabaseLayer,
  type SeededAccountRuntime,
  withSeededAccountRuntime,
} from "./audit-target";

/**
 * One runtime per Playwright worker for each database the audit seeds, so
 * every fixture in the worker shares its pool. `localDatabase` connects on
 * its first use. `seededAccounts` resolves the audited deployment as the
 * worker first uses it and throws without one, so a file that uses it skips
 * on `seededAccountSkipReason` at its top level.
 */
export const accessibilityTest = base.extend<
  Record<never, never>,
  {
    readonly localDatabase: E2EEffectRunner<E2EDatabase>;
    readonly seededAccounts: SeededAccountRuntime;
  }
>({
  localDatabase: [
    async ({ browserName: _browserName }, use) =>
      withE2ERuntime({ layer: localDatabaseLayer }, use),
    { scope: "worker" },
  ],
  seededAccounts: [
    async ({ browserName: _browserName }, use, workerInfo) =>
      withSeededAccountRuntime(
        new URL(requireBaseUrl(workerInfo.project.use.baseURL)).origin,
        use
      ),
    { scope: "worker" },
  ],
});
