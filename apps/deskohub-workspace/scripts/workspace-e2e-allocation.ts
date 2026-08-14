import { appendFile } from "node:fs/promises";
import { NodeRuntime } from "@effect/platform-node";
import * as PgClient from "@effect/sql-pg/PgClient";
import { Effect, Layer, Redacted, Schema } from "effect";
import { FetchHttpClient } from "effect/unstable/http";
import { normalizePostgresConnectionUrl } from "../db/postgres-connection-url";
import { supportedAllocationConcurrency } from "../e2e/coordination/allocation";
import { AllocationRepository } from "../e2e/coordination/allocation.repository";
import {
  AllocationService,
  releaseAllocationOnFailure,
} from "../e2e/coordination/allocation.service";
import { AllocationRuntimeConfig } from "../e2e/coordination/config";
import { GithubRunStatusService } from "../e2e/coordination/github-run-status.service";

const positiveIntegerFromString = Schema.FiniteFromString.check(
  Schema.isInt()
).check(Schema.isGreaterThan(0));
const allocationShardFromString = positiveIntegerFromString.check(
  Schema.isLessThanOrEqualTo(supportedAllocationConcurrency)
);

const Environment = Schema.Struct({
  GITHUB_API_URL: Schema.NonEmptyString,
  GITHUB_OUTPUT: Schema.NonEmptyString,
  GITHUB_REPOSITORY: Schema.String.check(
    Schema.isPattern(/^[^/\s]+\/[^/\s]+$/)
  ),
  GITHUB_RUN_ATTEMPT: positiveIntegerFromString,
  GITHUB_RUN_ID: positiveIntegerFromString,
  WORKSPACE_E2E_ALLOCATION_MODE: Schema.Literals(["acquire", "release"]),
  WORKSPACE_E2E_ALLOCATION_PREFERRED_SHARD: allocationShardFromString,
  WORKSPACE_E2E_ALLOCATION_TOKEN: Schema.NonEmptyString,
  WORKSPACE_E2E_ALLOCATION_WAIT_SECONDS: positiveIntegerFromString,
  WORKSPACE_E2E_COORDINATOR_DATABASE_URL: Schema.NonEmptyString,
});

type Environment = typeof Environment.Type;

const run = Effect.fn("WorkspaceE2EAllocation.run")(function* (
  environment: Environment
) {
  const allocation = yield* AllocationService;
  const owner = {
    repository: environment.GITHUB_REPOSITORY,
    runAttempt: environment.GITHUB_RUN_ATTEMPT,
    runId: environment.GITHUB_RUN_ID,
  };

  if (environment.WORKSPACE_E2E_ALLOCATION_MODE === "release") {
    yield* allocation.release(owner);
    return;
  }

  const acquireAndPublish = allocation
    .acquire({
      owner,
      preferredShard: environment.WORKSPACE_E2E_ALLOCATION_PREFERRED_SHARD,
      waitSeconds: environment.WORKSPACE_E2E_ALLOCATION_WAIT_SECONDS,
    })
    .pipe(
      Effect.tap((shard) =>
        Effect.tryPromise({
          try: () =>
            appendFile(environment.GITHUB_OUTPUT, `shard=${shard}\n`, "utf8"),
          catch: (cause) => cause,
        })
      ),
      Effect.tap((shard) =>
        Effect.log(
          `Workspace E2E allocation acquired shard ${shard} of ${supportedAllocationConcurrency}`
        )
      )
    );

  yield* releaseAllocationOnFailure(
    acquireAndPublish,
    allocation.release(owner)
  );
});

const program = Schema.decodeUnknownEffect(Environment)(process.env).pipe(
  Effect.flatMap((environment) => {
    const runtimeConfig = AllocationRuntimeConfig.layer({
      githubApiUrl: environment.GITHUB_API_URL,
      githubToken: Redacted.make(environment.WORKSPACE_E2E_ALLOCATION_TOKEN),
    });
    const repository = AllocationRepository.Default.pipe(
      Layer.provide(
        PgClient.layer({
          applicationName: "workspace-e2e-allocation",
          connectTimeout: "10 seconds",
          maxConnections: 1,
          url: Redacted.make(
            normalizePostgresConnectionUrl(
              environment.WORKSPACE_E2E_COORDINATOR_DATABASE_URL
            )
          ),
        })
      )
    );
    const runStatus = GithubRunStatusService.Default.pipe(
      Layer.provide(Layer.merge(runtimeConfig, FetchHttpClient.layer))
    );
    const allocation = AllocationService.Default.pipe(
      Layer.provide(Layer.merge(repository, runStatus))
    );

    return run(environment).pipe(Effect.provide(allocation));
  }),
  Effect.tapError((error) =>
    Effect.logError(
      error instanceof Error
        ? error.message
        : "Workspace E2E allocation failed."
    )
  )
);

NodeRuntime.runMain(program, { disableErrorReporting: true });
