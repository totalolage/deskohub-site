import {
  IgloohomeDeviceIdSchema,
  type IgloohomeRequestError,
  IgloohomeService,
} from "@deskohub/igloohome";
import {
  type AdministrationActorUsername,
  AdministrationInstant,
  AdministrationProviderCredentialId,
  type AdministrationStandaloneAccessCodeAttemptId,
  type AdministrationStandaloneAccessCodeCleanupTarget,
  type AdministrationStandaloneAccessCodeCreateInput,
  type AdministrationStandaloneAccessCodeCreationOutcome,
  AdministrationStandaloneAccessCodePin,
} from "@deskohub/workspace-admin-api";
import { Context, Data, Effect, Layer, Match, Result, Schema } from "effect";
import { env } from "@/env";
import { WorkspaceIgloohomeLayer } from "@/shared/backend/config/igloohome.config";
import { workspaceSiteConstants } from "@/shared/utils";
import { localDateTimeToOffsetInstantString } from "@/shared/utils/temporal";
import type {
  StandaloneAccessCodeCreationOutcome,
  StandaloneAccessCodeFailureCode,
  StandaloneAccessCodeProviderVariance,
  StandaloneAccessCodeSource,
} from "../standalone-access-code";
import { standaloneAccessCodeAttemptStaleAfterMilliseconds } from "../standalone-access-code";
import {
  type StandaloneAccessCodeAttempt,
  StandaloneAccessCodeAttemptLogRepository,
  type StandaloneAccessCodeAttemptTerminalResolution,
  type StandaloneAccessCodeCreatedAttemptTerminal,
} from "./standalone-access-code-attempt-log.repository";

export class StandaloneAccessCodeCreationError extends Data.TaggedError(
  "StandaloneAccessCodeCreationError"
)<{
  readonly attemptId: AdministrationStandaloneAccessCodeAttemptId;
  readonly outcome: StandaloneAccessCodeCreationOutcome;
  readonly failureCode?: StandaloneAccessCodeFailureCode;
  readonly cleanupTarget?: AdministrationStandaloneAccessCodeCleanupTarget;
  readonly message: string;
  readonly cause?: unknown;
}> {}

interface IStandaloneAccessCodeAdministration {
  readonly create: (input: {
    readonly attemptId: AdministrationStandaloneAccessCodeAttemptId;
    readonly actor: AdministrationActorUsername;
    readonly source: StandaloneAccessCodeSource;
    readonly request: AdministrationStandaloneAccessCodeCreateInput;
    readonly providerCredentialRemovedAttemptId?: AdministrationStandaloneAccessCodeAttemptId;
  }) => Effect.Effect<
    AdministrationStandaloneAccessCodeCreationOutcome,
    StandaloneAccessCodeCreationError
  >;
}

interface StandaloneAccessCodeCreationRequest {
  readonly attemptId: AdministrationStandaloneAccessCodeAttemptId;
  readonly request: AdministrationStandaloneAccessCodeCreateInput;
}

export class StandaloneAccessCodeAdministration extends Context.Service<
  StandaloneAccessCodeAdministration,
  IStandaloneAccessCodeAdministration
