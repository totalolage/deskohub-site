import "@/shared/testing/workspace-test-env";

import { describe, expect, mock, test } from "bun:test";
import {
  AlgoPinSchema,
  IgloohomeDeviceIdSchema,
  IgloohomePinIdSchema,
  IgloohomeRequestError,
  IgloohomeService,
} from "@deskohub/igloohome";
import {
  AdministrationActorUsername,
  AdministrationProviderCredentialId,
  AdministrationStandaloneAccessCodeAttemptId,
  AdministrationStandaloneAccessCodeCreateInput,
} from "@deskohub/workspace-admin-api";
import { Effect, Layer, Result, Schema } from "effect";
import { StandaloneAccessCodeAdministration } from "./standalone-access-code-administration.service";
import {
  StandaloneAccessCodeAttemptLogRepository,
  StandaloneAccessCodeAttemptLogStorageError,
} from "./standalone-access-code-attempt-log.repository";

const decodeAttemptId = Schema.decodeUnknownSync(
  AdministrationStandaloneAccessCodeAttemptId
);
const decodeRequest = Schema.decodeUnknownSync(
  AdministrationStandaloneAccessCodeCreateInput
);
const attemptId = decodeAttemptId("01980000-0000-7000-8000-000000000042");
const otherAttemptId = decodeAttemptId("01980000-0000-7000-8000-000000000043");
const actor = AdministrationActorUsername.make("Fixture Operator");
const source = "dhw-cli";
const request = decodeRequest({
  name: "Booth A",
  startsAt: "2026-09-10T10:00",
  endsAt: "2026-09-10T12:00",
});
const dstRequest = decodeRequest({
  name: "DST Booth",
  startsAt: "2026-03-29T01:00",
  endsAt: "2026-03-29T04:00",
});
const pin = Schema.decodeUnknownSync(AlgoPinSchema)("7654321");
const pinId = Schema.decodeUnknownSync(IgloohomePinIdSchema)("fixture-pin-id");
const providerCredentialId = Schema.decodeUnknownSync(
  AdministrationProviderCredentialId
)("fixture-pin-id");

const input = {
  attemptId,
  actor,
  source,
  request,
};

const claimStorageFailure: StandaloneAccessCodeAttemptLogStorageError =
  new StandaloneAccessCodeAttemptLogStorageError({
    operation: "claim",
    attemptId,
    message: "fixture claim failure",
  });
const terminalStorageFailure: StandaloneAccessCodeAttemptLogStorageError =
  new StandaloneAccessCodeAttemptLogStorageError({
    operation: "append_terminal",
    attemptId,
    message: "fixture terminal failure",
  });

const runCreate = (
  mocks: {
    readonly claim: ReturnType<typeof mock>;
    readonly appendTerminal?: ReturnType<typeof mock>;
    readonly issueHourlyAlgoPin?: ReturnType<typeof mock>;
  },
  creationInput = input
) =>
  Effect.gen(function* () {
    const service = yield* StandaloneAccessCodeAdministration;
    return yield* service.create(creationInput).pipe(Effect.result);
  }).pipe(
    Effect.provide(
      StandaloneAccessCodeAdministration.Default.pipe(
        Layer.provide(
          Layer.mergeAll(
            Layer.mock(StandaloneAccessCodeAttemptLogRepository, {
              claim: mocks.claim,
              appendTerminal:
                mocks.appendTerminal ?? mock(() => Effect.die("not expected")),
            }),
            Layer.mock(IgloohomeService, {
              issueHourlyAlgoPin:
                mocks.issueHourlyAlgoPin ??
                mock(() => Effect.die("Igloohome must not be called")),
            })
          )
        )
      )
    ),
    Effect.runPromise
  );

const claimed = { kind: "claimed", variance: 2 } as const;

