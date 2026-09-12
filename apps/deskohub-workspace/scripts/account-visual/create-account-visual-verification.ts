import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import { Option, Schema } from "effect";
import {
  accountVisualHistoricalBaselineComparabilityReason,
  accountVisualHistoricalCaptureMethodVersion,
  accountVisualIterationComparabilityRule,
  accountVisualRendererMethodVersion,
} from "./types";

const jsonObjectSchema = Schema.Record(Schema.String, Schema.Json);
const jsonObjectFromStringSchema = Schema.fromJsonString(jsonObjectSchema);
const jsonObjectArraySchema = Schema.Array(jsonObjectSchema);
const stringArraySchema = Schema.Array(Schema.String);
const stringSchema = Schema.String;
const numberSchema = Schema.Finite;
const booleanSchema = Schema.Boolean;
export type JsonObject = Schema.Schema.Type<typeof jsonObjectSchema>;

const defaultVisualRoot = "/tmp/opencode/pr239-account-redesign/visual";
const defaultArchivePath = join(defaultVisualRoot, "final-verification.json");
const archivalReportName = "final-archival-hash-verification.json";
const currentChecksPath = join(defaultVisualRoot, "checks-v9.json");
const reportGeneratorRelativePath =
  "apps/deskohub-workspace/scripts/account-visual/create-account-visual-verification.ts";
const captureRunnerRelativePath =
  "apps/deskohub-workspace/scripts/account-visual/run.ts";
const profileFormRelativePath =
  "apps/deskohub-workspace/features/account/components/profile-form.tsx";
const nativeDiagnosticMessage =
  "An invalid form control with name='billingCompanyName' is not focusable.";
const maxCapturedOutputBytes = 100_000;
const screenNames = [
  "profile",
  "billing",
  "legal",
  "danger",
  "reservations",
] as const;
const pinnedArchive = {
  sha256: "f4bba050facc1bf36496d8238c92d44ab28183488c4f4a4ec221cb98e093e84c",
  bytes: 1_777_522,
} as const;
const originalProfileForm = {
  path: profileFormRelativePath,
  sha256: "5fd010ee3fb3897b7bd7b20f81644869d6884fbabe23b6b1b4e8b5747ab4586c",
  bytes: 26_651,
} as const;

const digestSchema = Schema.Struct({
  path: Schema.String,
  sha256: Schema.String,
  bytes: Schema.Finite,
});
const checkAttestationSchema = Schema.Struct({
  name: Schema.String,
  command: Schema.String,
  cwd: Schema.String,
  exitCode: Schema.Finite,
  stdout: Schema.String,
  stderr: Schema.String,
  stdoutTruncated: Schema.Boolean,
  stderrTruncated: Schema.Boolean,
  counts: jsonObjectSchema,
});
const checksEvidenceSchema = Schema.Struct({
  schemaVersion: Schema.Finite,
  sourceManifest: digestSchema,
  attestations: Schema.Array(checkAttestationSchema),
});

type VerificationOptions = {
  readonly help: boolean;
  readonly visualRoot: string;
  readonly archivePath: string;
  readonly checksPath: string | null;
  readonly outputPath: string;
};

type ChecksEvidence = Schema.Schema.Type<typeof checksEvidenceSchema>;
type CheckAttestation = ChecksEvidence["attestations"][number];
type ArchivalRunKey = "default" | "populated" | "czech";

type ArchivalRunDefinition = {
  readonly key: ArchivalRunKey;
  readonly archiveKey: ArchivalRunKey;
  readonly finalOutput: string;
  readonly finalLabel: string;
  readonly adapter: string;
  readonly locale: "en-US" | "cs-CZ";
  readonly mode: "desktop-standard" | "tablet";
  readonly originalFirst: {
    readonly output: string;
    readonly label: string;
    readonly manifestSha256: string;
    readonly manifestBytes: number;
  };
  readonly originalRepeat: {
    readonly output: string;
    readonly label: string;
    readonly manifestSha256: string;
    readonly manifestBytes: number;
  };
};

const archivalRunDefinitions = [
  {
    key: "default",
    archiveKey: "default",
    finalOutput: "final-default-v9",
    finalLabel: "final-default-v9",
    adapter:
      "apps/deskohub-workspace/scripts/account-visual/default-adapter.tsx",
    locale: "en-US",
    mode: "desktop-standard",
    originalFirst: {
      output: "after-corrected-v2-3",
      label: "after-corrected-v2",
      manifestSha256:
        "5821844a69055b5518e6ef578a81cda431b7c7d71fa17be10f08c7a110b3346b",
      manifestBytes: 225_232,
    },
    originalRepeat: {
      output: "after-corrected-v2-4",
      label: "after-corrected-v2",
      manifestSha256:
        "5821844a69055b5518e6ef578a81cda431b7c7d71fa17be10f08c7a110b3346b",
      manifestBytes: 225_232,
    },
  },
  {
    key: "populated",
    archiveKey: "populated",
    finalOutput: "final-populated-v9",
    finalLabel: "final-populated-v9",
    adapter:
      "apps/deskohub-workspace/scripts/account-visual/populated-adapter.tsx",
    locale: "en-US",
    mode: "desktop-standard",
    originalFirst: {
      output: "populated-corrected-v2-5",
      label: "populated-corrected-v2",
      manifestSha256:
        "cd052147ad3a76edea2865a5cbcdc6fcb5681957a8b92fff328768eb38d1b915",
      manifestBytes: 270_594,
    },
    originalRepeat: {
      output: "populated-corrected-v2-6",
      label: "populated-corrected-v2",
      manifestSha256:
        "cd052147ad3a76edea2865a5cbcdc6fcb5681957a8b92fff328768eb38d1b915",
      manifestBytes: 270_594,
    },
  },
  {
    key: "czech",
    archiveKey: "czech",
    finalOutput: "final-cs-v9",
    finalLabel: "final-cs-v9",
    adapter:
      "apps/deskohub-workspace/scripts/account-visual/default-adapter.tsx",
    locale: "cs-CZ",
    mode: "tablet",
    originalFirst: {
      output: "cs-corrected-v2-3",
      label: "cs-corrected-v2",
      manifestSha256:
        "89ada2c87f730629d97a47f4f5ff1d157240f00430228f99078bdeed88e35018",
      manifestBytes: 225_232,
    },
    originalRepeat: {
      output: "cs-corrected-v2-4",
      label: "cs-corrected-v2",
      manifestSha256:
        "89ada2c87f730629d97a47f4f5ff1d157240f00430228f99078bdeed88e35018",
      manifestBytes: 225_232,
    },
  },
] as const satisfies readonly ArchivalRunDefinition[];

const valueAt = <T extends Schema.Json>(record: JsonObject, key: string): T => {
  const value = record[key];
  if (value === undefined) {
    throw new Error(`Missing ${key}`);
  }
  return value as T;
};