>()("@deskohub-workspace/access-codes/StandaloneAccessCodeAdministration") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const attempts = yield* StandaloneAccessCodeAttemptLogRepository;
      const igloohome = yield* IgloohomeService;
      const deviceId = Schema.decodeUnknownSync(IgloohomeDeviceIdSchema)(
        env.IGLOOHOME_ALGOPIN_TARGET_DEVICE_ID
      );
      const timeZone = workspaceSiteConstants.location.timeZone;

      const failCreation = (
        input: StandaloneAccessCodeCreationRequest,
        outcome: StandaloneAccessCodeCreationOutcome,
        message: string,
        details: {
          readonly failureCode?: StandaloneAccessCodeFailureCode;
          readonly cleanupTarget?: AdministrationStandaloneAccessCodeCleanupTarget;
          readonly cause?: unknown;
        } = {}
      ) =>
        new StandaloneAccessCodeCreationError({
          attemptId: input.attemptId,
          outcome,
          ...(details.failureCode !== undefined && {
            failureCode: details.failureCode,
          }),
          ...(details.cleanupTarget !== undefined && {
            cleanupTarget: details.cleanupTarget,
          }),
          message,
          ...(details.cause !== undefined && { cause: details.cause }),
        });

      const ambiguousTargetOf = (input: StandaloneAccessCodeCreationRequest) =>
        ({
          attemptId: input.attemptId,
          name: input.request.name,
        }) as const;

      const createdOutcome = (input: {
        readonly request: StandaloneAccessCodeCreationRequest;
        readonly providerCredentialId: AdministrationProviderCredentialId;
        readonly pin: AdministrationStandaloneAccessCodePin;
        readonly issuedAt: Temporal.Instant;
      }): AdministrationStandaloneAccessCodeCreationOutcome => ({
        outcome: "created",
        attemptId: input.request.attemptId,
        providerCredentialId: input.providerCredentialId,
        name: input.request.request.name,
        startsAt: input.request.request.startsAt,
        endsAt: input.request.request.endsAt,
        issuedAt: AdministrationInstant.make(input.issuedAt.toString()),
        pin: input.pin,
      });

      const alreadyCreatedOutcome = (
        input: StandaloneAccessCodeCreationRequest,
        terminal: StandaloneAccessCodeCreatedAttemptTerminal
      ): AdministrationStandaloneAccessCodeCreationOutcome => ({
        outcome: "already-created",
        attemptId: input.attemptId,
        providerCredentialId: terminal.providerCredentialId,
        name: terminal.name,
        startsAt: terminal.startsAtLocal,
        endsAt: terminal.endsAtLocal,
        issuedAt: AdministrationInstant.make(terminal.occurredAt.toString()),
      });

      const storedTerminalOutcome = (
        input: StandaloneAccessCodeCreationRequest,
        terminal: StandaloneAccessCodeAttemptTerminalResolution
      ) =>
        Match.value(terminal).pipe(
          Match.discriminatorsExhaustive("kind")({
            created: (stored) =>
              Effect.succeed(alreadyCreatedOutcome(input, stored.terminal)),
            ambiguous: (stored) =>
              Effect.fail(
                failCreation(
                  input,
                  "ambiguous",
                  "The standalone access-code creation outcome is ambiguous.",
                  {
                    failureCode: stored.failureCode,
                    cleanupTarget: ambiguousTargetOf(input),
                  }
                )
              ),
            rejected: (stored) =>
              Effect.fail(
                failCreation(
                  input,
                  "rejected",
                  "The standalone access-code request was rejected.",
                  { failureCode: stored.failureCode }
                )
              ),
          })
        );

      const providerTimestamps = (
        request: AdministrationStandaloneAccessCodeCreateInput
      ) => ({
        startsAt: localDateTimeToOffsetInstantString({
          dateTime: request.startsAt,
          timeZone,
        }),
        endsAt: localDateTimeToOffsetInstantString({
          dateTime: request.endsAt,
          timeZone,
        }),
      });

      const logTerminalAuditFailure = Effect.fn(
        "StandaloneAccessCodeAdministration.logTerminalAuditFailure"
      )(function* (input: {
        readonly attemptId: AdministrationStandaloneAccessCodeAttemptId;
        readonly eventKind: "created" | "rejected" | "ambiguous";
        readonly cause: unknown;
      }) {
        yield* Effect.logError(
          "Standalone access-code terminal event could not be audited",
          {
            attemptId: input.attemptId,
            eventKind: input.eventKind,
            cause: input.cause,
          }
        );
      });

      const recordProviderRejection = Effect.fn(
        "StandaloneAccessCodeAdministration.recordProviderRejection"
      )(function* (input: {
        readonly request: StandaloneAccessCodeCreationRequest;
        readonly attempt: StandaloneAccessCodeAttempt;
        readonly variance: StandaloneAccessCodeProviderVariance;
        readonly error: IgloohomeRequestError;
      }) {
        const eventKind = input.error.outcome;
        const failureCode =
          eventKind === "rejected"
            ? "standalone_provider_rejected"
            : "standalone_provider_ambiguous";
        const outcomeFailure = () =>
          failCreation(
            input.request,
            eventKind,
            eventKind === "rejected"
              ? "The standalone access-code request was rejected."
              : "The standalone access-code creation outcome is ambiguous.",
            {
              failureCode,
              ...(eventKind === "ambiguous" && {
                cleanupTarget: ambiguousTargetOf(input.request),
              }),
            }
          );
        const appended = yield* Effect.result(
          attempts.appendTerminal({
            attempt: input.attempt,
            variance: input.variance,
            eventKind,
            occurredAt: Temporal.Now.instant(),
            providerStatusCode: input.error.statusCode,
            failureCode,
          })
        );
        if (Result.isFailure(appended)) {
          yield* logTerminalAuditFailure({
            attemptId: input.request.attemptId,
            eventKind,
            cause: appended.failure,
          });
          return yield* outcomeFailure();
        }
        return yield* Match.value(appended.success).pipe(
          Match.discriminatorsExhaustive("kind")({
            appended: () => Effect.fail(outcomeFailure()),
            "already-terminal": ({ terminal }) =>
              storedTerminalOutcome(input.request, terminal),
          })
        );
      });

      const recordCreated = Effect.fn(
        "StandaloneAccessCodeAdministration.recordCreated"
      )(function* (input: {
        readonly request: StandaloneAccessCodeCreationRequest;
        readonly attempt: StandaloneAccessCodeAttempt;
        readonly variance: StandaloneAccessCodeProviderVariance;
        readonly issued: { readonly pin: string; readonly pinId: string };
      }) {
        const issuedAt = Temporal.Now.instant();
        const pin = Schema.decodeSync(AdministrationStandaloneAccessCodePin)(
          input.issued.pin
        );
        const providerCredentialId = Schema.decodeSync(
          AdministrationProviderCredentialId
        )(input.issued.pinId);
        const appended = yield* Effect.result(
          attempts.appendTerminal({
            attempt: input.attempt,
            variance: input.variance,
            eventKind: "created",
            occurredAt: issuedAt,
            providerCredentialId,
          })
        );
        if (Result.isFailure(appended)) {
          yield* logTerminalAuditFailure({
            attemptId: input.request.attemptId,
            eventKind: "created",
            cause: appended.failure,
          });
          return createdOutcome({
            request: input.request,
            providerCredentialId,
            pin,
            issuedAt,
          });
        }
        return yield* Match.value(appended.success).pipe(
          Match.discriminatorsExhaustive("kind")({
            appended: () =>
              Effect.succeed(
                createdOutcome({
                  request: input.request,
                  providerCredentialId,
                  pin,
                  issuedAt,
                })
              ),
            "already-terminal": ({ terminal }) =>
              storedTerminalOutcome(input.request, terminal),
          })
        );
      });

      return StandaloneAccessCodeAdministration.of({
        create: Effect.fn("StandaloneAccessCodeAdministration.create")(
          function* (input) {
            const attempt: StandaloneAccessCodeAttempt = {
              attemptId: input.attemptId,
              actor: input.actor,
              source: input.source,
              name: input.request.name,
              deviceId,
              startsAtLocal: input.request.startsAt,
              endsAtLocal: input.request.endsAt,
              startsAt: Temporal.PlainDateTime.from(input.request.startsAt)
                .toZonedDateTime(timeZone)
                .toInstant(),
              endsAt: Temporal.PlainDateTime.from(input.request.endsAt)
                .toZonedDateTime(timeZone)
                .toInstant(),
            };
            const claimedAt = Temporal.Now.instant();

            const claimed = yield* attempts
              .claim({
                attempt,
                claimedAt,
                staleBefore: claimedAt.subtract({
                  milliseconds:
                    standaloneAccessCodeAttemptStaleAfterMilliseconds,
                }),
                providerCredentialRemovedAttemptId:
                  input.providerCredentialRemovedAttemptId,
              })
              .pipe(
                Effect.mapError((cause) =>
                  failCreation(
                    input,
                    "unavailable",
                    "Standalone access-code creation is temporarily unavailable.",
                    { cause }
                  )
                )
              );

            return yield* Match.value(claimed).pipe(
              Match.discriminatorsExhaustive("kind")({
                claimed: ({ variance }) =>
                  Effect.gen(function* () {
                    const issued = yield* Effect.result(
                      igloohome.issueHourlyAlgoPin({
                        deviceId,
                        variance,
                        ...providerTimestamps(input.request),
                        accessName: input.request.name,
                      })
                    );
                    if (Result.isSuccess(issued)) {
                      return yield* recordCreated({
                        request: input,
                        attempt,
                        variance,
                        issued: issued.success,
                      });
                    }
                    return yield* recordProviderRejection({
                      request: input,
                      attempt,
                      variance,
                      error: issued.failure,
                    });
                  }),
                created: ({ terminal }) =>
                  Effect.succeed(alreadyCreatedOutcome(input, terminal)),
                rejected: ({ failureCode }) =>
                  Effect.fail(
                    failCreation(
                      input,
                      "rejected",
                      "The standalone access-code request was rejected.",
                      { failureCode }
                    )
                  ),
                ambiguous: ({ failureCode }) =>
                  Effect.fail(
                    failCreation(
                      input,
                      "ambiguous",
                      "The standalone access-code creation outcome is ambiguous.",
                      {
                        failureCode,
                        cleanupTarget: ambiguousTargetOf(input),
                      }
                    )
                  ),
                "in-progress": () =>
                  Effect.fail(
                    failCreation(
                      input,
                      "in-progress",
                      "Standalone access-code creation is already in progress."
                    )
                  ),
                "cleanup-required": ({ cleanupTarget }) =>
                  Effect.fail(
                    failCreation(
                      input,
                      "cleanup-required",
                      "A previous attempt for this window is ambiguous. Remove the access code in the Igloohome app over Bluetooth, or verify it is absent, then confirm the cleanup before creating another code.",
                      { cleanupTarget }
                    )
                  ),
                reconciled: () =>
                  Effect.fail(
                    failCreation(
                      input,
                      "reconciled",
                      "Your confirmed cleanup was recorded for the earlier ambiguous attempt, which created no access code. Run the same command again to create the code."
                    )
                  ),
                mismatch: () =>
                  Effect.fail(
                    failCreation(
                      input,
                      "rejected",
                      "The attempt identifier was already used with different input, actor, or source."
                    )
                  ),
                exhausted: () =>
                  Effect.fail(
                    failCreation(
                      input,
                      "rejected",
                      "Both standalone access codes are in use for this device and window."
                    )
                  ),
              })
            );
          }
        ),
      });
    })
  );

  static Live = this.Default.pipe(
    Layer.provide(StandaloneAccessCodeAttemptLogRepository.Live),
    Layer.provide(WorkspaceIgloohomeLayer)
  );
}