describe("StandaloneAccessCodeAdministration.create", () => {
  test("calls Igloohome once and discloses the PIN only on the current call", async () => {
    const appendTerminal = mock(() => Effect.succeed(true));
    const issueHourlyAlgoPin = mock(() => Effect.succeed({ pin, pinId }));
    const result = await runCreate({
      claim: mock(() => Effect.succeed(claimed)),
      appendTerminal,
      issueHourlyAlgoPin,
    });

    expect(Result.isSuccess(result)).toBe(true);
    if (Result.isSuccess(result)) {
      expect(result.success).toMatchObject({
        outcome: "created",
        attemptId,
        providerCredentialId: "fixture-pin-id",
        name: "Booth A",
        startsAt: "2026-09-10T10:00",
        endsAt: "2026-09-10T12:00",
        pin: "7654321",
      });
    }
    expect(issueHourlyAlgoPin).toHaveBeenCalledTimes(1);
    expect(issueHourlyAlgoPin).toHaveBeenCalledWith({
      deviceId: Schema.decodeUnknownSync(IgloohomeDeviceIdSchema)(
        "fixture-ek1"
      ),
      variance: 2,
      startsAt: "2026-09-10T10:00:00+02:00",
      endsAt: "2026-09-10T12:00:00+02:00",
      accessName: "Booth A",
    });
    expect(appendTerminal).toHaveBeenCalledWith(
      expect.objectContaining({
        variance: 2,
        eventKind: "created",
        providerCredentialId,
      })
    );
  });

  test("converts site-local times to Prague offset provider timestamps across DST", async () => {
    const issueHourlyAlgoPin = mock(() => Effect.succeed({ pin, pinId }));
    await runCreate(
      {
        claim: mock(() =>
          Effect.succeed({ kind: "claimed", variance: 3 } as const)
        ),
        appendTerminal: mock(() => Effect.succeed(true)),
        issueHourlyAlgoPin,
      },
      { ...input, request: dstRequest }
    );

    expect(issueHourlyAlgoPin).toHaveBeenCalledWith(
      expect.objectContaining({
        variance: 3,
        startsAt: "2026-03-29T01:00:00+01:00",
        endsAt: "2026-03-29T04:00:00+02:00",
      })
    );
  });

  test("replays an already-created attempt without disclosing a PIN", async () => {
    const result = await runCreate({
      claim: mock(() =>
        Effect.succeed({
          kind: "created",
          terminal: {
            name: request.name,
            startsAtLocal: request.startsAt,
            endsAtLocal: request.endsAt,
            providerCredentialId,
            occurredAt: Temporal.Instant.from("2026-09-10T08:00:00Z"),
          },
        } as const)
      ),
    });

    expect(Result.isSuccess(result)).toBe(true);
    if (Result.isSuccess(result)) {
      expect(result.success).toMatchObject({
        outcome: "already-created",
        attemptId,
        providerCredentialId: "fixture-pin-id",
        issuedAt: "2026-09-10T08:00:00Z",
      });
      expect("pin" in result.success).toBe(false);
      expect(JSON.stringify(result.success)).not.toContain("7654321");
    }
  });

  test("replays a definitively rejected attempt without another provider call", async () => {
    const result = await runCreate({
      claim: mock(() =>
        Effect.succeed({
          kind: "rejected",
          failureCode: "standalone_provider_rejected",
        } as const)
      ),
    });

    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure.outcome).toBe("rejected");
      expect(result.failure.failureCode).toBe("standalone_provider_rejected");
    }
  });

  test("replays an ambiguous attempt without another provider call", async () => {
    const result = await runCreate({
      claim: mock(() =>
        Effect.succeed({
          kind: "ambiguous",
          failureCode: "standalone_attempt_stale",
        } as const)
      ),
    });

    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure.outcome).toBe("ambiguous");
      expect(result.failure.failureCode).toBe("standalone_attempt_stale");
    }
  });

  test("reports cleanup-required without calling the provider", async () => {
    const result = await runCreate({
      claim: mock(() => Effect.succeed({ kind: "cleanup-required" } as const)),
    });

    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure.outcome).toBe("cleanup-required");
      expect(result.failure.message).toContain("Igloohome");
    }
  });

  test("reports a confirmed reconciled replay without calling the provider", async () => {
    const result = await runCreate({
      claim: mock(() => Effect.succeed({ kind: "reconciled" } as const)),
    });

    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure.outcome).toBe("reconciled");
      expect(result.failure.message).toContain("Run the same command again");
    }
  });

  test("forwards the explicit cleanup confirmation to the attempt log", async () => {
    const claim = mock(() =>
      Effect.succeed({ kind: "cleanup-required" } as const)
    );
    await runCreate({ claim }, { ...input, providerCredentialRemoved: true });

    expect(claim).toHaveBeenCalledWith(
      expect.objectContaining({ providerCredentialRemoved: true })
    );
  });

  test("reports a fresh started attempt as in progress", async () => {
    const result = await runCreate({
      claim: mock(() => Effect.succeed({ kind: "in-progress" } as const)),
    });

    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure.outcome).toBe("in-progress");
    }
  });

  test("rejects a replay that reuses the attempt ID with different input", async () => {
    const result = await runCreate({
      claim: mock(() => Effect.succeed({ kind: "mismatch" } as const)),
    });

    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure.outcome).toBe("rejected");
      expect(result.failure.message).toContain("attempt identifier");
    }
  });

  test("rejects definitively when both standalone variances are occupied", async () => {
    const result = await runCreate({
      claim: mock(() => Effect.succeed({ kind: "exhausted" } as const)),
    });

    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure.outcome).toBe("rejected");
      expect(result.failure.message).toContain("Both standalone access codes");
    }
  });

  test("returns unavailable without a provider call when the started audit fails", async () => {
    const result = await runCreate({
      claim: mock(() => Effect.fail(claimStorageFailure)),
    });

    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure.outcome).toBe("unavailable");
    }
  });

  test("preserves a provider rejection when the terminal audit fails", async () => {
    const appendTerminal = mock(() => Effect.fail(terminalStorageFailure));
    const result = await runCreate({
      claim: mock(() => Effect.succeed(claimed)),
      appendTerminal,
      issueHourlyAlgoPin: mock(() =>
        Effect.fail(
          new IgloohomeRequestError({
            operation: "issue_hourly_algopin",
            outcome: "rejected",
            message: "provider rejected",
            statusCode: 422,
          })
        )
      ),
    });

    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure.outcome).toBe("rejected");
      expect(result.failure.failureCode).toBe("standalone_provider_rejected");
    }
    expect(appendTerminal).toHaveBeenCalledTimes(1);
    expect(appendTerminal).toHaveBeenCalledWith(
      expect.objectContaining({
        eventKind: "rejected",
        failureCode: "standalone_provider_rejected",
        providerStatusCode: 422,
      })
    );
  });

  test("preserves an ambiguous provider outcome when the terminal audit fails", async () => {
    const result = await runCreate({
      claim: mock(() => Effect.succeed(claimed)),
      appendTerminal: mock(() => Effect.fail(terminalStorageFailure)),
      issueHourlyAlgoPin: mock(() =>
        Effect.fail(
          new IgloohomeRequestError({
            operation: "issue_hourly_algopin",
            outcome: "ambiguous",
            message: "connection lost mid-flight",
          })
        )
      ),
    });

    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure.outcome).toBe("ambiguous");
    }
  });

  test("still returns the one-time PIN when the created audit fails", async () => {
    const result = await runCreate({
      claim: mock(() => Effect.succeed(claimed)),
      appendTerminal: mock(() => Effect.fail(terminalStorageFailure)),
      issueHourlyAlgoPin: mock(() => Effect.succeed({ pin, pinId })),
    });

    expect(Result.isSuccess(result)).toBe(true);
    if (Result.isSuccess(result)) {
      expect(result.success).toMatchObject({
        outcome: "created",
        pin: "7654321",
      });
    }
  });

  test("keeps distinct attempt IDs independent", async () => {
    const claim = mock(() => Effect.succeed({ kind: "exhausted" } as const));
    const result = await Effect.gen(function* () {
      const service = yield* StandaloneAccessCodeAdministration;
      return yield* service
        .create({ ...input, attemptId: otherAttemptId })
        .pipe(Effect.result);
    }).pipe(
      Effect.provide(
        StandaloneAccessCodeAdministration.Default.pipe(
          Layer.provide(
            Layer.mergeAll(
              Layer.mock(StandaloneAccessCodeAttemptLogRepository, {
                claim,
              }),
              Layer.mock(IgloohomeService, {})
            )
          )
        )
      ),
      Effect.runPromise
    );

    expect(Result.isFailure(result)).toBe(true);
    expect(claim).toHaveBeenCalledWith(
      expect.objectContaining({
        attempt: expect.objectContaining({ attemptId: otherAttemptId }),
      })
    );
  });
});