const objectAt = (record: JsonObject, key: string): JsonObject =>
  Schema.decodeUnknownSync(jsonObjectSchema)(valueAt(record, key));

const objectsAt = (record: JsonObject, key: string): readonly JsonObject[] =>
  Schema.decodeUnknownSync(jsonObjectArraySchema)(valueAt(record, key));

const stringsAt = (record: JsonObject, key: string): readonly string[] =>
  Schema.decodeUnknownSync(stringArraySchema)(valueAt(record, key));

const stringAt = (record: JsonObject, key: string): string =>
  Schema.decodeUnknownSync(stringSchema)(valueAt(record, key));

const numberAt = (record: JsonObject, key: string): number =>
  Schema.decodeUnknownSync(numberSchema)(valueAt(record, key));

const booleanAt = (record: JsonObject, key: string): boolean =>
  Schema.decodeUnknownSync(booleanSchema)(valueAt(record, key));

const optionalStringAt = (record: JsonObject, key: string): string | null =>
  Option.getOrNull(Schema.decodeUnknownOption(stringSchema)(record[key]));

const optionalBooleanAt = (record: JsonObject, key: string): boolean | null =>
  Option.getOrNull(Schema.decodeUnknownOption(booleanSchema)(record[key]));

const assert = (condition: boolean, message: string) => {
  if (!condition) throw new Error(message);
};

const assertExactKeys = (
  record: JsonObject,
  expectedKeys: readonly string[],
  label: string
) => {
  const actualKeys = Object.keys(record).sort();
  const expected = [...expectedKeys].sort();
  assert(
    JSON.stringify(actualKeys) === JSON.stringify(expected),
    `${label} keys drifted`
  );
};

const readJson = async (path: string): Promise<JsonObject> =>
  Schema.decodeSync(jsonObjectFromStringSchema)(await readFile(path, "utf8"));

const sha256 = (data: Uint8Array) =>
  createHash("sha256").update(data).digest("hex");

const fileDigest = async (path: string) => {
  const data = await readFile(path);
  return { sha256: sha256(data), bytes: data.byteLength };
};

const displayPath = (path: string) => {
  const relativePath = relative(repoRoot, path);
  return relativePath === "" || relativePath.startsWith("..")
    ? path
    : relativePath;
};

const repoRoot = resolve(import.meta.dir, "../../../..");

export const compactComparisonMetadata = (report: JsonObject) => {
  const comparison = objectAt(report, "comparison");
  return {
    referenceLocale: optionalStringAt(comparison, "referenceLocale"),
    captureLocale: optionalStringAt(comparison, "captureLocale"),
    copyMismatch: optionalBooleanAt(comparison, "copyMismatch"),
    fixture: optionalStringAt(comparison, "fixture"),
    rendererMethodVersion: optionalStringAt(
      comparison,
      "rendererMethodVersion"
    ),
    historicalBaselineComparability: optionalBooleanAt(
      comparison,
      "historicalBaselineComparability"
    ),
    historicalBaselineComparabilityReason: optionalStringAt(
      comparison,
      "historicalBaselineComparabilityReason"
    ),
    iterationComparabilityRule: optionalStringAt(
      comparison,
      "iterationComparabilityRule"
    ),
    controlledComparability: optionalBooleanAt(
      comparison,
      "controlledComparability"
    ),
    controlledComparabilityCaveat: optionalStringAt(
      comparison,
      "controlledComparabilityCaveat"
    ),
  };
};

export const compactCheckAttestation = (attestation: CheckAttestation) => ({
  name: attestation.name,
  command: attestation.command,
  cwd: attestation.cwd,
  exitCode: attestation.exitCode,
  status: attestation.exitCode === 0 ? "passed" : "failed",
  stdout: attestation.stdout,
  stderr: attestation.stderr,
  stdoutTruncated: attestation.stdoutTruncated,
  stderrTruncated: attestation.stderrTruncated,
  counts: attestation.counts,
});

const readChecksEvidence = async (path: string) => {
  const bytes = await readFile(path);
  const evidence = Schema.decodeUnknownSync(checksEvidenceSchema)(
    JSON.parse(bytes.toString())
  );
  assert(evidence.schemaVersion === 1, "Unsupported checks evidence schema");
  assert(evidence.attestations.length > 0, "Checks evidence is empty");
  for (const attestation of evidence.attestations) {
    assert(
      Number.isInteger(attestation.exitCode) && attestation.exitCode >= 0,
      `Invalid exit code for ${attestation.name}`
    );
    assert(
      Buffer.byteLength(attestation.stdout, "utf8") <= maxCapturedOutputBytes,
      `stdout exceeds the ${maxCapturedOutputBytes}-byte evidence bound for ${attestation.name}`
    );
    assert(
      Buffer.byteLength(attestation.stderr, "utf8") <= maxCapturedOutputBytes,
      `stderr exceeds the ${maxCapturedOutputBytes}-byte evidence bound for ${attestation.name}`
    );
  }
  return {
    evidence,
    digest: {
      path,
      ...(await fileDigest(path)),
    },
  };
};

export const VERIFICATION_HELP = `account visual archival hash verification

Usage: bun apps/deskohub-workspace/scripts/account-visual/create-account-visual-verification.ts [VISUAL_ROOT] --checks PATH [--archive PATH] [--output PATH]

--archive PATH must be the retained final-verification.json whose full SHA-256 is pinned by this verifier.
--checks PATH reads externally captured command attestations. Those checks bind the capture runner, not this generator.
--output PATH must be final-archival-hash-verification.json under VISUAL_ROOT.

Historical corrected directories are never read. Their archived first/repeat hashes and source-manifest identities are extracted only after the pinned archive digest passes.
Historical PNG equality is asserted only for the legacy capture method (${accountVisualHistoricalCaptureMethodVersion}). A newer renderer method records historical differences as informational and allows method-intervention changes without calling them pixel-perfect.
Final production captures remain paused until the caller resumes with the required profile hash. This verifier never creates captures or rewrites historical evidence.
`;

export const parseVerificationArgs = (
  argv: readonly string[]
): VerificationOptions => {
  let archivePath: string | undefined;
  let checksPath: string | undefined;
  let help = false;
  let outputPath: string | undefined;
  let visualRoot: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === undefined)
      throw new Error("Missing verification argument");
    if (argument === "--help" || argument === "-h") {
      help = true;
      continue;
    }
    if (argument === "--archive") {
      archivePath = argv[++index];
      if (archivePath === undefined)
        throw new Error("--archive requires a path");
      continue;
    }
    if (argument === "--checks") {
      checksPath = argv[++index];
      if (checksPath === undefined) throw new Error("--checks requires a path");
      continue;
    }
    if (argument === "--output") {
      outputPath = argv[++index];
      if (outputPath === undefined) throw new Error("--output requires a path");
      continue;
    }
    if (argument.startsWith("-")) {
      throw new Error(`Unknown argument: ${argument}`);
    }
    if (visualRoot !== undefined) {
      throw new Error("Only one visual root may be supplied");
    }
    visualRoot = argument;
  }

  const resolvedVisualRoot = resolve(visualRoot ?? defaultVisualRoot);
  if (!help && checksPath === undefined) {
    throw new Error("--checks is required; use --help for usage");
  }

  return {
    help,
    visualRoot: resolvedVisualRoot,
    archivePath: resolve(
      archivePath ?? join(resolvedVisualRoot, "final-verification.json")
    ),
    checksPath: checksPath === undefined ? null : resolve(checksPath),
    outputPath: resolve(
      outputPath ?? join(resolvedVisualRoot, archivalReportName)
    ),
  };
};

