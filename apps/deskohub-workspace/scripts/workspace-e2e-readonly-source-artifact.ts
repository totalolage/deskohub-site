import { createHash } from "node:crypto";
import {
  appendFile,
  chmod,
  copyFile,
  lstat,
  mkdir,
  readdir,
  readFile,
} from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { Schema } from "effect";
import { workspaceE2ECaseIds } from "../e2e/playwright-checkout/case-catalog";

const expectedSourceRunId = "37580940745";
const expectedSourceRunAttempt = 1;
const expectedTargetSha = "d027de04a101a7f018960b81e164d53eb36d26cc";
const expectedPrNumber = 464;
const expectedManifestSha256 =
  "7736b918ac4c6a45675c997cbbf226e9dfd9e8047454bc9a492226f34b5e30e1";
const expectedManifestPath = join(
  import.meta.dir,
  "../e2e/fixtures/cleanup-artifact-hashes-37580940745-1.json"
);
const expectedCheckoutJournalCount = 33;
const expectedArtifactFileCount = 36;
const expectedStateCount = 36;
const expectedCompletedMarkerCount = 36;

const stringRecordSchema = Schema.Record(Schema.String, Schema.Unknown);
const sourceRunContextSchema = Schema.Struct({
  allocation: Schema.Struct({
    fromOffsetDays: Schema.Finite,
    shardCount: Schema.Finite,
    shardIndex: Schema.Finite,
    toOffsetDays: Schema.Finite,
  }),
  executionContext: Schema.Literals(["ci", "manual"]),
  githubRunAttempt: Schema.optionalKey(Schema.Finite),
  githubRunId: Schema.optionalKey(Schema.String),
  prNumber: Schema.optionalKey(Schema.Finite),
  runId: Schema.String,
  targetSha: Schema.optionalKey(Schema.String),
});
const sourceRunPlanSchema = Schema.Struct({
  preparation: stringRecordSchema,
  runContext: sourceRunContextSchema,
  version: Schema.Literal(2),
});
const sourceAccountJournalSchema = Schema.Struct({
  authUserIds: Schema.Array(Schema.String),
  completed: Schema.Boolean,
  dotyposCustomerIds: Schema.Array(Schema.String),
  dotyposReservationIds: Schema.Array(Schema.String),
  laneId: Schema.Literal("account-lane"),
  startedAt: Schema.String,
  version: Schema.Literal(1),
});
const sourceCheckoutStateSchema = Schema.Struct({
  completedDotyposReservationId: Schema.optionalKey(Schema.String),
  data: stringRecordSchema,
  orderId: Schema.optionalKey(Schema.String),
  startedAt: Schema.optionalKey(Schema.String),
});
const sourceCheckoutJournalSchema = Schema.Struct({
  caseId: Schema.String,
  checkoutStates: Schema.Array(sourceCheckoutStateSchema),
  startedAt: Schema.String,
  version: Schema.Literal(2),
});
const frozenManifestSchema = Schema.Struct({
  fileCount: Schema.Literal(expectedArtifactFileCount),
  files: Schema.Array(
    Schema.Struct({
      path: Schema.String,
      sha256: Schema.String,
      sizeBytes: Schema.Finite,
    })
  ),
  runId: Schema.Literal(`${expectedSourceRunId}-${expectedSourceRunAttempt}`),
  targetSha: Schema.Literal(expectedTargetSha),
});

const requiredPath = (name: string) => {
  const value = process.env[name];
  if (!value) throw new Error("required_path_missing");
  return resolve(value);
};

const readJson = async <S extends Schema.Decoder<unknown>>(
  schema: S,
  path: string
): Promise<S["Type"]> =>
  Schema.decodeUnknownSync(schema)(JSON.parse(await readFile(path, "utf8")));

const sha256 = (value: Uint8Array | string) =>
  createHash("sha256").update(value).digest("hex");

const isPinnedArtifactPath = (path: string) =>
  /^(?:run-context|run-plan)\.json$|^cleanup-journals\/[A-Za-z0-9-]+\.json$/.test(
    path
  );

