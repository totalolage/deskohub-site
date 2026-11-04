import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Clock, Effect } from "effect";
import { getDatasourceConfig } from "./config";
import type { E2EEnvironment } from "./e2e-env";
import { tryWorkspaceE2EPromise, workspaceE2EError } from "./errors";
import { E2EDatabase } from "./integrations/database.service";
import { getDotyposLayer } from "./integrations/dotypos";
import {
  enumerateRunOwnedReservations,
  readRunOwnedReservationRows,
} from "./integrations/owned-reservations";
import { workspaceDir } from "./runtime";
import {
  evidenceDigest,
  type NativeRunReceipt,
  nativeTimestamp,
} from "./soak-native";
import { readRunOwnership } from "./soak-ownership";

/** No raw journal, owner, provider identifier or error reaches the job log. */
export const captureSoakEvidence = Effect.fn("E2E.captureSoakEvidence")(
  function* (environment: E2EEnvironment, native: NativeRunReceipt) {
    const config = getDatasourceConfig(environment);
    const ownership = yield* tryWorkspaceE2EPromise(
      "read reservation ownership coverage",
      () => readRunOwnership(environment)
    );
    const rows = yield* Effect.scoped(
      readRunOwnedReservationRows(ownership).pipe(
        Effect.provide(E2EDatabase.layer(config))
      )
    );
    const cleanup = yield* enumerateRunOwnedReservations(ownership, rows).pipe(
      Effect.provide(getDotyposLayer(config)),
      Effect.timeout(config.timeouts.datasource)
    );
    const sourceSha256 = yield* tryWorkspaceE2EPromise(
      "hash evidence source",
      evidenceSourceDigest
    );
    const capturedAt = nativeTimestamp(yield* Clock.currentTimeNanos);
    if (capturedAt < native.completedAt) {
      return yield* workspaceE2EError("Evidence clock ordering failed");
    }
    const receipt = makeSoakReceipt({
      environment,
      native,
      cleanup,
      sourceSha256,
      capturedAt,
      journalCount: ownership.journalCount,
      intentCount: ownership.intents.length,
    });
    yield* writeSoakReceipt(receipt);
  }
);

/** Publish only explicitly selected fields, never whole private projections. */
export const makeSoakReceipt = ({
  environment,
  native,
  cleanup,
  sourceSha256,
  capturedAt,
  journalCount,
  intentCount,
}: {
  readonly environment: Pick<
    E2EEnvironment,
    "GITHUB_RUN_ID" | "GITHUB_RUN_ATTEMPT" | "TARGET_SHA"
  >;
  readonly native: NativeRunReceipt;
  readonly cleanup: Effect.Success<
    ReturnType<typeof enumerateRunOwnedReservations>
  >;
  readonly sourceSha256: string;
  readonly capturedAt: string;
  readonly journalCount: number;
  readonly intentCount: number;
}) => {
  return {
    schema: 1,
    runId: Number(environment.GITHUB_RUN_ID),
    attempt: environment.GITHUB_RUN_ATTEMPT,
    targetSha: environment.TARGET_SHA,
    sourceSha256,
    nativeRun: {
      service: native.service,
      scope: native.scope,
      outcome: native.outcome,
      startedAt: native.startedAt,
      completedAt: native.completedAt,
      spanSha256: native.spanSha256,
      querySha256: evidenceDigest(JSON.stringify({ sourceSha256, native })),
    },
    cleanup: {
      mode: "authorized-aggregate",
      scope: "all-run-owned-e2e-reservations",
      ownedActiveCount: cleanup.ownedActiveCount,
      capturedAt,
      coverageComplete: true,
      journalCount,
      intentCount,
      intervalCount: cleanup.intervalCount,
      pageCount: cleanup.pageCount,
      customerCount: cleanup.customerCount,
      parametersSha256: cleanup.parametersSha256,
      responseSha256: cleanup.responseSha256,
      querySha256: evidenceDigest(JSON.stringify({ sourceSha256, cleanup })),
    },
  };
};

export const writeSoakReceipt = (receipt: ReturnType<typeof makeSoakReceipt>) =>
  tryWorkspaceE2EPromise(
    "write sanitized soak evidence",
    () =>
      new Promise<void>((resolveWrite, rejectWrite) => {
        process.stdout.write(
          `C18_SOAK_EVIDENCE ${JSON.stringify(receipt)}\n`,
          (error) =>
            error
              ? rejectWrite(new Error("Evidence write failed"))
              : resolveWrite()
        );
      })
  );

/** Hash the executed E2E code and the actual provider query/decoder source. */
export const evidenceSourceDigest = async () => {
  const root = resolve(workspaceDir, "../..");
  const files: string[] = [];
  const visit = async (path: string) => {
    for (const item of await readdir(resolve(root, path), {
      withFileTypes: true,
    })) {
      if (item.isDirectory()) await visit(`${path}/${item.name}`);
      else if (item.name.endsWith(".ts") || item.name.endsWith(".tsx"))
        files.push(`${path}/${item.name}`);
    }
  };
  await visit("apps/deskohub-workspace/e2e");
  await visit("packages/dotypos/src");
  files.push("apps/deskohub-workspace/db/schema/workspace-reservations.ts");
  const digests = await Promise.all(
    files
      .toSorted()
      .map(async (path) => [
        path,
        evidenceDigest(await readFile(resolve(root, path), "utf8")),
      ])
  );
  return evidenceDigest(JSON.stringify(digests));
};