const compactInvalidEvents = (submission: JsonObject, key: string) =>
  objectsAt(submission, key).map((event) => ({
    targetId: stringAt(event, "targetId"),
    targetName: stringAt(event, "targetName"),
    targetTag: stringAt(event, "targetTag"),
    targetVisible: booleanAt(event, "targetVisible"),
    targetValidityValid: booleanAt(event, "targetValidityValid"),
  }));

const compactControl = (submission: JsonObject, key: string) => {
  const control = objectAt(submission, key);
  return {
    mounted: booleanAt(control, "mounted"),
    visible: booleanAt(control, "visible"),
    value: stringAt(control, "value"),
    required: booleanAt(control, "required"),
    validityValid: booleanAt(control, "validityValid"),
  };
};

const compactSubmission = (submission: JsonObject) => ({
  method: stringAt(submission, "method"),
  blockedByNativeValidation: booleanAt(submission, "blockedByNativeValidation"),
  invalidEventSource: stringAt(submission, "invalidEventSource"),
  formValidityValid: booleanAt(submission, "formValidityValid"),
  eligibleControlValidity: objectsAt(submission, "eligibleControlValidity").map(
    (control) => ({
      id: stringAt(control, "id"),
      name: stringAt(control, "name"),
      tag: stringAt(control, "tag"),
      validityValid: booleanAt(control, "validityValid"),
    })
  ),
  requestSubmitInvalidEvents: compactInvalidEvents(
    submission,
    "requestSubmitInvalidEvents"
  ),
  visiblePanels: objectAt(submission, "visiblePanels"),
  controls: {
    firstName: compactControl(submission, "firstName"),
    companyName: compactControl(submission, "companyName"),
    phone: compactControl(submission, "phone"),
    identityControlsValid: booleanAt(submission, "identityControlsValid"),
  },
});

const compactNavigation = (nativeValidation: JsonObject) => {
  const navigation = objectAt(nativeValidation, "navigation");
  return ["initialProfile", "billing", "backToProfile"].map((key) => {
    const selection = objectAt(navigation, key);
    return {
      requestedScreen: stringAt(selection, "requestedScreen"),
      status: stringAt(selection, "status"),
      method: stringAt(selection, "method"),
      sectionLabel: valueAt(selection, "sectionLabel"),
      selectedValue: valueAt(selection, "selectedValue"),
      selectedAriaCurrent: valueAt(selection, "selectedAriaCurrent"),
      targetSelector: valueAt(selection, "targetSelector"),
      targetVisible: valueAt(selection, "targetVisible"),
    };
  });
};

const compactNativeValidation = (execution: JsonObject) => {
  const nativeValidation = objectAt(execution, "nativeValidation");
  const expectedBrowserDiagnostics = objectsAt(
    nativeValidation,
    "expectedBrowserDiagnostics"
  ).map((diagnostic) => ({
    kind: stringAt(diagnostic, "kind"),
    message: stringAt(diagnostic, "message"),
  }));
  const browserProblems = objectsAt(nativeValidation, "browserProblems").map(
    (diagnostic) => ({
      kind: stringAt(diagnostic, "kind"),
      message: stringAt(diagnostic, "message"),
    })
  );
  const actionInvocationCount = objectAt(
    nativeValidation,
    "actionInvocationCount"
  );
  const prohibitedOperations = objectAt(
    nativeValidation,
    "prohibitedOperations"
  );
  const assertRequestSubmitSubmission = (
    submission: JsonObject,
    expectedInvalidTargetIds: readonly string[]
  ) => {
    assert(
      stringAt(submission, "invalidEventSource") === "requestSubmit",
      "Native validation invalid events did not come from requestSubmit"
    );
    assert(
      booleanAt(submission, "formValidityValid") === false,
      "Native validation did not observe an invalid eligible control"
    );
    assert(
      JSON.stringify(
        objectsAt(submission, "requestSubmitInvalidEvents").map((event) =>
          stringAt(event, "targetId")
        )
      ) === JSON.stringify(expectedInvalidTargetIds),
      "Native validation invalid target order changed"
    );
    assert(
      Object.keys(submission).filter((key) => key.endsWith("InvalidEvents"))
        .length === 1,
      "Native validation recorded invalid events outside requestSubmit"
    );
  };

  assert(
    stringAt(nativeValidation, "status") === "passed",
    "Native validation failed"
  );
  assert(
    stringAt(nativeValidation, "context") ===
      "fresh-context-after-original-capture",
    "Native validation did not use the fresh context"
  );
  assert(
    booleanAt(nativeValidation, "initialScreenshotsUntouched"),
    "Native validation mutated the initial screenshot path"
  );
  assertRequestSubmitSubmission(objectAt(nativeValidation, "firstSubmission"), [
    "account-profile-first-name",
    "account-profile-billing-company-name",
  ]);
  assertRequestSubmitSubmission(
    objectAt(nativeValidation, "secondSubmission"),
    ["account-profile-billing-company-name"]
  );
  for (const key of [
    "dispatchedInvalidEvent",
    "unhiddenDom",
    "enabledBackendActionControls",
  ]) {
    assert(!booleanAt(prohibitedOperations, key), `${key} was used`);
  }
  for (const key of [
    "initial",
    "beforeFirstSubmission",
    "afterFirstSubmission",
    "beforeSecondSubmission",
    "afterSecondSubmission",
  ]) {
    assert(numberAt(actionInvocationCount, key) === 0, `${key} was invoked`);
  }
  assert(
    expectedBrowserDiagnostics.length === 2 &&
      expectedBrowserDiagnostics.every(
        (diagnostic) =>
          diagnostic.kind === "console-error" &&
          diagnostic.message === nativeDiagnosticMessage
      ),
    "Unexpected native-validation browser diagnostics"
  );
  assert(
    JSON.stringify(browserProblems) ===
      JSON.stringify(expectedBrowserDiagnostics),
    "Expected browser diagnostics were not retained as observable problems"
  );

  return {
    status: stringAt(nativeValidation, "status"),
    method: stringAt(nativeValidation, "method"),
    context: stringAt(nativeValidation, "context"),
    adapter: stringAt(nativeValidation, "adapter"),
    fixture: stringAt(nativeValidation, "fixture"),
    initialScreenshotsUntouched: booleanAt(
      nativeValidation,
      "initialScreenshotsUntouched"
    ),
    prohibitedOperations,
    navigation: compactNavigation(nativeValidation),
    actionInvocationCount,
    firstSubmission: compactSubmission(
      objectAt(nativeValidation, "firstSubmission")
    ),
    secondSubmission: compactSubmission(
      objectAt(nativeValidation, "secondSubmission")
    ),
    syntheticInteractionDrafts: objectAt(
      nativeValidation,
      "syntheticInteractionDrafts"
    ),
    draftsAfterSecondSubmission: objectAt(
      nativeValidation,
      "draftsAfterSecondSubmission"
    ),
    backendActionControls: objectsAt(
      nativeValidation,
      "backendActionControls"
    ).map((control) => ({
      id: stringAt(control, "id"),
      status: stringAt(control, "status"),
      present: valueAt(control, "present"),
      disabled: valueAt(control, "disabled"),
      dataUnavailable: valueAt(control, "dataUnavailable"),
      actionDataUnavailable: valueAt(control, "actionDataUnavailable"),
      nativeTitle: valueAt(control, "nativeTitle"),
      ariaDescription: valueAt(control, "ariaDescription"),
      reason: stringAt(control, "reason"),
    })),
    expectedBrowserDiagnostics,
    browserProblems,
    unexpectedPageErrors: valueAt(nativeValidation, "pageErrors"),
    unexpectedFailures: valueAt(nativeValidation, "failures"),
    diagnosticFilter: {
      predicate:
        "kind === console-error && message === exact billingCompanyName diagnostic",
      message: nativeDiagnosticMessage,
      filteredCount: expectedBrowserDiagnostics.length,
    },
  };
};