export const decodeFrozenManifestText = (manifestText: string) => {
  if (sha256(manifestText) !== expectedManifestSha256) {
    throw new Error("frozen_source_manifest_pin_mismatch");
  }
  const manifest = Schema.decodeUnknownSync(frozenManifestSchema)(
    JSON.parse(manifestText)
  );
  const paths = manifest.files.map(({ path }) => path);
  if (
    manifest.files.length !== expectedArtifactFileCount ||
    new Set(paths).size !== paths.length ||
    manifest.files.some(
      ({ path, sha256: fileHash, sizeBytes }) =>
        !isPinnedArtifactPath(path) ||
        !/^[0-9a-f]{64}$/.test(fileHash) ||
        !Number.isSafeInteger(sizeBytes) ||
        sizeBytes < 0
    )
  ) {
    throw new Error("frozen_source_manifest_shape_invalid");
  }
  return manifest;
};

const readFrozenManifest = async () =>
  decodeFrozenManifestText(await readFile(expectedManifestPath, "utf8"));

export const selectedPinnedFiles = async (
  checkoutRoot: string,
  frozenManifest: Schema.Schema.Type<typeof frozenManifestSchema>
) => {
  const checkoutMetadata = await lstat(checkoutRoot);
  if (!checkoutMetadata.isDirectory() || checkoutMetadata.isSymbolicLink()) {
    throw new Error("source_checkout_root_invalid");
  }

  const contextPath = join(checkoutRoot, "run-context.json");
  const planPath = join(checkoutRoot, "run-plan.json");
  const journalRoot = join(checkoutRoot, "cleanup-journals");
  const journalMetadata = await lstat(journalRoot);
  if (!journalMetadata.isDirectory() || journalMetadata.isSymbolicLink()) {
    throw new Error("source_journal_directory_invalid");
  }
  const journalNames = frozenManifest.files
    .map(({ path }) => path)
    .filter((path) => path.startsWith("cleanup-journals/"))
    .map((path) => path.slice("cleanup-journals/".length))
    .toSorted();
  const expectedCaseIds = new Set(workspaceE2ECaseIds);
  if (
    journalNames.length !== expectedCheckoutJournalCount + 1 ||
    !journalNames.includes("account-lane.json")
  ) {
    throw new Error("source_journal_count_invalid");
  }

  const caseNames = journalNames.filter((name) => name !== "account-lane.json");
  const seenCaseIds = new Set<string>();
  for (const name of caseNames) {
    const caseId = name.endsWith(".json") ? name.slice(0, -5) : "";
    if (
      !caseId ||
      !expectedCaseIds.has(caseId as (typeof workspaceE2ECaseIds)[number]) ||
      seenCaseIds.has(caseId)
    ) {
      throw new Error("source_journal_allowlist_invalid");
    }
    seenCaseIds.add(caseId);
  }
  if (seenCaseIds.size !== expectedCheckoutJournalCount) {
    throw new Error("source_journal_count_invalid");
  }

  const files = frozenManifest.files
    .map(({ path }) => {
      if (!isPinnedArtifactPath(path)) {
        throw new Error("source_manifest_path_invalid");
      }
      return join(checkoutRoot, ...path.split("/"));
    })
    .toSorted();
  for (const path of files) {
    const metadata = await lstat(path);
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      throw new Error("source_file_type_invalid");
    }
  }
  if (files.length !== expectedArtifactFileCount) {
    throw new Error("source_file_count_invalid");
  }
  return { files, journalRoot, journalNames, planPath, contextPath };
};

export const assertExactStagingLayout = async (
  checkoutRoot: string,
  frozenManifest: Schema.Schema.Type<typeof frozenManifestSchema>
) => {
  const selected = await selectedPinnedFiles(checkoutRoot, frozenManifest);
  const checkoutEntries = (await readdir(checkoutRoot)).toSorted();
  if (
    !isDeepStrictEqual(checkoutEntries, [
      "cleanup-journals",
      "run-context.json",
      "run-plan.json",
    ])
  ) {
    throw new Error("restored_source_root_entries_invalid");
  }
  const journalEntries = (await readdir(selected.journalRoot)).toSorted();
  if (!isDeepStrictEqual(journalEntries, selected.journalNames)) {
    throw new Error("restored_source_journal_entries_invalid");
  }
  return selected;
};

