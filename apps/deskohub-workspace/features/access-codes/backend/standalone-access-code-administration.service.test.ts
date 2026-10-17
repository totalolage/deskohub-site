import "@/shared/testing/workspace-test-env";

import { describe, expect, mock, test } from "bun:test";
import {
  AlgoPinSchema,
  IgloohomeDeviceIdSchema,
  IgloohomePinIdSchema,
  IgloohomeRequestError,
  IgloohomeService,
} from "@deskohub/igloohome";
import { testEmailAddress } from "@deskohub/test-email";
import {
  AdministrationProviderCredentialId,
  AdministrationStandaloneAccessCodeAttemptId,
  AdministrationStandaloneAccessCodeCreateInput,
  AdministrationStandaloneAccessCodeName,
} from "@deskohub/workspace-admin-api";
import { Effect, Layer, Result, Schema } from "effect";
import { customerAccountIdSchema } from "@/features/account/customer-account";
import type { AdministratorAccountActor } from "@/features/administrators/account-role";
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
const priorAttemptId = decodeAttemptId("01980000-0000-7000-8000-000000000044");
const priorCleanupTarget = {
  attemptId: priorAttemptId,
  name: AdministrationStandaloneAccessCodeName.make("Prior Booth"),
};
const actor: AdministratorAccountActor = {
  accountId: customerAccountIdSchema.make(crypto.randomUUID()),
  email: testEmailAddress("fixture-operator"),
};
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

const appended = { kind: "appended" } as const;
const claimed = { kind: "claimed", variance: 2 } as const;

describe("StandaloneAccessCodeAdministration.create", () => {
  test("calls Igloohome once and discloses the PIN only on the current call", async () => {
    const appendTerminal = mock(() => Effect.succeed(appended));
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
        appendTerminal: mock(() => Effect.succeed(appended)),
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
      expect(result.failure.cleanupTarget).toEqual({
        attemptId,
        name: "Booth A",
      });
    }
  });

  test("reports cleanup-required with the repository target and without calling the provider", async () => {
    const issueHourlyAlgoPin = mock(() =>
      Effect.die("Igloohome must not be called")
    );
    const result = await runCreate({
      claim: mock(() =>
        Effect.succeed({
          kind: "cleanup-required",
          cleanupTarget: priorCleanupTarget,
        } as const)
      ),
      issueHourlyAlgoPin,
    });

    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure.outcome).toBe("cleanup-required");
      expect(result.failure.message).toContain("Igloohome");
      expect(result.failure.cleanupTarget).toEqual(priorCleanupTarget);
    }
    expect(issueHourlyAlgoPin).not.toHaveBeenCalled();
  });

  test("forwards the exact cleanup target confirmation to the attempt log", async () => {
    const claim = mock(() =>
      Effect.succeed({
        kind: "cleanup-required",
        cleanupTarget: priorCleanupTarget,
      } as const)
    );
    await runCreate(
      { claim },
      { ...input, providerCredentialRemovedAttemptId: priorAttemptId }
    );

    expect(claim).toHaveBeenCalledWith(
      expect.objectContaining({
        providerCredentialRemovedAttemptId: priorAttemptId,
      })
    );
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
      expect(result.failure.cleanupTarget).toEqual({
        attemptId,
        name: "Booth A",
      });
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

  test("reports the stored stale ambiguity when a late provider success conflicts with an already-terminal attempt", async () => {
    const result = await runCreate({
      claim: mock(() => Effect.succeed(claimed)),
      appendTerminal: mock(() =>
        Effect.succeed({
          kind: "already-terminal",
          terminal: {
            kind: "ambiguous",
            failureCode: "standalone_attempt_stale",
          },
        } as const)
      ),
      issueHourlyAlgoPin: mock(() => Effect.succeed({ pin, pinId })),
    });

    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure.outcome).toBe("ambiguous");
      expect(result.failure.failureCode).toBe("standalone_attempt_stale");
      expect(result.failure.cleanupTarget).toEqual({
        attemptId,
        name: "Booth A",
      });
      expect(JSON.stringify(result.failure)).not.toContain("7654321");
    }
  });

  test("reports already-created when a late provider rejection conflicts with a stored created terminal", async () => {
    const storedCredentialId = Schema.decodeUnknownSync(
      AdministrationProviderCredentialId
    )("stored-pin-id");
    const result = await runCreate({
      claim: mock(() => Effect.succeed(claimed)),
      appendTerminal: mock(() =>
        Effect.succeed({
          kind: "already-terminal",
          terminal: {
            kind: "created",
            terminal: {
              name: request.name,
              startsAtLocal: request.startsAt,
              endsAtLocal: request.endsAt,
              providerCredentialId: storedCredentialId,
              occurredAt: Temporal.Instant.from("2026-09-10T08:00:00Z"),
            },
          },
        } as const)
      ),
      issueHourlyAlgoPin: mock(() =>
        Effect.fail(
          new IgloohomeRequestError({
            operation: "issue_hourly_algopin",
            outcome: "rejected",
            message: "provider rejected late",
            statusCode: 422,
          })
        )
      ),
    });

    expect(Result.isSuccess(result)).toBe(true);
    if (Result.isSuccess(result)) {
      expect(result.success).toMatchObject({
        outcome: "already-created",
        attemptId,
        providerCredentialId: "stored-pin-id",
        issuedAt: "2026-09-10T08:00:00Z",
      });
      expect("pin" in result.success).toBe(false);
      expect(JSON.stringify(result.success)).not.toContain("7654321");
    }
  });

  test("reports the stored rejection when a late provider outcome conflicts with a stored rejected terminal", async () => {
    const result = await runCreate({
      claim: mock(() => Effect.succeed(claimed)),
      appendTerminal: mock(() =>
        Effect.succeed({
          kind: "already-terminal",
          terminal: {
            kind: "rejected",
            failureCode: "standalone_provider_rejected",
          },
        } as const)
      ),
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
      expect(result.failure.outcome).toBe("rejected");
      expect(result.failure.failureCode).toBe("standalone_provider_rejected");
    }
  });
});