const findManifestSource = (manifest: JsonObject, path: string) => {
  const candidates = [
    ...objectsAt(manifest, "ownedSources"),
    ...objectsAt(manifest, "bundleInputs"),
  ];
  const source = candidates.find(
    (candidate) => stringAt(candidate, "path") === path
  );
  if (source === undefined) throw new Error(`Missing manifest source ${path}`);
  return {
    path: stringAt(source, "path"),
    sha256: stringAt(source, "sha256"),
    bytes: numberAt(source, "bytes"),
  };
};

const compactCaptureMethodManifest = async (directory: string) => {
  const path = join(directory, "source-manifest.json");
  const manifest = await readJson(path);
  const digest = await fileDigest(path);
  const generatorAtCapture = findManifestSource(
    manifest,
    reportGeneratorRelativePath
  );
  const runnerAtCapture = findManifestSource(
    manifest,
    captureRunnerRelativePath
  );
  return {
    path,
    sha256: digest.sha256,
    bytes: digest.bytes,
    adapter: stringAt(manifest, "adapter"),
    entrypoint: stringAt(manifest, "entrypoint"),
    locale: stringAt(manifest, "locale"),
    bunVersion: stringAt(manifest, "bunVersion"),
    postCssConfig: stringAt(manifest, "postCssConfig"),
    ownedSourceCount: objectsAt(manifest, "ownedSources").length,
    bundleInputCount: objectsAt(manifest, "bundleInputs").length,
    generatorAtCapture,
    runnerAtCapture,
    profileFormAtCapture: findManifestSource(manifest, profileFormRelativePath),
  };
};

const screenAt = (report: JsonObject, screenName: string): JsonObject => {
  const screen = objectsAt(report, "screens").find(
    (candidate) => stringAt(candidate, "screen") === screenName
  );
  if (screen === undefined) throw new Error(`Missing ${screenName} screen`);
  return screen;
};

const desktopAt = (screen: JsonObject) => objectAt(screen, "desktop");

type CurrentPngRecord = {
  readonly scenario: ArchivalRunKey;
  readonly screen: string;
  readonly path: string;
  readonly sha256: string;
  readonly bytes: number;
  readonly physicalPixels: JsonObject;
};

type CurrentCapture = {
  readonly definition: ArchivalRunDefinition;
  readonly outputDirectory: string;
  readonly execution: JsonObject;
  readonly captureMethodManifest: Awaited<
    ReturnType<typeof compactCaptureMethodManifest>
  >;
  readonly comparison: ReturnType<typeof compactComparisonMetadata>;
  readonly pngs: readonly CurrentPngRecord[];
};

const readCurrentCapture = async ({
  definition,
  visualRoot,
}: {
  readonly definition: ArchivalRunDefinition;
  readonly visualRoot: string;
}): Promise<CurrentCapture> => {
  const outputDirectory = join(visualRoot, definition.finalOutput);
  const execution = await readJson(join(outputDirectory, "execution.json"));
  const report = await readJson(join(outputDirectory, "report.json"));
  const comparison = compactComparisonMetadata(report);
  assert(
    stringAt(execution, "status") === "passed",
    `${definition.finalOutput} failed`
  );
  assert(
    stringAt(execution, "label") === definition.finalLabel,
    `${definition.finalOutput} label drifted`
  );
  assert(
    JSON.stringify(stringsAt(execution, "selectedScreens")) ===
      JSON.stringify(screenNames),
    `${definition.finalOutput} screen selection drifted`
  );
  const captureMethodManifest =
    await compactCaptureMethodManifest(outputDirectory);
  assert(
    captureMethodManifest.adapter === definition.adapter &&
      captureMethodManifest.locale === definition.locale,
    `${definition.finalOutput} capture method manifest drifted`
  );
  assert(
    comparison.rendererMethodVersion === accountVisualRendererMethodVersion ||
      comparison.rendererMethodVersion ===
        accountVisualHistoricalCaptureMethodVersion ||
      comparison.rendererMethodVersion === null,
    `${definition.finalOutput} renderer method version is unsupported`
  );
  if (comparison.rendererMethodVersion === accountVisualRendererMethodVersion) {
    assert(
      comparison.historicalBaselineComparability === false &&
        comparison.historicalBaselineComparabilityReason ===
          accountVisualHistoricalBaselineComparabilityReason &&
        comparison.iterationComparabilityRule ===
          accountVisualIterationComparabilityRule &&
        comparison.controlledComparability === false,
      `${definition.finalOutput} comparability metadata drifted`
    );
  }

  const pngs: CurrentPngRecord[] = [];
  for (const screenName of screenNames) {
    const screen = screenAt(report, screenName);
    const desktop = desktopAt(screen);
    const files = objectAt(desktop, "files");
    const mainName = stringAt(files, "main");
    assert(
      !isAbsolute(mainName) && basename(mainName) === mainName,
      `${definition.finalOutput} has an unsafe main PNG path`
    );
    const path = join(outputDirectory, screenName, mainName);
    const data = await readFile(path);
    const digest = {
      path,
      sha256: sha256(data),
      bytes: data.byteLength,
      physicalPixels: objectAt(desktop, "mainPhysicalDimensions"),
    };
    pngs.push({
      scenario: definition.key,
      screen: screenName,
      ...digest,
    });
  }

  return {
    definition,
    outputDirectory,
    execution,
    captureMethodManifest,
    comparison,
    pngs,
  };
};