const assertFilesMatchManifest = async (
  checkoutRoot: string,
  files: readonly string[],
  frozenManifest: Schema.Schema.Type<typeof frozenManifestSchema>
) => {
  const actualFiles = await Promise.all(
    files.map(async (file) => ({
      path: relative(checkoutRoot, file),
      sha256: sha256(await readFile(file)),
      sizeBytes: (await lstat(file)).size,
    }))
  );
  const byPath = (
    left: { readonly path: string },
    right: { readonly path: string }
  ) => {
    if (left.path < right.path) return -1;
    if (left.path > right.path) return 1;
    return 0;
  };
  if (
    !isDeepStrictEqual(
      actualFiles.toSorted(byPath),
      frozenManifest.files.toSorted(byPath)
    )
  ) {
    throw new Error("source_artifact_hash_pin_mismatch");
  }
};

const validateSource = async (checkoutRoot: string) => {
  const frozenManifest = await readFrozenManifest();
  const { files, journalRoot, journalNames, planPath, contextPath } =
    await selectedPinnedFiles(checkoutRoot, frozenManifest);
  await assertFilesMatchManifest(checkoutRoot, files, frozenManifest);

  // Treat the frozen byte-level manifest as the trust boundary. No source
  // context or journal values are decoded until all 36 files match it.
  const context = await readJson(sourceRunContextSchema, contextPath);
  if (
    context.runId !== `${expectedSourceRunId}-${expectedSourceRunAttempt}` ||
    context.githubRunId !== expectedSourceRunId ||
    context.githubRunAttempt !== expectedSourceRunAttempt ||
    context.targetSha !== expectedTargetSha ||
    context.prNumber !== expectedPrNumber ||
    context.executionContext !== "ci" ||
    context.allocation.shardCount !== 3 ||
    context.allocation.shardIndex !== 2 ||
    context.allocation.fromOffsetDays !== 14 ||
    context.allocation.toOffsetDays !== 90
  ) {
    throw new Error("source_context_pin_mismatch");
  }

  const plan = await readJson(sourceRunPlanSchema, planPath);
  if (!isDeepStrictEqual(plan.runContext, context)) {
    throw new Error("source_plan_context_mismatch");
  }
  await readJson(
    sourceAccountJournalSchema,
    join(journalRoot, "account-lane.json")
  );

  let stateCount = 0;
  let completedMarkerCount = 0;
  for (const name of journalNames) {
    if (name === "account-lane.json") continue;
    const caseId = name.slice(0, -5);
    const journal = await readJson(
      sourceCheckoutJournalSchema,
      join(journalRoot, name)
    );
    if (journal.caseId !== caseId) {
      throw new Error("source_checkout_journal_identity_mismatch");
    }
    stateCount += journal.checkoutStates.length;
    completedMarkerCount += journal.checkoutStates.filter(
      ({ completedDotyposReservationId }) =>
        completedDotyposReservationId !== undefined
    ).length;
  }
  if (
    stateCount !== expectedStateCount ||
    completedMarkerCount !== expectedCompletedMarkerCount
  ) {
    throw new Error("source_state_counts_invalid");
  }

  return {
    files,
    frozenManifest,
    manifestSha256: expectedManifestSha256,
    stateCount,
  };
};

