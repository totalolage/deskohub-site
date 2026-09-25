import "../../shared/polyfills/temporal";

import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { DotyposCustomerIdSchema } from "@deskohub/dotypos";
import type { Page } from "@playwright/test";
import { Cause, Effect, Exit, Fiber } from "effect";
import { countOccurrences } from "../../scripts/shared/source-contract";
import { formatWorkspaceE2EFailure, type WorkspaceE2EError } from "../errors";
import { workspaceE2EPollIntervalMs, workspaceE2ETimeouts } from "../timeouts";
import {
  classifyWorkspaceE2EMarketingConsentPersistence,
  makeWorkspaceE2EMarketingPreferencesSeedRow,
  matchesRejectedReplayAlerts,
  navigateAuthenticatedWorkspaceE2EMarketingPreferences,
  navigateWorkspaceE2EMarketingPreferences,
  runWorkspaceE2EMarketingBrowserOperation,
  verifyWorkspaceE2EMarketingPreferences,
  type WorkspaceE2EMarketingConsentPersistenceClassification,
  type WorkspaceE2EMarketingConsentPersistenceDiagnostic,
  type WorkspaceE2EMarketingConsentPoller,
  waitForWorkspaceE2EMarketingConsentPersistence,
  workspaceE2EMarketingBrowserOperationLabels,
} from "./marketing-preferences";

const baseUrl = "https://deskohub-workspace-marketing.example.test";
const customerId = DotyposCustomerIdSchema.make(
  "marketing-preferences-test-customer"
);
const rawLinkToken = Buffer.alloc(32, 0x37).toString("base64url");
const linkTokenHash = createHash("sha256")
  .update(rawLinkToken, "utf8")
  .digest("hex");
const now = Temporal.Instant.from("2030-01-01T03:04:05Z");
const browserFailureMessage =
  "Marketing preferences browser verification failed";
const invalidMarketingManagementActionMessage =
  "This marketing management link is invalid or has expired.";

type GotoOptions = Parameters<Page["goto"]>[1];

const makeFakePage = (
  goto: (url: string, options: GotoOptions) => Promise<void>,
  initialUrl = ""
) => {
  let currentUrl = initialUrl;
  const gotoCalls: Array<{
    readonly options: GotoOptions;
    readonly url: string;
  }> = [];
  const page = Object.assign({} as Page, {
    goto: async (url: string, options: GotoOptions) => {
      gotoCalls.push({ options, url });
      await goto(url, options);
      currentUrl = url;
      return null;
    },
    url: () => currentUrl,
  });

  return { gotoCalls, page };
};

type PromiseGate = {
  readonly promise: Promise<void>;
  readonly resolve: () => void;
};

const makePromiseGate = (): PromiseGate => {
  let resolve!: () => void;
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
};

const flushMicrotasks = async (): Promise<void> => {
  for (let index = 0; index < 5; index += 1) await Promise.resolve();
};

type SyntheticMarketingConsent = {
  readonly dotyposCustomerId: string;
  readonly documentHash: string;
  readonly grantedAt: string;
  readonly locale: "en-US";
  readonly withdrawnAt: string | null;
};

type SyntheticMarketingFixtureState = {
  consent: SyntheticMarketingConsent;
  tokenHashes: string[];
};

type MarketingConsentRow = NonNullable<
  Parameters<
    typeof classifyWorkspaceE2EMarketingConsentPersistence
  >[0]["consent"]
>;

const expectedConsentDocumentHash = "synthetic-expected-document-hash";

const makeMarketingConsentRow = (
  overrides: Partial<MarketingConsentRow> = {}
): MarketingConsentRow => ({
  dotyposCustomerId: customerId,
  documentHash: expectedConsentDocumentHash,
  grantedAt: now,
  locale: "en-US",
  withdrawnAt: null,
  ...overrides,
});

const expectedHexDocumentHash = "b".repeat(64);
const persistedHexDocumentHash = "a".repeat(64);
const changedHexDocumentHash = "c".repeat(64);
const syntheticSensitiveDocumentHash = "synthetic-sensitive-document-hash";

/**
 * Deliberately injects a runtime-corrupted hash value into an otherwise
 * typed synthetic consent row, exercising the projection against row data
 * the static type cannot describe without asserting past the signature.
 */
const injectSyntheticConsentDocumentHash = (
  documentHash: unknown
): MarketingConsentRow => {
  const row = makeMarketingConsentRow();
  Object.defineProperty(row, "documentHash", {
    configurable: true,
    enumerable: true,
    value: documentHash,
    writable: true,
  });
  return row;
};

type MarketingConsentPersistenceScenario = {
  readonly documentHash: string;
  readonly observations: ReadonlyArray<MarketingConsentRow | null>;
};