const validateOriginalManifestIdentity = ({
  capture,
  expected,
  label,
}: {
  readonly capture: JsonObject;
  readonly expected: {
    readonly output: string;
    readonly label: string;
    readonly manifestSha256: string;
    readonly manifestBytes: number;
  };
  readonly label: string;
}) => {
  assert(
    stringAt(capture, "label") === expected.label,
    `${label} label drifted`
  );
  const outputDirectory = stringAt(capture, "outputDirectory");
  assert(
    outputDirectory === join(defaultVisualRoot, expected.output),
    `${label} output path drifted`
  );
  assert(stringAt(capture, "status") === "passed", `${label} did not pass`);
  const sourceManifest = objectAt(capture, "sourceManifest");
  assert(
    stringAt(sourceManifest, "path") === "source-manifest.json" &&
      stringAt(sourceManifest, "sha256") === expected.manifestSha256 &&
      numberAt(sourceManifest, "bytes") === expected.manifestBytes,
    `${label} original source manifest identity drifted`
  );
  return {
    outputDirectory,
    sourceManifest: {
      path: join(outputDirectory, "source-manifest.json"),
      sha256: stringAt(sourceManifest, "sha256"),
      bytes: numberAt(sourceManifest, "bytes"),
    },
  } as const;
};

type ArchivedPngHashRecord = {
  readonly scenario: ArchivalRunKey;
  readonly screen: string;
  readonly firstSha256: string;
  readonly repeatSha256: string;
};

type ArchivedRunRecord = {
  readonly scenario: ArchivalRunKey;
  readonly firstOutputDirectory: string;
  readonly repeatOutputDirectory: string;
  readonly firstSourceManifest: {
    readonly path: string;
    readonly sha256: string;
    readonly bytes: number;
  };
  readonly repeatSourceManifest: {
    readonly path: string;
    readonly sha256: string;
    readonly bytes: number;
  };
  readonly pngs: readonly ArchivedPngHashRecord[];
};

const validateProfileSourceIdentity = (archive: JsonObject) => {
  const sourceVerification = objectAt(archive, "sourceVerification");
  const productionHashChecks = objectAt(
    sourceVerification,
    "productionHashChecks"
  );
  const profile = objectAt(productionHashChecks, profileFormRelativePath);
  assert(
    stringAt(profile, "expectedSha256") === originalProfileForm.sha256 &&
      stringAt(profile, "actualSha256") === originalProfileForm.sha256 &&
      numberAt(profile, "bytes") === originalProfileForm.bytes &&
      booleanAt(profile, "match"),
    "Archived original profile source identity drifted"
  );
  return originalProfileForm;
};

export const validateArchivalArchiveStructure = (
  archive: JsonObject
): {
  readonly originalProfileForm: typeof originalProfileForm;
  readonly runs: readonly ArchivedRunRecord[];
} => {
  assert(numberAt(archive, "schemaVersion") === 4, "Archived schema drifted");
  const originalProfileFormRecord = validateProfileSourceIdentity(archive);
  const runs = objectAt(archive, "runs");
  const correctedV2 = objectAt(runs, "correctedV2");
  assertExactKeys(
    correctedV2,
    archivalRunDefinitions.map(({ archiveKey }) => archiveKey),
    "Archived correctedV2"
  );

  const archivedRuns: ArchivedRunRecord[] = [];
  for (const definition of archivalRunDefinitions) {
    const record = objectAt(correctedV2, definition.archiveKey);
    const fullCapturePair = objectAt(record, "fullCapturePair");
    const first = objectAt(fullCapturePair, "first");
    const repeat = objectAt(fullCapturePair, "repeat");
    const firstIdentity = validateOriginalManifestIdentity({
      capture: first,
      expected: definition.originalFirst,
      label: `${definition.key} original first capture`,
    });
    const repeatIdentity = validateOriginalManifestIdentity({
      capture: repeat,
      expected: definition.originalRepeat,
      label: `${definition.key} original repeat capture`,
    });
    const sourceManifests = objectAt(record, "sourceManifests");
    const sourceManifestFirst = objectAt(sourceManifests, "first");
    const sourceManifestRepeat = objectAt(sourceManifests, "repeat");
    for (const [sourceManifest, expected, label] of [
      [sourceManifestFirst, definition.originalFirst, "first"],
      [sourceManifestRepeat, definition.originalRepeat, "repeat"],
    ] as const) {
      assert(
        stringAt(sourceManifest, "path") === "source-manifest.json" &&
          stringAt(sourceManifest, "sha256") === expected.manifestSha256 &&
          numberAt(sourceManifest, "bytes") === expected.manifestBytes,
        `${definition.key} archived ${label} source manifest identity drifted`
      );
    }
    assert(
      booleanAt(sourceManifests, "pairEqual"),
      `${definition.key} archived source manifest pair was not equal`
    );

    const desktop = objectAt(record, "desktop");
    assertExactKeys(desktop, screenNames, `${definition.key} archived desktop`);
    const pngs: ArchivedPngHashRecord[] = [];
    for (const screenName of screenNames) {
      const screen = objectAt(desktop, screenName);
      const firstScreen = objectAt(screen, "first");
      const repeatScreen = objectAt(screen, "repeat");
      const firstHashes = objectAt(firstScreen, "hashes");
      const repeatHashes = objectAt(repeatScreen, "hashes");
      const firstSha256 = stringAt(firstHashes, "main");
      const repeatSha256 = stringAt(repeatHashes, "main");
      assert(
        /^[a-f0-9]{64}$/.test(firstSha256) &&
          /^[a-f0-9]{64}$/.test(repeatSha256),
        `${definition.key}/${screenName} archived PNG hash is malformed`
      );
      assert(
        firstSha256 === repeatSha256,
        `${definition.key}/${screenName} archived first/repeat PNG hashes differ`
      );
      pngs.push({
        scenario: definition.key,
        screen: screenName,
        firstSha256,
        repeatSha256,
      });
    }
    archivedRuns.push({
      scenario: definition.key,
      firstOutputDirectory: firstIdentity.outputDirectory,
      repeatOutputDirectory: repeatIdentity.outputDirectory,
      firstSourceManifest: firstIdentity.sourceManifest,
      repeatSourceManifest: repeatIdentity.sourceManifest,
      pngs,
    });
  }
  assert(
    archivedRuns.flatMap(({ pngs }) => pngs).length === 15,
    "Archived correctedV2 did not contain exactly 15 PNG hash records"
  );
  return { originalProfileForm: originalProfileFormRecord, runs: archivedRuns };
};

