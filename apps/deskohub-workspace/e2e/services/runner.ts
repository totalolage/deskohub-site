import * as PgClient from "@effect/sql-pg/PgClient";
import { Effect, Layer, Redacted } from "effect";
import { FetchHttpClient } from "effect/unstable/http";
import { normalizePostgresConnectionUrl } from "../../db/postgres-connection-url";
import { getDatasourceConfig } from "../config";
import { WorkspaceE2EProviderVerificationPermitService } from "../coordination/provider-verification-permit.service";
import type { WorkspaceE2EEnvironment } from "../e2e-env";
import { toWorkspaceE2EError } from "../errors";
import { E2EDatabase } from "../integrations/database.service";
import { addDatabaseUrlRedactions } from "../runtime";
import { WorkspaceE2ECaseService } from "./cases";
import { WorkspaceE2ECleanupService } from "./cleanup";
import {
  type E2ERunContext,
  E2ERunContextService,
  E2ETelemetryService,
} from "./telemetry";

export const makeWorkspaceE2ECaseRuntimeLive = (
  environment: WorkspaceE2EEnvironment,
  runContext: E2ERunContext
) => {
  addDatabaseUrlRedactions(
    environment.WORKSPACE_E2E_PROVIDER_PERMIT_DATABASE_URL
  );
  const datasourceConfig = getDatasourceConfig(environment);
  const support = Layer.mergeAll(
    FetchHttpClient.layer,
    WorkspaceE2ECleanupService.Default,
    makeWorkspaceE2EProviderVerificationPermitLive(environment),
    E2ETelemetryService.Default.pipe(
      Layer.provideMerge(E2ERunContextService.layerValue(runContext))
    ),
    E2EDatabase.layer(datasourceConfig)
  );

  return WorkspaceE2ECaseService.Default.pipe(Layer.provideMerge(support));
};

const makeWorkspaceE2EProviderVerificationPermitLive = (
  environment: WorkspaceE2EEnvironment
) => {
  const database = PgClient.layer({
    applicationName: "workspace-e2e-provider-verification",
    connectTimeout: "10 seconds",
    maxConnections: 2,
    url: Redacted.make(
      normalizePostgresConnectionUrl(
        environment.WORKSPACE_E2E_PROVIDER_PERMIT_DATABASE_URL
      )
    ),
  }).pipe(
    Layer.catch((cause) =>
      Layer.effect(
        PgClient.PgClient,
        Effect.fail(
          toWorkspaceE2EError(
            "connect to provider permit coordination database",
            cause
          )
        )
      )
    )
  );

  return WorkspaceE2EProviderVerificationPermitService.Default.pipe(
    Layer.provide(database)
  );
};