const runMarketingConsentPersistenceScenario = async (
  input: MarketingConsentPersistenceScenario
): Promise<{
  readonly logRecords: WorkspaceE2EMarketingConsentPersistenceDiagnostic[];
  readonly readCount: number;
  readonly timeline: string[];
}> => {
  const logRecords: WorkspaceE2EMarketingConsentPersistenceDiagnostic[] = [];
  const timeline: string[] = [];
  let readCount = 0;
  const poll: WorkspaceE2EMarketingConsentPoller = (effect) =>
    Effect.gen(function* () {
      timeline.push("poll-start");
      while (true) {
        const consent = yield* effect;
        timeline.push(`observation:${readCount}`);
        if (consent !== undefined) return consent;
      }
    });

  await Effect.runPromise(
    waitForWorkspaceE2EMarketingConsentPersistence({
      documentHash: input.documentHash,
      expectedStatus: "active",
      log: (diagnostic) =>
        Effect.sync(() => {
          timeline.push(`log:${diagnostic.reason}`);
          logRecords.push(diagnostic);
        }),
      poll,
      read: Effect.sync(() => {
        const consent = input.observations[readCount];
        readCount += 1;
        timeline.push(`read:${readCount}`);
        if (consent === undefined) {
          throw new Error("synthetic scenario poll exhausted");
        }
        return consent;
      }),
    })
  );

  return { logRecords, readCount, timeline };
};

const cloneSyntheticMarketingFixtureState = (
  state: SyntheticMarketingFixtureState
): SyntheticMarketingFixtureState => ({
  consent: { ...state.consent },
  tokenHashes: [...state.tokenHashes],
});

const makeSyntheticMarketingFixture = () => {
  const original: SyntheticMarketingFixtureState = {
    consent: {
      documentHash: "synthetic-marketing-document-hash",
      dotyposCustomerId: customerId,
      grantedAt: "2030-01-01T03:04:05Z",
      locale: "en-US",
      withdrawnAt: null,
    },
    tokenHashes: ["synthetic-existing-token-hash"],
  };
  const state = cloneSyntheticMarketingFixtureState(original);

  return {
    original,
    restore: () => {
      const restored = cloneSyntheticMarketingFixtureState(original);
      state.consent = restored.consent;
      state.tokenHashes = restored.tokenHashes;
    },
    state,
  };
};