export const verifyPinnedArchiveBytes = (archiveBytes: Uint8Array) => {
  const digest = {
    sha256: sha256(archiveBytes),
    bytes: archiveBytes.byteLength,
  };
  assert(
    digest.sha256 === pinnedArchive.sha256 &&
      digest.bytes === pinnedArchive.bytes,
    "Pinned archival final-verification.json SHA-256 or byte length mismatch"
  );
  const archive = Schema.decodeSync(jsonObjectFromStringSchema)(
    Buffer.from(archiveBytes).toString("utf8")
  );
  return {
    archiveDigest: digest,
    archive,
    ...validateArchivalArchiveStructure(archive),
  } as const;
};

const readPinnedArchive = async (path: string) =>
  verifyPinnedArchiveBytes(await readFile(path));

export const assertCurrentPngMatchesHistoricalHash = ({
  currentSha256,
  firstSha256,
  repeatSha256,
  scenario,
  screen,
}: {
  readonly currentSha256: string;
  readonly firstSha256: string;
  readonly repeatSha256: string;
  readonly scenario: string;
  readonly screen: string;
}) => {
  assert(
    firstSha256 === repeatSha256,
    `${scenario}/${screen} archived first/repeat hash mismatch`
  );
  assert(
    currentSha256 === firstSha256,
    `${scenario}/${screen} current PNG does not match previously recorded historical PNG hash`
  );
  return { matchesPreviouslyRecordedHistoricalPngHash: true } as const;
};

export const compareCurrentPngWithHistoricalHash = ({
  currentFixture,
  currentLocale,
  currentRendererMethodVersion,
  expectedFixture,
  expectedLocale,
  firstSha256,
  repeatSha256,
  currentSha256,
  scenario,
  screen,
}: {
  readonly currentFixture: string | null;
  readonly currentLocale: string | null;
  readonly currentRendererMethodVersion: string | null;
  readonly expectedFixture: string;
  readonly expectedLocale: string;
  readonly firstSha256: string;
  readonly repeatSha256: string;
  readonly currentSha256: string;
  readonly scenario: string;
  readonly screen: string;
}) => {
  const isLegacyCaptureMethod =
    currentRendererMethodVersion === null ||
    currentRendererMethodVersion ===
      accountVisualHistoricalCaptureMethodVersion;
  const isCurrentCaptureMethod =
    currentRendererMethodVersion === accountVisualRendererMethodVersion;
  assert(
    isLegacyCaptureMethod || isCurrentCaptureMethod,
    `${scenario}/${screen} renderer method cannot authorize historical comparison`
  );

  const historicalHashMatch = currentSha256 === firstSha256;
  const methodMatches = isCurrentCaptureMethod;
  const fixtureMatches = currentFixture === expectedFixture;
  const localeMatches = currentLocale === expectedLocale;
  const controlledIterationEligible =
    methodMatches && fixtureMatches && localeMatches;

  if (isLegacyCaptureMethod) {
    assertCurrentPngMatchesHistoricalHash({
      currentSha256,
      firstSha256,
      repeatSha256,
      scenario,
      screen,
    });
    return {
      comparisonMode: "old-capture-method-archive-hash-proof",
      archiveHashProof: "passed",
      historicalHashMatch: true,
      changedPixelsAllowed: false,
      changedPixelsObserved: false,
      controlledIterationEligible: false,
      controlledIterationEligibility: {
        methodMatches,
        fixtureMatches,
        localeMatches,
      },
      pixelPerfectStatus: "not-asserted",
    } as const;
  }

  assert(
    firstSha256 === repeatSha256,
    `${scenario}/${screen} archived first/repeat hash mismatch`
  );
  return {
    comparisonMode: "new-method-historical-diff-informational",
    archiveHashProof: "not-applicable-new-renderer-method",
    historicalHashMatch,
    changedPixelsAllowed: true,
    changedPixelsObserved: !historicalHashMatch,
    controlledIterationEligible,
    controlledIterationEligibility: {
      methodMatches,
      fixtureMatches,
      localeMatches,
    },
    historicalDiffStatus: "informational",
    pixelPerfectStatus: "not-asserted",
  } as const;
};

const compareCurrentPngs = ({
  archivedRuns,
  currentCaptures,
}: {
  readonly archivedRuns: readonly ArchivedRunRecord[];
  readonly currentCaptures: readonly CurrentCapture[];
}) => {
  const records = [];
  for (const archivedRun of archivedRuns) {
    const currentCapture = currentCaptures.find(
      ({ definition }) => definition.key === archivedRun.scenario
    );
    if (currentCapture === undefined)
      throw new Error(`Missing current capture ${archivedRun.scenario}`);
    for (const archivedPng of archivedRun.pngs) {
      const currentPng = currentCapture.pngs.find(
        ({ screen }) => screen === archivedPng.screen
      );
      if (currentPng === undefined) {
        throw new Error(
          `Missing current PNG ${archivedRun.scenario}/${archivedPng.screen}`
        );
      }
      const result = compareCurrentPngWithHistoricalHash({
        currentSha256: currentPng.sha256,
        firstSha256: archivedPng.firstSha256,
        repeatSha256: archivedPng.repeatSha256,
        scenario: archivedRun.scenario,
        screen: archivedPng.screen,
        currentRendererMethodVersion:
          currentCapture.comparison.rendererMethodVersion,
        currentFixture: currentCapture.comparison.fixture,
        currentLocale: currentCapture.comparison.captureLocale,
        expectedFixture: currentCapture.definition.adapter,
        expectedLocale: currentCapture.definition.locale,
      });
      records.push({
        scenario: archivedRun.scenario,
        screen: archivedPng.screen,
        current: currentPng,
        archived: {
          firstSha256: archivedPng.firstSha256,
          repeatSha256: archivedPng.repeatSha256,
        },
        ...result,
      });
    }
  }
  assert(
    records.length === 15,
    "Current archival PNG comparison did not cover 15 records"
  );
  const legacyRecords = records.filter(
    ({ comparisonMode }) =>
      comparisonMode === "old-capture-method-archive-hash-proof"
  );
  const newMethodRecords = records.filter(
    ({ comparisonMode }) =>
      comparisonMode === "new-method-historical-diff-informational"
  );
  const controlledIterationEligibleRecords = records.filter(
    ({ controlledIterationEligible }) => controlledIterationEligible
  );
  return {
    method:
      "conditional current main PNG comparison against archived first/repeat hash records",
    status:
      newMethodRecords.length > 0
        ? "historical-diff-informational"
        : "old-capture-method-archive-hash-proof",
    pixelPerfectStatus: "not-asserted",
    oldCaptureMethodArchiveHashProof: {
      methodVersion: accountVisualHistoricalCaptureMethodVersion,
      records: legacyRecords.length,
      status: legacyRecords.length > 0 ? "passed" : "not-applicable",
    },
    newMethodHistoricalDiff: {
      rendererMethodVersion: accountVisualRendererMethodVersion,
      records: newMethodRecords.length,
      status: newMethodRecords.length > 0 ? "informational" : "not-applicable",
      changedPixelsAllowed: newMethodRecords.length > 0,
      changedPixelsObserved: newMethodRecords.filter(
        ({ changedPixelsObserved }) => changedPixelsObserved
      ).length,
    },
    controlledIterationComparison: {
      eligibleRecords: controlledIterationEligibleRecords.length,
      totalRecords: records.length,
      pixelPerfectStatus: "not-asserted",
      rule: accountVisualIterationComparabilityRule,
    },
    comparability: {
      rendererMethodVersion: accountVisualRendererMethodVersion,
      historicalBaselineComparability: false,
      historicalBaselineComparabilityReason:
        accountVisualHistoricalBaselineComparabilityReason,
      iterationComparabilityRule: accountVisualIterationComparabilityRule,
    },
    total: records.length,
    matchesPreviouslyRecordedHistoricalPngHash: records.filter(
      ({ comparisonMode }) =>
        comparisonMode === "old-capture-method-archive-hash-proof"
    ).length,
    historicalHashMatchesObserved: records.filter(
      ({ historicalHashMatch }) => historicalHashMatch
    ).length,
    historicalDiffs: records
      .filter(({ changedPixelsObserved }) => changedPixelsObserved)
      .map(({ scenario, screen, current, archived }) => ({
        scenario,
        screen,
        currentSha256: current.sha256,
        archivedFirstSha256: archived.firstSha256,
        archivedRepeatSha256: archived.repeatSha256,
        reason:
          "changed pixels are allowed because the current renderer method differs from the archived capture method",
      })),
    mismatches: [],
    byteComparisonToReplacedHistoricalFiles: false,
    historicalFilesRead: [],
    records,
  } as const;
};

