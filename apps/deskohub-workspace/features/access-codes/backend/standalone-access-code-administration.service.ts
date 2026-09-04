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
  type AdministrationStandaloneAccessCodeCreateInput,
  type AdministrationStandaloneAccessCodeCreationOutcome,
  AdministrationStandaloneAccessCodePin,
} from "@deskohub/workspace-admin-api";
import { Context, Data, Effect, Layer, Match, Schema } from "effect";
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
  type StandaloneAccessCodeCreatedAttemptTerminal,
} from "./standalone-access-code-attempt-log.repository";

export class StandaloneAccessCodeCreationError extends Data.TaggedError(
  "StandaloneAccessCodeCreationError"
)<{
  readonly attemptId: AdministrationStandaloneAccessCodeAttemptId;
  readonly outcome: StandaloneAccessCodeCreationOutcome;
  readonly failureCode?: StandaloneAccessCodeFailureCode;
  readonly message: string;
  readonly cause?: unknown;
}> {}

interface IStandaloneAccessCodeAdministration {
  readonly create: (input: {
    readonly attemptId: AdministrationStandaloneAccessCodeAttemptId;
    readonly actor: AdministrationActorUsername;
    readonly source: StandaloneAccessCodeSource;
    readonly request: AdministrationStandaloneAccessCodeCreateInput;
    readonly providerCredentialRemoved: boolean;
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
        failureCode?: StandaloneAccessCodeFailureCode,
        cause?: unknown
      ) =>
        new StandaloneAccessCodeCreationError({
          attemptId: input.attemptId,
          outcome,
          failureCode,
          message,
          cause,
        });

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

      const recordProviderRejection = (input: {
        readonly request: StandaloneAccessCodeCreationRequest;
        readonly attempt: StandaloneAccessCodeAttempt;
        readonly variance: StandaloneAccessCodeProviderVariance;
        readonly error: IgloohomeRequestError;
      }) => {
        const eventKind = input.error.outcome;
        const failureCode =
          eventKind === "rejected"
            ? "standalone_provider_rejected"
            : "standalone_provider_ambiguous";
        return attempts
          .appendTerminal({
            attempt: input.attempt,
            variance: input.variance,
            eventKind,
            occurredAt: Temporal.Now.instant(),
            providerStatusCode: input.error.statusCode,
            failureCode,
          })
          .pipe(
            Effect.catch((storageError) =>
              logTerminalAuditFailure({
                attemptId: input.request.attemptId,
                eventKind,
                cause: storageError,
              })
            ),
            Effect.andThen(
              Effect.fail(
                failCreation(
                  input.request,
                  eventKind,
                  eventKind === "rejected"
                    ? "The standalone access-code request was rejected."
                    : "The standalone access-code creation outcome is ambiguous.",
                  failureCode
                )
              )
            )
          );
      };

      const recordCreated = (input: {
        readonly request: StandaloneAccessCodeCreationRequest;
        readonly attempt: StandaloneAccessCodeAttempt;
        readonly variance: StandaloneAccessCodeProviderVariance;
        readonly issued: { readonly pin: string; readonly pinId: string };
      }) => {
        const issuedAt = Temporal.Now.instant();
        const pin = Schema.decodeSync(AdministrationStandaloneAccessCodePin)(
          input.issued.pin
        );
        const providerCredentialId = Schema.decodeSync(
          AdministrationProviderCredentialId
        )(input.issued.pinId);
        return attempts
          .appendTerminal({
            attempt: input.attempt,
            variance: input.variance,
            eventKind: "created",
            occurredAt: issuedAt,
            providerCredentialId,
          })
          .pipe(
            Effect.catch((storageError) =>
              logTerminalAuditFailure({
                attemptId: input.request.attemptId,
                eventKind: "created",
                cause: storageError,
              })
            ),
            Effect.andThen(
              Effect.succeed(
                createdOutcome({
                  request: input.request,
                  providerCredentialId,
                  pin,
                  issuedAt,
                })
              )
            )
          );
      };

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
                providerCredentialRemoved: input.providerCredentialRemoved,
              })
              .pipe(
                Effect.mapError((cause) =>
                  failCreation(
                    input,
                    "unavailable",
                    "Standalone access-code creation is temporarily unavailable.",
                    undefined,
                    cause
                  )
                )
              );

            return yield* Match.value(claimed).pipe(
              Match.discriminatorsExhaustive("kind")({
                claimed: ({ variance }) =>
                  igloohome
                    .issueHourlyAlgoPin({
                      deviceId,
                      variance,
                      ...providerTimestamps(input.request),
                      accessName: input.request.name,
                    })
                    .pipe(
                      Effect.catch((error: IgloohomeRequestError) =>
                        recordProviderRejection({
                          request: input,
                          attempt,
                          variance,
                          error,
                        })
                      ),
                      Effect.andThen((issued) =>
                        recordCreated({
                          request: input,
                          attempt,
                          variance,
                          issued,
                        })
                      )
                    ),
                created: ({ terminal }) =>
                  Effect.succeed(alreadyCreatedOutcome(input, terminal)),
                rejected: ({ failureCode }) =>
                  Effect.fail(
                    failCreation(
                      input,
                      "rejected",
                      "The standalone access-code request was rejected.",
                      failureCode
                    )
                  ),
                ambiguous: ({ failureCode }) =>
                  Effect.fail(
                    failCreation(
                      input,
                      "ambiguous",
                      "The standalone access-code creation outcome is ambiguous.",
                      failureCode
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
                "cleanup-required": () =>
                  Effect.fail(
                    failCreation(
                      input,
                      "cleanup-required",
                      "A previous attempt for this window is ambiguous. Remove the access code in the Igloohome app over Bluetooth, or verify it is absent, then confirm the cleanup before creating another code."
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
