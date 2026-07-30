import {
  EffectAction,
  type EffectActionArgs,
  type EffectActionState,
} from "@deskohub/next-effect/effect-action";
import type { StandardSchemaV1 } from "@standard-schema/spec";
import { Duration, Effect, References } from "effect";
import { headers } from "next/headers";
import type {
  FlattenedValidationErrors,
  ValidationErrors,
} from "next-safe-action";
import type { Locale } from "@/features/i18n";
import { formatError } from "../utils/error-formatting";
import {
  actionClient,
  getPublicSafeActionErrorMessage,
  PublicSafeActionError,
} from "../utils/safe-action-client";
import { BotProtectionService } from "./bot-protection/bot-protection.service";
import { runWorkspaceEffect } from "./workspace-effect";
import { withWorkspaceRequestContext } from "./workspace-request-context";

type WorkspaceActionArgs<S extends StandardSchemaV1> = EffectActionArgs<
  S,
  { readonly locale: Locale }
>;

type WorkspaceActionValidationErrors<S extends StandardSchemaV1> =
  FlattenedValidationErrors<ValidationErrors<S>>;

export interface WorkspaceActionOptions<S extends StandardSchemaV1> {
  /**
   * Set to false for inputs containing data that must not be persisted in
   * telemetry, such as customer contact details.
   */
  readonly logInput?: boolean;
  /** Stable, low-cardinality name without IDs or payload data. */
  readonly operation: string;
  readonly schema: S;
}

export interface WorkspaceActionContext<S extends StandardSchemaV1> {
  readonly clientInput: StandardSchemaV1.InferInput<S>;
  readonly locale: Locale;
}

export const defineWorkspaceAction = <S extends StandardSchemaV1, A, E>(
  options: WorkspaceActionOptions<S>,
  handler: (
    input: StandardSchemaV1.InferOutput<S>,
    context: WorkspaceActionContext<S>
  ) => Effect.Effect<A, E, BotProtectionService>
) =>
  EffectAction.fromClient(actionClient, {
    run: runWorkspaceEffect(options.operation, { boundary: "action" }),
  })
    .inputSchema(options.schema)
    .action((args) =>
      prepareWorkspaceAction(args, options, () =>
        handler(args.parsedInput, getWorkspaceActionContext(args))
      )
    );

export const defineWorkspaceStateAction = <S extends StandardSchemaV1, A, E>(
  options: WorkspaceActionOptions<S>,
  handler: (
    input: StandardSchemaV1.InferOutput<S>,
    context: WorkspaceActionContext<S>,
    state: EffectActionState<string, S, WorkspaceActionValidationErrors<S>, A>
  ) => Effect.Effect<A, E, BotProtectionService>
) =>
  EffectAction.fromClient(actionClient, {
    run: runWorkspaceEffect(options.operation, { boundary: "action" }),
  })
    .inputSchema(options.schema)
    .stateAction<A, Error | PublicSafeActionError>((args, state) =>
      prepareWorkspaceAction(args, options, () =>
        handler(args.parsedInput, getWorkspaceActionContext(args), state)
      )
    );

const prepareWorkspaceAction = <S extends StandardSchemaV1, A, E>(
  args: WorkspaceActionArgs<S>,
  options: Pick<WorkspaceActionOptions<S>, "logInput">,
  handler: () => Effect.Effect<A, E, BotProtectionService>
) => {
  const logged = Effect.gen(function* () {
    yield* Effect.logDebug("Safe action executed").pipe(
      Effect.annotateLogs({
        locale: args.ctx.locale,
        ...(options.logInput === false ? {} : { input: args.parsedInput }),
      })
    );
    const result = yield* Effect.suspend(handler).pipe(
      Effect.provide(BotProtectionService.Live)
    );
    yield* Effect.logDebug("Action completed successfully");
    return result;
  }).pipe(
    Effect.tapError((error) =>
      Effect.logError("Action failed").pipe(Effect.annotateLogs({ error }))
    ),
    Effect.mapError(mapSafeActionFailure)
  );

  const invocation = readActionHeaders.pipe(
    Effect.flatMap((requestHeaders) =>
      logged.pipe(withWorkspaceRequestContext(requestHeaders))
    ),
    Effect.provideService(References.MinimumLogLevel, "All"),
    Effect.timeoutOrElse({
      duration: Duration.seconds(45),
      orElse: () =>
        Effect.fail(
          new PublicSafeActionError({
            message: "Request timed out. Please try again.",
          })
        ),
    })
  );

  return invocation;
};

const getWorkspaceActionContext = <S extends StandardSchemaV1>(
  args: WorkspaceActionArgs<S>
): WorkspaceActionContext<S> => ({
  clientInput: args.clientInput,
  locale: args.ctx.locale,
});

const readActionHeaders = Effect.tryPromise({
  try: () => headers(),
  catch: (cause) => cause,
}).pipe(Effect.orDie);

const mapSafeActionFailure = (error: unknown) => {
  const publicMessage = getPublicSafeActionErrorMessage(error);
  if (publicMessage) {
    return new PublicSafeActionError({ message: publicMessage, cause: error });
  }

  const formatted = formatError(error);
  return new Error(formatted.code || "INTERNAL_ACTION_ERROR", {
    cause: error,
  });
};