const boundedOutput = (value: string) => {
  const bytes = Buffer.from(value);
  if (bytes.byteLength <= maxCapturedOutputBytes) {
    return { value, truncated: false, bytes: bytes.byteLength };
  }
  return {
    value: bytes.subarray(0, maxCapturedOutputBytes).toString("utf8"),
    truncated: true,
    bytes: bytes.byteLength,
  };
};

const captureFocusedChecks = async () => {
  const command =
    "bun test --max-concurrency=1 apps/deskohub-workspace/scripts/account-visual/run.test.tsx -t 'archival|controlled fixture'";
  const child = Bun.spawn(
    [
      process.execPath,
      "test",
      "--max-concurrency=1",
      "apps/deskohub-workspace/scripts/account-visual/run.test.tsx",
      "-t",
      "archival|controlled fixture",
    ],
    {
      cwd: repoRoot,
      stderr: "pipe",
      stdout: "pipe",
    }
  );
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  const boundedStdout = boundedOutput(stdout);
  const boundedStderr = boundedOutput(stderr);
  const combined = `${stdout}\n${stderr}`;
  return {
    name: "archival hash verifier focused tests",
    command,
    cwd: repoRoot,
    exitCode,
    status: exitCode === 0 ? "passed" : "failed",
    stdout: boundedStdout.value,
    stderr: boundedStderr.value,
    stdoutTruncated: boundedStdout.truncated,
    stderrTruncated: boundedStderr.truncated,
    counts: {
      tests: Number(combined.match(/Ran (\d+) tests/)?.[1] ?? 0),
      passed: Number(combined.match(/(\d+) pass/)?.[1] ?? 0),
      failed: Number(combined.match(/(\d+) fail/)?.[1] ?? 0),
      expectCalls: Number(combined.match(/(\d+) expect\(\) calls/)?.[1] ?? 0),
      stderrBytes: boundedStderr.bytes,
    },
  } as const;
};

const verifyExternalChecks = async ({
  checksPath,
  populatedCapture,
}: {
  readonly checksPath: string;
  readonly populatedCapture: CurrentCapture;
}) => {
  const checks = await readChecksEvidence(checksPath);
  const declaredManifestPath = resolve(checks.evidence.sourceManifest.path);
  assert(
    declaredManifestPath === populatedCapture.captureMethodManifest.path,
    "External checks are not bound to the current populated capture manifest"
  );
  const declaredDigest = await fileDigest(declaredManifestPath);
  assert(
    declaredDigest.sha256 === checks.evidence.sourceManifest.sha256 &&
      declaredDigest.bytes === checks.evidence.sourceManifest.bytes,
    "External checks source-manifest digest drifted"
  );
  return {
    path: checks.digest.path,
    sha256: checks.digest.sha256,
    bytes: checks.digest.bytes,
    sourceManifest: checks.evidence.sourceManifest,
    bindsCaptureRunnerManifest: true,
    bindsCurrentArchivalGenerator: false,
    note: "These checks were captured for the renderer/test runner before this archival generator report and do not attest the current archival generator.",
    attestations: checks.evidence.attestations.map(compactCheckAttestation),
  } as const;
};

const replacedHistoricalPaths = (visualRoot: string) => [
  join(visualRoot, "after-corrected-v2-3"),
  join(visualRoot, "populated-corrected-v2-5"),
  join(visualRoot, "cs-corrected-v2-3"),
  join(visualRoot, "after-corrected-v2-4"),
  join(visualRoot, "after-corrected-v2-5"),
  join(visualRoot, "populated-corrected-v2-6"),
  join(visualRoot, "populated-corrected-v2-7"),
  join(visualRoot, "cs-corrected-v2-4"),
  join(visualRoot, "cs-corrected-v2-5"),
];