describe("workspace marketing preferences helper", () => {
  test("computes a 720-hour expiry and preserves a hash-only link seed row", () => {
    const row = makeWorkspaceE2EMarketingPreferencesSeedRow({
      customerId,
      now,
      tokenHash: linkTokenHash,
    });

    expect(row).toEqual({
      dotyposCustomerId: customerId,
      expiresAt: now.add({ hours: 720 }),
      purpose: "link",
      revokedAt: null,
      tokenHash: linkTokenHash,
    });
    expect(row.expiresAt.since(now, { largestUnit: "hours" }).hours).toBe(720);
    expect(row.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(row.tokenHash).toBe(linkTokenHash);
    expect(row.tokenHash).not.toBe(rawLinkToken);
    expect(JSON.stringify(row)).not.toContain(rawLinkToken);
    expect(row).not.toHaveProperty("rawLinkToken");
  });

  test("uses the link purpose and leaves a seeded link unrevoked", () => {
    const row = makeWorkspaceE2EMarketingPreferencesSeedRow({
      customerId,
      now,
      tokenHash: linkTokenHash,
    });

    expect(row.purpose).toBe("link");
    expect(row.revokedAt).toBeNull();
  });

  test.each([
    {
      consent: null,
      expected: {
        documentHashMatches: false,
        localeMatches: false,
        reason: "row_missing",
        rowExists: false,
        withdrawnStateMatches: false,
      },
      expectedStatus: "active" as const,
      name: "a missing row",
    },
    {
      consent: makeMarketingConsentRow({
        documentHash: "synthetic-actual-document-hash",
      }),
      expected: {
        documentHashMatches: false,
        localeMatches: true,
        reason: "document_hash_mismatch",
        rowExists: true,
        withdrawnStateMatches: true,
      },
      expectedStatus: "active" as const,
      name: "a document hash mismatch",
    },
    {
      consent: makeMarketingConsentRow({ locale: "cs-CZ" }),
      expected: {
        documentHashMatches: true,
        localeMatches: false,
        reason: "locale_mismatch",
        rowExists: true,
        withdrawnStateMatches: true,
      },
      expectedStatus: "active" as const,
      name: "a locale mismatch",
    },
    {
      consent: makeMarketingConsentRow(),
      expected: {
        documentHashMatches: true,
        localeMatches: true,
        reason: "matched",
        rowExists: true,
        withdrawnStateMatches: true,
      },
      expectedStatus: "active" as const,
      name: "an active consent",
    },
    {
      consent: makeMarketingConsentRow({
        withdrawnAt: now.add({ hours: 1 }),
      }),
      expected: {
        documentHashMatches: true,
        localeMatches: true,
        reason: "withdrawn_state_mismatch",
        rowExists: true,
        withdrawnStateMatches: false,
      },
      expectedStatus: "active" as const,
      name: "an active-state mismatch",
    },
    {
      consent: makeMarketingConsentRow({
        withdrawnAt: now.add({ hours: 1 }),
      }),
      expected: {
        documentHashMatches: true,
        localeMatches: true,
        reason: "matched",
        rowExists: true,
        withdrawnStateMatches: true,
      },
      expectedStatus: "withdrawn" as const,
      name: "a withdrawn consent",
    },
    {
      consent: makeMarketingConsentRow(),
      expected: {
        documentHashMatches: true,
        localeMatches: true,
        reason: "withdrawn_state_mismatch",
        rowExists: true,
        withdrawnStateMatches: false,
      },
      expectedStatus: "withdrawn" as const,
      name: "a withdrawn-state mismatch",
    },
  ])(
    "classifies $name using only persisted consent requirements",
    ({ consent, expected, expectedStatus }) => {
      expect(
        classifyWorkspaceE2EMarketingConsentPersistence({
          consent,
          documentHash: expectedConsentDocumentHash,
          expectedStatus,
        })
      ).toEqual(expected);
    }
  );

  test("logs only changed persisted-consent classifications through a fake poll", async () => {
    const actualDocumentHash = "synthetic-actual-document-hash";
    const observations: Array<MarketingConsentRow | null> = [
      null,
      makeMarketingConsentRow({ documentHash: actualDocumentHash }),
      makeMarketingConsentRow({
        documentHash: actualDocumentHash,
        grantedAt: now.add({ hours: 2 }),
      }),
      makeMarketingConsentRow({ locale: "cs-CZ" }),
      makeMarketingConsentRow({ withdrawnAt: now.add({ hours: 1 }) }),
      makeMarketingConsentRow(),
    ];
    const logRecords: WorkspaceE2EMarketingConsentPersistenceClassification[] =
      [];
    const timeline: string[] = [];
    const pollCalls: Array<{
      readonly intervalMs: number;
      readonly label: string;
      readonly timeoutMs: number;
    }> = [];
    let readCount = 0;
    const poll: WorkspaceE2EMarketingConsentPoller = (effect, options) =>
      Effect.gen(function* () {
        pollCalls.push(options);
        timeline.push("poll-start");
        while (true) {
          const consent = yield* effect;
          timeline.push(`observation:${readCount}`);
          if (consent !== undefined) return consent;
        }
      });

    await Effect.runPromise(
      waitForWorkspaceE2EMarketingConsentPersistence({
        documentHash: expectedConsentDocumentHash,
        expectedStatus: "active",
        log: (classification) =>
          Effect.sync(() => {
            timeline.push(`log:${classification.reason}`);
            logRecords.push(classification);
          }),
        poll,
        read: Effect.sync(() => {
          const consent = observations[readCount];
          readCount += 1;
          timeline.push(`read:${readCount}`);
          if (consent === undefined) {
            throw new Error("synthetic fake poll exhausted");
          }
          return consent;
        }),
      })
    );

    expect(readCount).toBe(observations.length);
    expect(timeline).toEqual([
      "poll-start",
      "read:1",
      "log:row_missing",
      "observation:1",
      "read:2",
      "log:document_hash_mismatch",
      "observation:2",
      "read:3",
      "observation:3",
      "read:4",
      "log:locale_mismatch",
      "observation:4",
      "read:5",
      "log:withdrawn_state_mismatch",
      "observation:5",
      "read:6",
      "log:matched",
      "observation:6",
    ]);
    expect(pollCalls).toEqual([
      {
        intervalMs: workspaceE2EPollIntervalMs.datasource,
        label: "marketing preference active persisted",
        timeoutMs: workspaceE2ETimeouts.datasource,
      },
    ]);
    expect(logRecords).toEqual([
      {
        documentHashMatches: false,
        localeMatches: false,
        reason: "row_missing",
        rowExists: false,
        withdrawnStateMatches: false,
      },
      {
        documentHashMatches: false,
        localeMatches: true,
        reason: "document_hash_mismatch",
        rowExists: true,
        withdrawnStateMatches: true,
      },
      {
        documentHashMatches: true,
        localeMatches: false,
        reason: "locale_mismatch",
        rowExists: true,
        withdrawnStateMatches: true,
      },
      {
        documentHashMatches: true,
        localeMatches: true,
        reason: "withdrawn_state_mismatch",
        rowExists: true,
        withdrawnStateMatches: false,
      },
      {
        documentHashMatches: true,
        localeMatches: true,
        reason: "matched",
        rowExists: true,
        withdrawnStateMatches: true,
      },
    ]);

    const serializedLogs = JSON.stringify(logRecords);
    for (const sensitiveSentinel of [
      actualDocumentHash,
      expectedConsentDocumentHash,
      customerId,
      "cs-CZ",
      now.toString(),
      rawLinkToken,
      baseUrl,
      "synthetic fake poll exhausted",
    ]) {
      expect(serializedLogs).not.toContain(sensitiveSentinel);
    }
  });

  test("logs both document digests on a valid-hex document hash mismatch", async () => {
    const { logRecords, readCount } =
      await runMarketingConsentPersistenceScenario({
        documentHash: expectedHexDocumentHash,
        observations: [
          makeMarketingConsentRow({ documentHash: persistedHexDocumentHash }),
          makeMarketingConsentRow({ documentHash: expectedHexDocumentHash }),
        ],
      });

    expect(logRecords).toEqual([
      {
        documentHashMatches: false,
        expectedDocumentHash: expectedHexDocumentHash,
        localeMatches: true,
        persistedDocumentHash: persistedHexDocumentHash,
        reason: "document_hash_mismatch",
        rowExists: true,
        withdrawnStateMatches: true,
      },
      {
        documentHashMatches: true,
        localeMatches: true,
        reason: "matched",
        rowExists: true,
        withdrawnStateMatches: true,
      },
    ]);
    expect(readCount).toBe(2);
  });

  test.each([
    {
      hash: 12345,
      name: "a nonstring persisted hash",
      sentinel: "12345",
    },
    {
      hash: null,
      name: "a null persisted hash",
      sentinel: "null",
    },
    {
      hash: undefined,
      name: "an undefined persisted hash",
      sentinel: "undefined",
    },
    {
      hash: { intruder: true },
      name: "an object persisted hash",
      sentinel: "intruder",
    },
    {
      hash: `${"a".repeat(64)}\n`,
      name: "a valid-hex persisted hash with a trailing newline",
      sentinel: `${"a".repeat(64)}\n`,
    },
    {
      hash: `${"a".repeat(64)}\r`,
      name: "a valid-hex persisted hash with a trailing carriage return",
      sentinel: `${"a".repeat(64)}\r`,
    },
    {
      hash: `${"a".repeat(64)}\r\n`,
      name: "a valid-hex persisted hash with a trailing CRLF",
      sentinel: `${"a".repeat(64)}\r\n`,
    },
    {
      hash: "a".repeat(65),
      name: "a 65-character persisted hash",
      sentinel: "a".repeat(65),
    },
    {
      hash: "g".repeat(64),
      name: "a nonhex persisted hash",
      sentinel: "g".repeat(64),
    },
    {
      hash: syntheticSensitiveDocumentHash,
      name: "a synthetic sensitive persisted hash",
      sentinel: syntheticSensitiveDocumentHash,
    },
  ])(
    "omits both digests for $name on a document hash mismatch",
    async ({ hash, sentinel }) => {
      const { logRecords } = await runMarketingConsentPersistenceScenario({
        documentHash: expectedHexDocumentHash,
        observations: [
          injectSyntheticConsentDocumentHash(hash),
          makeMarketingConsentRow({ documentHash: expectedHexDocumentHash }),
        ],
      });

      expect(logRecords).toHaveLength(2);
      expect(logRecords[0]).not.toHaveProperty("persistedDocumentHash");
      expect(logRecords[0]).not.toHaveProperty("expectedDocumentHash");
      expect(logRecords[0]?.reason).toBe("document_hash_mismatch");
      expect(logRecords[1]?.reason).toBe("matched");
      const serializedLogs = JSON.stringify(logRecords);
      expect(serializedLogs).not.toContain(sentinel);
    }
  );

  test.each([
    {
      hash: "a".repeat(65),
      name: "a 65-character expected hash",
      sentinel: "a".repeat(65),
    },
    {
      hash: "g".repeat(64),
      name: "a nonhex expected hash",
      sentinel: "g".repeat(64),
    },
    {
      hash: `${"b".repeat(64)}\n`,
      name: "a valid-hex expected hash with a trailing newline",
      sentinel: `${"b".repeat(64)}\n`,
    },
    {
      hash: `${"b".repeat(64)}\r`,
      name: "a valid-hex expected hash with a trailing carriage return",
      sentinel: `${"b".repeat(64)}\r`,
    },
    {
      hash: `${"b".repeat(64)}\r\n`,
      name: "a valid-hex expected hash with a trailing CRLF",
      sentinel: `${"b".repeat(64)}\r\n`,
    },
    {
      hash: syntheticSensitiveDocumentHash,
      name: "a synthetic sensitive expected hash",
      sentinel: syntheticSensitiveDocumentHash,
    },
  ])(
    "omits both digests for $name while the persisted hash is valid",
    async ({ hash, sentinel }) => {
      const { logRecords } = await runMarketingConsentPersistenceScenario({
        documentHash: hash,
        observations: [
          makeMarketingConsentRow({ documentHash: persistedHexDocumentHash }),
          makeMarketingConsentRow({ documentHash: hash }),
        ],
      });

      expect(logRecords).toHaveLength(2);
      expect(logRecords[0]).not.toHaveProperty("persistedDocumentHash");
      expect(logRecords[0]).not.toHaveProperty("expectedDocumentHash");
      expect(logRecords[0]?.reason).toBe("document_hash_mismatch");
      expect(logRecords[1]?.reason).toBe("matched");
      const serializedLogs = JSON.stringify(logRecords);
      expect(serializedLogs).not.toContain(sentinel);
    }
  );

  test("omits both digest keys when the row is missing or matched", async () => {
    const classifierKeys = [
      "documentHashMatches",
      "localeMatches",
      "reason",
      "rowExists",
      "withdrawnStateMatches",
    ];
    const { logRecords } = await runMarketingConsentPersistenceScenario({
      documentHash: expectedHexDocumentHash,
      observations: [
        null,
        makeMarketingConsentRow({ documentHash: expectedHexDocumentHash }),
      ],
    });

    expect(logRecords).toHaveLength(2);
    expect(logRecords.map((record) => Object.keys(record).sort())).toEqual([
      classifierKeys,
      classifierKeys,
    ]);
  });

  test("logs a changed valid digest again under the same mismatch classification", async () => {
    const { logRecords } = await runMarketingConsentPersistenceScenario({
      documentHash: expectedHexDocumentHash,
      observations: [
        makeMarketingConsentRow({ documentHash: persistedHexDocumentHash }),
        makeMarketingConsentRow({ documentHash: persistedHexDocumentHash }),
        makeMarketingConsentRow({ documentHash: changedHexDocumentHash }),
        makeMarketingConsentRow({ documentHash: expectedHexDocumentHash }),
      ],
    });

    expect(logRecords).toEqual([
      {
        documentHashMatches: false,
        expectedDocumentHash: expectedHexDocumentHash,
        localeMatches: true,
        persistedDocumentHash: persistedHexDocumentHash,
        reason: "document_hash_mismatch",
        rowExists: true,
        withdrawnStateMatches: true,
      },
      {
        documentHashMatches: false,
        expectedDocumentHash: expectedHexDocumentHash,
        localeMatches: true,
        persistedDocumentHash: changedHexDocumentHash,
        reason: "document_hash_mismatch",
        rowExists: true,
        withdrawnStateMatches: true,
      },
      {
        documentHashMatches: true,
        localeMatches: true,
        reason: "matched",
        rowExists: true,
        withdrawnStateMatches: true,
      },
    ]);
  });

  test("retains a valid-digest mismatch diagnostic when a poll is interrupted", async () => {
    const logRecords: WorkspaceE2EMarketingConsentPersistenceDiagnostic[] = [];
    const pollStarted = makePromiseGate();
    const releasePending = makePromiseGate();
    const poll: WorkspaceE2EMarketingConsentPoller = (effect) =>
      Effect.gen(function* () {
        yield* effect;
        pollStarted.resolve();
        yield* Effect.promise(() => releasePending.promise);
        yield* Effect.never;
      });
    const operation = waitForWorkspaceE2EMarketingConsentPersistence({
      documentHash: expectedHexDocumentHash,
      expectedStatus: "active",
      log: (diagnostic) =>
        Effect.sync(() => {
          logRecords.push(diagnostic);
        }),
      poll,
      read: Effect.sync(() =>
        makeMarketingConsentRow({ documentHash: persistedHexDocumentHash })
      ),
    });

    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          const fiber = yield* Effect.forkChild(operation);
          yield* Effect.promise(() => pollStarted.promise);

          const interruption = yield* Effect.forkChild(Fiber.interrupt(fiber));
          yield* Fiber.join(interruption);
          const exit = yield* Fiber.await(fiber);
          expect(Exit.isFailure(exit)).toBe(true);
          if (Exit.isFailure(exit)) {
            expect(Cause.hasInterruptsOnly(exit.cause)).toBe(true);
          }
        })
      );
    } finally {
      releasePending.resolve();
      await flushMicrotasks();
    }

    expect(logRecords).toEqual([
      {
        documentHashMatches: false,
        expectedDocumentHash: expectedHexDocumentHash,
        localeMatches: true,
        persistedDocumentHash: persistedHexDocumentHash,
        reason: "document_hash_mismatch",
        rowExists: true,
        withdrawnStateMatches: true,
      },
    ]);
  });

  test("retains the last mismatch when a pending consent poll is interrupted", async () => {
    const actualDocumentHash = "synthetic-actual-document-hash";
    const observations: Array<MarketingConsentRow | null> = [
      null,
      makeMarketingConsentRow({ documentHash: actualDocumentHash }),
    ];
    const logRecords: WorkspaceE2EMarketingConsentPersistenceClassification[] =
      [];
    const timeline: string[] = [];
    const pollWaiting = makePromiseGate();
    const pendingPoll = makePromiseGate();
    let readCount = 0;
    let pollAdvancedPastPending = false;
    const poll: WorkspaceE2EMarketingConsentPoller = (effect) =>
      Effect.gen(function* () {
        timeline.push("poll-start");
        yield* effect;
        timeline.push("observation:1");
        yield* effect;
        timeline.push("observation:2");
        pollWaiting.resolve();
        yield* Effect.promise(() => pendingPoll.promise);
        pollAdvancedPastPending = true;
        yield* Effect.never;
      });
    const operation = waitForWorkspaceE2EMarketingConsentPersistence({
      documentHash: expectedConsentDocumentHash,
      expectedStatus: "active",
      log: (classification) =>
        Effect.sync(() => {
          timeline.push(`log:${classification.reason}`);
          logRecords.push(classification);
        }),
      poll,
      read: Effect.sync(() => {
        const consent = observations[readCount];
        readCount += 1;
        timeline.push(`read:${readCount}`);
        if (consent === undefined) {
          throw new Error("synthetic pending poll exhausted");
        }
        return consent;
      }),
    });

    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          const fiber = yield* Effect.forkChild(operation);
          yield* Effect.promise(() => pollWaiting.promise);

          expect(timeline).toEqual([
            "poll-start",
            "read:1",
            "log:row_missing",
            "observation:1",
            "read:2",
            "log:document_hash_mismatch",
            "observation:2",
          ]);
          expect(logRecords).toEqual([
            {
              documentHashMatches: false,
              localeMatches: false,
              reason: "row_missing",
              rowExists: false,
              withdrawnStateMatches: false,
            },
            {
              documentHashMatches: false,
              localeMatches: true,
              reason: "document_hash_mismatch",
              rowExists: true,
              withdrawnStateMatches: true,
            },
          ]);

          const interruption = yield* Effect.forkChild(Fiber.interrupt(fiber));
          yield* Fiber.join(interruption);
          const exit = yield* Fiber.await(fiber);
          expect(Exit.isFailure(exit)).toBe(true);
          if (Exit.isFailure(exit)) {
            expect(Cause.hasInterruptsOnly(exit.cause)).toBe(true);
          }
        })
      );
    } finally {
      pendingPoll.resolve();
      await flushMicrotasks();
    }

    expect(pollAdvancedPastPending).toBe(false);
    expect(readCount).toBe(2);
    expect(logRecords.at(-1)).toEqual({
      documentHashMatches: false,
      localeMatches: true,
      reason: "document_hash_mismatch",
      rowExists: true,
      withdrawnStateMatches: true,
    });

    const serializedLogs = JSON.stringify(logRecords);
    for (const sensitiveSentinel of [
      actualDocumentHash,
      expectedConsentDocumentHash,
      customerId,
      "cs-CZ",
      now.toString(),
      rawLinkToken,
      baseUrl,
      "synthetic pending poll exhausted",
    ]) {
      expect(serializedLogs).not.toContain(sensitiveSentinel);
    }
  });

  test("exposes only the allowlisted label when a known browser operation fails", async () => {
    const knownLabel = "confirm marketing management link";
    expect(workspaceE2EMarketingBrowserOperationLabels).toContain(knownLabel);
    const sensitiveCause = new Error(
      `raw cause with ${rawLinkToken} ${baseUrl} and customer ${customerId}`
    );
    const exit = await Effect.runPromiseExit(
      runWorkspaceE2EMarketingBrowserOperation(knownLabel, () =>
        Promise.reject(sensitiveCause)
      )
    );

    expect(Exit.isFailure(exit)).toBe(true);
    if (!Exit.isFailure(exit)) return;
    const failure = Cause.squash(exit.cause) as WorkspaceE2EError;
    expect(failure.operation).toBe(knownLabel);
    expect(failure.cause).toBeUndefined();
    expect(failure.causes).toBeUndefined();
    expect(failure.message).toBe(
      `${browserFailureMessage} during ${knownLabel}`
    );
    const formatted = formatWorkspaceE2EFailure(failure);
    expect(formatted).toContain(
      `${browserFailureMessage} during ${knownLabel}`
    );
    const sensitiveSentinels = [
      rawLinkToken,
      baseUrl,
      customerId,
      sensitiveCause.message,
    ];
    for (const sentinel of sensitiveSentinels) {
      expect(failure.message).not.toContain(sentinel);
      expect(formatted).not.toContain(sentinel);
    }
  });

  test("yields the generic message for an unknown sensitive operation label", async () => {
    const sensitiveLabel = `leaks ${rawLinkToken} ${baseUrl}`;
    const exit = await Effect.runPromiseExit(
      runWorkspaceE2EMarketingBrowserOperation(sensitiveLabel, () =>
        Promise.reject(new Error(`raw cause with ${rawLinkToken}`))
      )
    );

    expect(Exit.isFailure(exit)).toBe(true);
    if (!Exit.isFailure(exit)) return;
    const failure = Cause.squash(exit.cause) as WorkspaceE2EError;
    expect(failure.operation).toBeUndefined();
    expect(failure.cause).toBeUndefined();
    expect(failure.causes).toBeUndefined();
    expect(failure.message).toBe(browserFailureMessage);
    const serializedErrorFields = JSON.stringify({
      cause: failure.cause,
      causes: failure.causes,
      diagnosticCode: failure.diagnosticCode,
      message: failure.message,
      operation: failure.operation,
      reason: failure.reason,
    });
    const formatted = formatWorkspaceE2EFailure(failure);
    expect(formatted).toContain(browserFailureMessage);
    for (const sentinel of [rawLinkToken, baseUrl, sensitiveLabel]) {
      expect(failure.message).not.toContain(sentinel);
      expect(serializedErrorFields).not.toContain(sentinel);
      expect(formatted).not.toContain(sentinel);
    }
  });

  test("waits for interrupted browser preparation before fixture cleanup", async () => {
    const fixture = makeSyntheticMarketingFixture();
    const preparationStarted = makePromiseGate();
    const releasePreparation = makePromiseGate();
    const abortObserved = makePromiseGate();
    let cleanupRan = false;
    let cleanupSawOperationSettled = false;
    let operationSettled = false;
    let submitCount = 0;
    const operation = runWorkspaceE2EMarketingBrowserOperation(
      "interrupted marketing browser preparation",
      async (signal) => {
        signal.addEventListener("abort", () => abortObserved.resolve(), {
          once: true,
        });
        preparationStarted.resolve();
        try {
          await releasePreparation.promise;
          signal.throwIfAborted();
          submitCount += 1;
          fixture.state.consent = {
            ...fixture.state.consent,
            withdrawnAt: "2030-01-01T04:04:05Z",
          };
          fixture.state.tokenHashes.push("synthetic-new-token-hash");
        } finally {
          operationSettled = true;
        }
      }
    );
    const outerFixture = Effect.acquireUseRelease(
      Effect.succeed(fixture),
      () => operation,
      () =>
        Effect.sync(() => {
          cleanupRan = true;
          cleanupSawOperationSettled = operationSettled;
          fixture.restore();
        })
    );
    const unhandledRejections: unknown[] = [];
    const onUnhandledRejection = (reason: unknown) => {
      unhandledRejections.push(reason);
    };
    process.on("unhandledRejection", onUnhandledRejection);

    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          const fiber = yield* Effect.forkChild(outerFixture);
          yield* Effect.promise(() => preparationStarted.promise);

          const interruption = yield* Effect.forkChild(Fiber.interrupt(fiber));
          yield* Effect.promise(() => abortObserved.promise);
          yield* Effect.yieldNow;

          expect(cleanupRan).toBe(false);
          expect(operationSettled).toBe(false);
          expect(submitCount).toBe(0);
          expect(fixture.state).toEqual(fixture.original);

          releasePreparation.resolve();
          yield* Fiber.join(interruption);
          const exit = yield* Fiber.await(fiber);
          expect(Exit.isFailure(exit)).toBe(true);
          if (Exit.isFailure(exit))
            expect(Cause.hasInterruptsOnly(exit.cause)).toBe(true);
        })
      );
    } finally {
      releasePreparation.resolve();
      await flushMicrotasks();
      process.off("unhandledRejection", onUnhandledRejection);
    }

    expect(cleanupRan).toBe(true);
    expect(cleanupSawOperationSettled).toBe(true);
    expect(operationSettled).toBe(true);
    expect(submitCount).toBe(0);
    expect(fixture.state).toEqual(fixture.original);
    expect(unhandledRejections).toHaveLength(0);
  });

  test("waits for a delayed submitted action and terminal state before fixture cleanup", async () => {
    const fixture = makeSyntheticMarketingFixture();
    const clickResolved = makePromiseGate();
    const releaseAction = makePromiseGate();
    const terminalStateResolved = makePromiseGate();
    const abortObserved = makePromiseGate();
    let cleanupRan = false;
    let cleanupSawOperationSettled = false;
    let operationSettled = false;
    let clickCount = 0;
    const operation = runWorkspaceE2EMarketingBrowserOperation(
      "delayed submitted marketing browser operation",
      async (signal) => {
        signal.addEventListener("abort", () => abortObserved.resolve(), {
          once: true,
        });
        signal.throwIfAborted();
        clickCount += 1;
        clickResolved.resolve();
        try {
          await releaseAction.promise;
          fixture.state.consent = {
            ...fixture.state.consent,
            withdrawnAt: "2030-01-01T04:04:05Z",
          };
          fixture.state.tokenHashes.push("synthetic-new-token-hash");
          terminalStateResolved.resolve();
          await terminalStateResolved.promise;
        } finally {
          operationSettled = true;
        }
      }
    );
    const outerFixture = Effect.acquireUseRelease(
      Effect.succeed(fixture),
      () => operation,
      () =>
        Effect.sync(() => {
          cleanupRan = true;
          cleanupSawOperationSettled = operationSettled;
          fixture.restore();
        })
    );
    const unhandledRejections: unknown[] = [];
    const onUnhandledRejection = (reason: unknown) => {
      unhandledRejections.push(reason);
    };
    process.on("unhandledRejection", onUnhandledRejection);

    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          const fiber = yield* Effect.forkChild(outerFixture);
          yield* Effect.promise(() => clickResolved.promise);

          const interruption = yield* Effect.forkChild(Fiber.interrupt(fiber));
          yield* Effect.promise(() => abortObserved.promise);
          yield* Effect.yieldNow;

          expect(cleanupRan).toBe(false);
          expect(operationSettled).toBe(false);
          expect(clickCount).toBe(1);
          expect(fixture.state).toEqual(fixture.original);

          releaseAction.resolve();
          yield* Effect.promise(() => terminalStateResolved.promise);
          yield* Fiber.join(interruption);
          const exit = yield* Fiber.await(fiber);
          expect(Exit.isFailure(exit)).toBe(true);
          if (Exit.isFailure(exit))
            expect(Cause.hasInterruptsOnly(exit.cause)).toBe(true);
        })
      );
    } finally {
      releaseAction.resolve();
      await flushMicrotasks();
      process.off("unhandledRejection", onUnhandledRejection);
    }

    expect(cleanupRan).toBe(true);
    expect(cleanupSawOperationSettled).toBe(true);
    expect(operationSettled).toBe(true);
    expect(clickCount).toBe(1);
    expect(fixture.state).toEqual(fixture.original);
    expect(unhandledRejections).toHaveLength(0);
  });

  test("passes the access URL to Playwright with a bounded load wait", async () => {
    const accessUrl = `${baseUrl}/en-US/marketing-preferences/access?token=${rawLinkToken}`;
    const fakePage = makeFakePage(async () => undefined);

    await navigateWorkspaceE2EMarketingPreferences(fakePage.page, accessUrl);

    expect(fakePage.gotoCalls).toEqual([
      {
        options: {
          timeout: expect.any(Number),
          waitUntil: "load",
        },
        url: accessUrl,
      },
    ]);
    expect(fakePage.gotoCalls[0]?.options?.timeout).toBeGreaterThan(0);
  });

  test("navigates an authenticated page from another account route to clean legal URL", async () => {
    const accountLegalUrl = `${baseUrl}/en-US/account/legal`;
    const fakePage = makeFakePage(
      async () => undefined,
      `${baseUrl}/en-US/account`
    );

    await navigateAuthenticatedWorkspaceE2EMarketingPreferences(
      fakePage.page,
      accountLegalUrl
    );

    expect(fakePage.page.url()).toBe(accountLegalUrl);
    expect(fakePage.gotoCalls).toEqual([
      {
        options: {
          timeout: expect.any(Number),
          waitUntil: "load",
        },
        url: accountLegalUrl,
      },
    ]);
  });

  test("turns navigation failures into a fixed error without a cause or raw URL", async () => {
    const unsafeUrl = `${baseUrl}/en-US/marketing-preferences/access?token=${rawLinkToken}`;
    const rawFailure = new Error(`raw navigation failure for ${unsafeUrl}`);
    const fakePage = makeFakePage(async () => {
      throw rawFailure;
    });
    let failure: unknown;

    try {
      await navigateWorkspaceE2EMarketingPreferences(fakePage.page, unsafeUrl);
    } catch (cause) {
      failure = cause;
    }

    expect(failure).toBeInstanceOf(Error);
    const safeFailure = failure as Error;
    expect(safeFailure.message).toBe(browserFailureMessage);
    expect("cause" in safeFailure).toBe(false);
    expect(String(safeFailure)).not.toContain(unsafeUrl);
    expect(String(safeFailure)).not.toContain(rawLinkToken);
    expect(safeFailure.stack).not.toContain(unsafeUrl);
    expect(JSON.stringify(safeFailure)).not.toContain(unsafeUrl);
    expect(fakePage.gotoCalls).toHaveLength(1);
  });

  test("keeps the helper out of auth sends, rate budgets, provider concurrency, and unapproved screenshot IDs", async () => {
    expect(typeof verifyWorkspaceE2EMarketingPreferences).toBe("function");

    const source = readFileSync(
      fileURLToPath(new URL("./marketing-preferences.ts", import.meta.url)),
      "utf8"
    );

    for (const forbidden of [
      /\/api\/auth/i,
      /sign[-_]in/i,
      /magic[-_]link/i,
      /\bsignIn\b/i,
      /\bsendMagicLink\b/i,
      /rate[-_]budget/i,
      /\brateBudget\b/i,
      /\bconcurrency\b/i,
      /provider[\s\S]{0,80}concurrency/i,
    ]) {
      expect(source).not.toMatch(forbidden);
    }

    const screenshotCallIds = Array.from(
      source.matchAll(
        /captureMarketingReview\(\s*[\s\S]*?["']([^"']+)["']\s*\)/g
      )
    ).map((match) => match[1]);
    const expectedScreenshotCallIds = [
      "account-marketing-active-mobile",
      "account-marketing-withdrawn-desktop",
      "marketing-link-active-desktop",
      "marketing-link-active-mobile",
      "marketing-link-invalid-desktop",
      "marketing-link-invalid-mobile",
      "marketing-link-pending-desktop",
      "marketing-link-pending-mobile",
      "marketing-link-withdrawn-desktop",
      "marketing-link-withdrawn-mobile",
    ];

    expect(screenshotCallIds).toHaveLength(expectedScreenshotCallIds.length);
    expect([...screenshotCallIds].sort()).toEqual(
      [...expectedScreenshotCallIds].sort()
    );
  });

  test("accepts the real rejection DOM: scoped alert plus the empty route announcer", () => {
    // The Next.js route announcer is itself a role=alert element and stays
    // empty between navigations, so a correct rejection renders TWO alerts:
    // the form's scoped alert carrying the invalid-link message, plus the
    // empty announcer. Observed directly in the hosted failure snapshot
    // (single empty `alert` row on a page with no error state).
    expect(
      matchesRejectedReplayAlerts(
        [invalidMarketingManagementActionMessage],
        [invalidMarketingManagementActionMessage, ""]
      )
    ).toBe(true);
    expect(
      matchesRejectedReplayAlerts(
        [invalidMarketingManagementActionMessage],
        [invalidMarketingManagementActionMessage]
      )
    ).toBe(true);
  });

  test("rejects a page with no invalid-link alert", () => {
    expect(matchesRejectedReplayAlerts([], [""])).toBe(false);
    expect(matchesRejectedReplayAlerts([], [])).toBe(false);
  });

  test("rejects a rejection message rendered outside the pending section", () => {
    expect(
      matchesRejectedReplayAlerts([], [invalidMarketingManagementActionMessage])
    ).toBe(false);
  });

  test("rejects a page where the invalid-link alert renders more than once", () => {
    expect(
      matchesRejectedReplayAlerts(
        [invalidMarketingManagementActionMessage],
        [
          invalidMarketingManagementActionMessage,
          invalidMarketingManagementActionMessage,
        ]
      )
    ).toBe(false);
  });

  test("rejects an additional nonempty application alert beside the rejection message", () => {
    expect(
      matchesRejectedReplayAlerts(
        [invalidMarketingManagementActionMessage],
        [
          invalidMarketingManagementActionMessage,
          "An unexpected application error occurred",
        ]
      )
    ).toBe(false);
  });

  // The replay-flow ordering (bounded rejection alert inside the pending
  // section, terminal malformed-link clear before the cleanup proof,
  // step sequencing, and cookie/session proofs) is covered behaviorally:
  // the executed matchesRejectedReplayAlerts tests immediately above pin
  // the real rejection-DOM contract, and the parallel-owned account lane
  // e2e work plus every protected-preview lane execution runs
  // runReplayedMarketingPreferencesFlow end to end against the real
  // hosted preview.
  // The customer-scoped wiring of marketing preferences into the
  // reservation-transitions case (customer-id read helper placement,
  // verifier/fixture/navigation ordering inside the lane steps, and the
  // two readAccountReservationCustomerId call sites) is covered
  // behaviorally: the protected-preview account lane executes the full
  // account-reservation-transitions case against the real hosted preview,
  // and the executed fake-based tests above pin the verifier, navigation,
  // and cleanup helper contracts.
  test("keeps the provider-transition step budget at the configured 90s", () => {
    expect(workspaceE2ETimeouts.providerTransition).toBe(90 * 1_000);
  });
});