const restore = async () => {
  const sourceRoot = requiredPath("SOURCE_ARTIFACT_DIR");
  const restoredRoot = requiredPath("RESTORED_CHECKOUT_DIR");
  const backupRoot = requiredPath("SOURCE_BACKUP_CHECKOUT_DIR");
  const contextMatches: string[] = [];
  const sourceMetadata = await lstat(sourceRoot);
  if (!sourceMetadata.isDirectory() || sourceMetadata.isSymbolicLink()) {
    throw new Error("source_artifact_root_invalid");
  }
  const walk = async (directory: string) => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile() && entry.name === "run-context.json") {
        contextMatches.push(path);
      }
    }
  };
  await walk(sourceRoot);
  if (contextMatches.length !== 1) {
    throw new Error("source_context_file_ambiguous");
  }
  const sourceCheckoutRoot = dirname(contextMatches[0] as string);
  const checkoutRelative = relative(sourceRoot, sourceCheckoutRoot);
  if (
    checkoutRelative !== "checkout" &&
    checkoutRelative !== "apps/deskohub-workspace/e2e-artifacts/checkout"
  ) {
    throw new Error("source_checkout_root_invalid");
  }

  const validated = await validateSource(sourceCheckoutRoot);
  await mkdir(dirname(backupRoot), { recursive: false, mode: 0o700 });
  await mkdir(backupRoot, { recursive: false, mode: 0o700 });
  await mkdir(dirname(restoredRoot), { recursive: true });
  await mkdir(restoredRoot, { recursive: false, mode: 0o700 });
  await mkdir(join(backupRoot, "cleanup-journals"), { mode: 0o700 });
  await mkdir(join(restoredRoot, "cleanup-journals"), { mode: 0o700 });
  for (const sourceFile of validated.files) {
    const relativePath = relative(sourceCheckoutRoot, sourceFile);
    const backupFile = join(backupRoot, relativePath);
    const restoredFile = join(restoredRoot, relativePath);
    await copyFile(sourceFile, backupFile);
    await copyFile(sourceFile, restoredFile);
    await chmod(backupFile, 0o600);
    await chmod(restoredFile, 0o600);
  }
  await verifyCopies(backupRoot, restoredRoot, validated.frozenManifest);

  const output = process.env.GITHUB_OUTPUT;
  if (!output) throw new Error("workflow_output_missing");
  await appendFile(
    output,
    `manifest_sha256=${validated.manifestSha256}\nfile_count=${validated.files.length}\nstate_count=${validated.stateCount}\n`,
    "utf8"
  );
};

const collectFiles = async (root: string) => {
  const files = new Map<string, string>();
  const walk = async (directory: string) => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error("restored_source_symlink");
      if (entry.isDirectory()) {
        await walk(path);
      } else if (entry.isFile()) {
        const name = relative(root, path);
        const hash = createHash("sha256")
          .update(await readFile(path))
          .digest("hex");
        files.set(name, hash);
      } else {
        throw new Error("restored_source_entry_invalid");
      }
    }
  };
  await walk(root);
  return files;
};

const verifyCopies = async (
  leftRoot: string,
  rightRoot: string,
  frozenManifest: Schema.Schema.Type<typeof frozenManifestSchema>
) => {
  const leftSelection = await assertExactStagingLayout(
    leftRoot,
    frozenManifest
  );
  const rightSelection = await assertExactStagingLayout(
    rightRoot,
    frozenManifest
  );
  await assertFilesMatchManifest(leftRoot, leftSelection.files, frozenManifest);
  await assertFilesMatchManifest(
    rightRoot,
    rightSelection.files,
    frozenManifest
  );
  const left = await collectFiles(leftRoot);
  const right = await collectFiles(rightRoot);
  if (
    !isDeepStrictEqual(
      [...left.keys()].toSorted(),
      [...right.keys()].toSorted()
    )
  ) {
    throw new Error("restored_source_file_set_changed");
  }
  for (const [name, leftHash] of left) {
    if (right.get(name) !== leftHash) {
      throw new Error("restored_source_file_changed");
    }
  }
};

const verify = async () => {
  const frozenManifest = await readFrozenManifest();
  await verifyCopies(
    requiredPath("SOURCE_BACKUP_CHECKOUT_DIR"),
    requiredPath("RESTORED_CHECKOUT_DIR"),
    frozenManifest
  );
};

const operation = process.argv[2];
let main: (() => Promise<void>) | undefined;
if (operation === "restore") main = restore;
else if (operation === "verify") main = verify;
if (import.meta.main) {
  if (!main) {
    process.stderr.write("Read-only source artifact helper mode is invalid.\n");
    process.exitCode = 2;
  } else {
    main().catch(() => {
      process.stderr.write(
        "Exact source artifact validation or preservation failed closed.\n"
      );
      process.exitCode = 1;
    });
  }
}