export const createArchivalHashVerificationReport = async ({
  archivePath = defaultArchivePath,
  checksPath = currentChecksPath,
  focusedChecks,
  outputPath,
  visualRoot = defaultVisualRoot,
}: {
  readonly archivePath?: string;
  readonly checksPath?: string;
  readonly focusedChecks?: Awaited<ReturnType<typeof captureFocusedChecks>>;
  readonly outputPath?: string;
  readonly visualRoot?: string;
} = {}) => {
  const resolvedVisualRoot = resolve(visualRoot);
  const resolvedArchivePath = resolve(archivePath);
  const resolvedChecksPath = resolve(checksPath);
  const resolvedOutputPath = resolve(
    outputPath ?? join(resolvedVisualRoot, archivalReportName)
  );
  assert(
    resolvedOutputPath === join(resolvedVisualRoot, archivalReportName),
    `Archival report output must be ${archivalReportName} under VISUAL_ROOT`
  );
  for (const forbiddenPath of [
    resolvedArchivePath,
    join(resolvedVisualRoot, "final-verification.json"),
    join(resolvedVisualRoot, "final-native-validation-verification.json"),
    join(resolvedVisualRoot, "source-snapshot.json"),
    resolvedChecksPath,
  ]) {
    assert(
      resolvedOutputPath !== forbiddenPath,
      "Archival report cannot overwrite an existing evidence file"
    );
  }

  const pinned = await readPinnedArchive(resolvedArchivePath);
  const currentCaptures: CurrentCapture[] = [];
  for (const definition of archivalRunDefinitions) {
    currentCaptures.push(
      await readCurrentCapture({ definition, visualRoot: resolvedVisualRoot })
    );
  }
  const populatedCapture = currentCaptures.find(
    ({ definition }) => definition.key === "populated"
  );
  if (populatedCapture === undefined)
    throw new Error("Missing populated capture");
  const externalChecks = await verifyExternalChecks({
    checksPath: resolvedChecksPath,
    populatedCapture,
  });
  const archivalPngComparison = compareCurrentPngs({
    archivedRuns: pinned.runs,
    currentCaptures,
  });
  const currentGeneratorPath = resolve(
    import.meta.dir,
    "create-account-visual-verification.ts"
  );
  const currentGeneratorDigest = await fileDigest(currentGeneratorPath);
  const focused = focusedChecks ?? (await captureFocusedChecks());
  assert(focused.exitCode === 0, "Archival hash verifier focused tests failed");

  const nativeValidation = compactNativeValidation(populatedCapture.execution);
  const archivalRuns = pinned.runs.map((run) => ({
    scenario: run.scenario,
    firstOutputDirectory: run.firstOutputDirectory,
    repeatOutputDirectory: run.repeatOutputDirectory,
    firstSourceManifest: run.firstSourceManifest,
    repeatSourceManifest: run.repeatSourceManifest,
    pngHashRecords: run.pngs,
  }));
  const currentCaptureSummaries = currentCaptures.map((capture) => ({
    scenario: capture.definition.key,
    label: capture.definition.finalLabel,
    outputDirectory: capture.outputDirectory,
    adapter: capture.definition.adapter,
    locale: capture.definition.locale,
    mode: capture.definition.mode,
    status: "passed",
    comparison: capture.comparison,
    captureMethodManifest: capture.captureMethodManifest,
    mainPngs: capture.pngs,
  }));

  const output = {
    schemaVersion: 1,
    reportKind: "archival-hash-verification",
    status: "passed",
    capturePolicy: {
      finalProductionCaptures: "paused-until-caller-resumes-with-profile-hash",
      verifierCreatesCaptures: false,
      verifierReadsReplacedHistoricalFiles: false,
    },
    generatedBy: {
      path: currentGeneratorPath,
      sha256: currentGeneratorDigest.sha256,
      bytes: currentGeneratorDigest.bytes,
    },
    supersededReports: [
      {
        path: join(
          resolvedVisualRoot,
          "final-native-validation-verification.json"
        ),
        status: "superseded-invalid-for-archival-comparison",
        reason:
          "The prior report compared current captures with corrected directories that were later replaced; it is not historical evidence.",
      },
    ],
    evidenceLoss: {
      originalPngFilesAndManifestBytesLost: true,
      replacedPaths: replacedHistoricalPaths(resolvedVisualRoot),
      currentRecapturesNotHistorical: true,
      originalFirstRepeatUnavailable: true,
      archiveHashRecordsReviewedPrior: true,
      note: "The retained archive is accepted as an archival hash record only. Current recaptures are not recovered original artifacts, even where their bytes have the same SHA-256.",
    },
    archive: {
      path: resolvedArchivePath,
      sha256: pinned.archiveDigest.sha256,
      bytes: pinned.archiveDigest.bytes,
      pinnedSha256: pinnedArchive.sha256,
      pinnedBytes: pinnedArchive.bytes,
      status: "verified",
      role: "archival-hash-record-only; original PNG files and manifest bytes are lost",
      originalProfileForm: pinned.originalProfileForm,
      correctedV2: archivalRuns,
    },
    archiveComparison: archivalPngComparison,
    currentCaptures: currentCaptureSummaries,
    nativeValidation,
    historicalRepeatability: {
      source: resolvedArchivePath,
      sourceSha256: pinned.archiveDigest.sha256,
      suppliedArchivedAttestationOnly: true,
      independentCurrentRecheck: false,
      note: "First/repeat equality is supplied by the pinned archive record. No current capture was used as a historical repeatability recheck.",
      scenarios: archivalRuns.map(
        ({
          scenario,
          firstOutputDirectory,
          repeatOutputDirectory,
          firstSourceManifest,
          repeatSourceManifest,
          pngHashRecords,
        }) => ({
          scenario,
          firstOutputDirectory,
          repeatOutputDirectory,
          sourceManifestPairEqual:
            firstSourceManifest.sha256 === repeatSourceManifest.sha256 &&
            firstSourceManifest.bytes === repeatSourceManifest.bytes,
          archivedMainPngHashPairsEqual: pngHashRecords.every(
            ({ firstSha256, repeatSha256 }) => firstSha256 === repeatSha256
          ),
        })
      ),
    },
    sourceVerification: {
      currentCaptureMethodManifests: currentCaptures.map(
        ({ definition, captureMethodManifest, comparison }) => ({
          scenario: definition.key,
          manifest: captureMethodManifest,
          comparison,
          note: "This capture-time manifest is read unchanged. Its generatorAtCapture entry is not replaced with the current report generator digest.",
        })
      ),
      reportGeneratorAtReportGeneration: {
        path: displayPath(currentGeneratorPath),
        sha256: currentGeneratorDigest.sha256,
        bytes: currentGeneratorDigest.bytes,
      },
      archivedOriginalProfileForm: pinned.originalProfileForm,
    },
    externalChecks,
    focusedChecks: {
      ...focused,
      generatorAtReportGeneration: {
        path: displayPath(currentGeneratorPath),
        sha256: currentGeneratorDigest.sha256,
        bytes: currentGeneratorDigest.bytes,
      },
      note: "These focused tests attest the current archival verifier implementation; they are separate from the older capture-runner checks.",
    },
  } as const;

  await writeFile(
    resolvedOutputPath,
    `${JSON.stringify(output, null, 2)}\n`,
    "utf8"
  );
  return output;
};

if (import.meta.main) {
  try {
    const options = parseVerificationArgs(Bun.argv.slice(2));
    if (options.help) {
      process.stdout.write(VERIFICATION_HELP);
    } else {
      const report = await createArchivalHashVerificationReport({
        archivePath: options.archivePath,
        checksPath: options.checksPath!,
        outputPath: options.outputPath,
        visualRoot: options.visualRoot,
      });
      process.stdout.write(
        `${JSON.stringify(
          {
            path: options.outputPath,
            status: report.status,
            total: report.archiveComparison.total,
            matchesPreviouslyRecordedHistoricalPngHash:
              report.archiveComparison
                .matchesPreviouslyRecordedHistoricalPngHash,
          },
          null,
          2
        )}\n`
      );
    }
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`
    );
    process.exitCode = 1;
  }
}
