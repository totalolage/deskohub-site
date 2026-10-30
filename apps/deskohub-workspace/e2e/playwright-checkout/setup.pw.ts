import "../../shared/polyfills/temporal";

import { expect, test } from "@playwright/test";
import { Effect } from "effect";
import { makeWorkspaceE2ECases } from "../cases";
import { prepareDiscountAvailabilityE2E } from "../cases/discounts";
import { prepareMeetingRoomE2E } from "../cases/meeting-room";
import { prepareOfficeE2E } from "../cases/office";
import { assertNexiSandbox, getConfig, getDatasourceConfig } from "../config";
import {
  prepareWorkspaceE2EHostedPaymentPermitQueue,
  workspaceE2EHostedPaymentPermitDirectory,
} from "../coordination/hosted-payment-permit.service";
import { makeWorkspaceE2EEnvironment } from "../e2e-env";
import { assertE2ECalendarSaleCoverage } from "../integrations/calendar-sale-coverage";
import { seedDiscountE2EFixtures } from "../integrations/discount-fixtures";
import { resolveE2EDotyposDiscountGroup } from "../integrations/dotypos";
import { assertPreviewEndpointsReady } from "../preview-readiness";
import { addDatabaseUrlRedactions, assertSafeDatabaseUrl } from "../runtime";
import { E2ETelemetryService } from "../services/telemetry";
import {
  isWorkspaceE2EOfficeCaseId,
  workspaceE2ECaseIds,
} from "./case-catalog";
import {
  resolveWorkspaceE2ERunContext,
  writeWorkspaceE2ERunContext,
} from "./run-context";
import { writeWorkspaceE2ERunPlan } from "./run-plan";
import { withWorkspaceE2ERuntime } from "./runtime-fixtures";

// Readiness, seeding, availability preparation, and plan construction share
// one test so the case phase waits for a single Playwright phase barrier and
// worker start instead of one per preparation stage.
test("prepare the workspace checkout run", async ({ browser }) => {
  const environment = makeWorkspaceE2EEnvironment();
  const config = getConfig(environment);
  const datasourceConfig = getDatasourceConfig(environment);
  const runContext = resolveWorkspaceE2ERunContext(environment);
  assertSafeDatabaseUrl(
    datasourceConfig.databaseUrl,
    "DATABASE_URL",
    environment.WORKSPACE_E2E_DATABASE_ALLOWLIST
  );
  assertSafeDatabaseUrl(
    datasourceConfig.databaseUrlUnpooled,
    "WORKSPACE_E2E_DATABASE_URL_UNPOOLED",
    environment.WORKSPACE_E2E_DATABASE_ALLOWLIST
  );
  assertNexiSandbox(datasourceConfig.nexiApiOrigin);
  addDatabaseUrlRedactions(
    environment.WORKSPACE_E2E_PROVIDER_PERMIT_DATABASE_URL
  );
  // Cleanup recovery runs only when this file exists, so every lease, seed,
  // and provider effect below must follow it.
  await writeWorkspaceE2ERunContext(runContext);
  await prepareWorkspaceE2EHostedPaymentPermitQueue(
    workspaceE2EHostedPaymentPermitDirectory(runContext.runId)
  );

  const { actualCaseIds, preparation } = await withWorkspaceE2ERuntime(
    environment,
    runContext,
    (runEffect) =>
      runEffect(
        Effect.gen(function* () {
          const telemetry = yield* E2ETelemetryService;
          // Availability preparation reads the preview and the seeded
          // discount rows, so it waits for both; provider preparation reads
          // only Dotypos and overlaps them.
          const availability = Effect.all(
            [
              telemetry.tracePhase({
                effect: assertPreviewEndpointsReady(config),
                phaseId: "preview-readiness",
              }),
              telemetry.tracePhase({
                effect: seedDiscountE2EFixtures,
                phaseId: "fixture-seeding",
              }),
            ],
            { concurrency: "unbounded" }
          ).pipe(
            Effect.andThen(
              Effect.all(
                {
                  discounts: telemetry.tracePhase({
                    effect: prepareDiscountAvailabilityE2E(
                      config,
                      runContext.allocation
                    ),
                    phaseId: "cowork-availability-preparation",
                  }),
                  meetingRoom: telemetry.tracePhase({
                    effect: prepareMeetingRoomE2E(
                      config,
                      runContext.allocation
                    ),
                    phaseId: "meeting-room-availability-preparation",
                  }),
                  office: telemetry.tracePhase({
                    effect: prepareOfficeE2E(config, runContext.allocation),
                    phaseId: "office-availability-preparation",
                  }),
                },
                { concurrency: "unbounded" }
              )
            )
          );
          const { availability: prepared, customerDiscountGroup } =
            yield* Effect.all(
              {
                availability,
                customerDiscountGroup: telemetry.tracePhase({
                  effect: resolveE2EDotyposDiscountGroup(datasourceConfig),
                  phaseId: "provider-preparation",
                }),
              },
              { concurrency: "unbounded" }
            );
          const preparation = { ...prepared, customerDiscountGroup };
          yield* assertE2ECalendarSaleCoverage({
            browser,
            candidateDates: [
              ...prepared.discounts.availableBasicDates,
              ...prepared.discounts.availablePlusDates,
              ...prepared.discounts.availableReservedDeskDates,
            ],
            config,
          });
          const cases = yield* makeWorkspaceE2ECases({
            allocation: runContext.allocation,
            config,
            datasourceConfig,
            flowStates: [],
            preparation,
          });
          return {
            actualCaseIds: cases.map(({ id }) => id).toSorted(),
            preparation,
          };
        })
      )
  );

  const expectedCaseIds = workspaceE2ECaseIds.filter(
    (caseId) =>
      preparation.office !== undefined || !isWorkspaceE2EOfficeCaseId(caseId)
  );
  expect(actualCaseIds).toEqual([...expectedCaseIds].toSorted());
  await writeWorkspaceE2ERunPlan({ preparation, runContext, version: 2 });
});
