import {
  EffectAction,
  type EffectActionArgs,
  type EffectActionState,
} from "@deskohub/next-effect/effect-action";
import type { StandardSchemaV1 } from "@standard-schema/spec";
import { Data, Duration, Effect, Predicate, References } from "effect";
import { headers } from "next/headers";
import type {
  FlattenedValidationErrors,
  ValidationErrors,
} from "next-safe-action";
import { type Locale, type LocalizedCopy, m } from "@/features/i18n";
import {
  createWorkspaceActionClient,
  PublicSafeActionError,
  type SafeActionFailure,
} from "../utils/safe-action-client";
import { BotProtectionService } from "./bot-protection/bot-protection.service";
import { RequestHeadersError } from "./utils/request-headers";
import {
  runWorkspaceEffect,
  scheduleWorkspaceTelemetryFlush,
} from "./workspace-effect";
import { withWorkspaceRequestContext } from "./workspace-request-context";

type WorkspaceActionArgs<S extends StandardSchemaV1> = EffectActionArgs<
  S,
  { readonly locale: Locale }
>;

type WorkspaceActionValidationErrors<S extends StandardSchemaV1> =
  FlattenedValidationErrors<ValidationErrors<S>>;

type WorkspaceActionValidationIssue = {
  readonly message: string;
  readonly path: readonly string[];
};

/**
 * Copy for the failures the action runtime reports by itself, rendered in the
 * action's locale. Messages from the catalog that owns the action's screens
 * pass as is.
 */
export interface WorkspaceActionFailureCopy {
  /** The action outlived its deadline. */
  readonly timeout: LocalizedCopy;
  /**
   * A failure the action didn't make public, including a defect or a runtime
   * that could not start.
   */
  readonly unexpected: LocalizedCopy;
}

/** The runtime failure copy of a customer-facing action. */
const customerActionFailureCopy: WorkspaceActionFailureCopy = {
  timeout: m.actionTimedOut,
  unexpected: m.actionFailedUnexpectedly,
};

export interface WorkspaceActionOptions<S extends StandardSchemaV1> {
  /**
   * How long the whole action may run before the customer is told to try
   * again. Defaults to `workspaceActionDeadline`; raise it only for an action
   * whose provider requests cannot fit.
   */
  readonly deadline?: Duration.Input;
  /**
   * Copy for the runtime's own failures. Defaults to the customer catalog; an
   * administration area passes its catalog's copy.
   */
  readonly failureCopy?: WorkspaceActionFailureCopy;
  /**
   * Shown for a failure the handler fails with but didn't make public, in
   * place of `failureCopy.unexpected`. The original failure is still logged.
   * A defect stays unexpected.
   */
  readonly fallback?: LocalizedCopy;
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

/** The deadline of an action that sets none of its own. */
export const workspaceActionDeadline = Duration.seconds(45);

/** An action outlived its deadline. */
class WorkspaceActionTimeout extends Data.TaggedError(
  "WorkspaceActionTimeout"
) {}

/** Fails an action that outlives `deadline` with a `WorkspaceActionTimeout`. */
export const withActionDeadline =
  (deadline: Duration.Input) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    effect.pipe(
      Effect.timeoutOrElse({
        duration: deadline,
        orElse: () => Effect.fail(new WorkspaceActionTimeout()),
      })
    );

const getFailureCopy = ({
  failureCopy = customerActionFailureCopy,
}: Pick<WorkspaceActionOptions<StandardSchemaV1>, "failureCopy">) =>
  failureCopy;

const createActionClient = <S extends StandardSchemaV1>(
  options: WorkspaceActionOptions<S>
) => createWorkspaceActionClient(getFailureCopy(options).unexpected);

export const defineWorkspaceAction = <
  S extends StandardSchemaV1,
  A,
  E extends SafeActionFailure,
>(
  options: WorkspaceActionOptions<S>,
  handler: (
    input: StandardSchemaV1.InferOutput<S>,
    context: WorkspaceActionContext<S>
  ) => Effect.Effect<A, E, BotProtectionService>
) =>
  EffectAction.fromClient(createActionClient(options), {
    run: runWorkspaceEffect(options.operation, { boundary: "action" }),
  })
    .inputSchema(options.schema, {
      handleValidationErrorsShape: (validationErrors) =>
        handleWorkspaceActionValidationFailure(
          options.operation,
          validationErrors,
          options.logInput !== false
        ),
    })
    .action((args) =>
      prepareWorkspaceAction(args, options, () =>
        handler(args.parsedInput, getWorkspaceActionContext(args))
      )
    );

export const defineWorkspaceStateAction = <
  S extends StandardSchemaV1,
  A,
  E extends SafeActionFailure,
>(
  options: WorkspaceActionOptions<S>,
  handler: (
    input: StandardSchemaV1.InferOutput<S>,
    context: WorkspaceActionContext<S>,
    state: EffectActionState<string, S, WorkspaceActionValidationErrors<S>, A>
  ) => Effect.Effect<A, E, BotProtectionService>
) =>
  EffectAction.fromClient(createActionClient(options), {
    run: runWorkspaceEffect(options.operation, { boundary: "action" }),
  })
    .inputSchema(options.schema, {
      handleValidationErrorsShape: (validationErrors) =>
        handleWorkspaceActionValidationFailure(
          options.operation,
          validationErrors,
          options.logInput !== false
        ),
    })
    .stateAction<A, Error | PublicSafeActionError>((args, state) =>
      prepareWorkspaceAction(args, options, () =>
        handler(args.parsedInput, getWorkspaceActionContext(args), state)
      )
    );

const prepareWorkspaceAction = <
  S extends StandardSchemaV1,
  A,
  E extends SafeActionFailure,
>(
  args: WorkspaceActionArgs<S>,
  options: Pick<
    WorkspaceActionOptions<S>,
    "deadline" | "failureCopy" | "fallback" | "logInput"
  >,
  handler: () => Effect.Effect<A, E, BotProtectionService>
) => {
  const logged = Effect.gen(function* () {
    yield* Effect.logDebug("Safe action executed").pipe(
      Effect.annotateLogs({
        locale: args.ctx.locale,
        input: options.logInput === false ? undefined : args.parsedInput,
      })
    );
    const result = yield* Effect.suspend(handler).pipe(
      Effect.provide(BotProtectionService.Default)
    );
    yield* Effect.logDebug("Action completed successfully");
    return result;
  }).pipe(
    Effect.tapError((error) =>
      Effect.logError("Action failed").pipe(Effect.annotateLogs({ error }))
    ),
    Effect.mapError((error) =>
      error instanceof PublicSafeActionError
        ? error
        : new PublicSafeActionError({
            message: (options.fallback ?? getFailureCopy(options).unexpected)(
              {},
              { locale: args.ctx.locale }
            ),
            cause: error,
          })
    )
  );

  const invocation = readActionHeaders.pipe(
    Effect.flatMap((requestHeaders) =>
      logged.pipe(withWorkspaceRequestContext(requestHeaders))
    ),
    Effect.provideService(References.MinimumLogLevel, "All"),
    withActionDeadline(options.deadline ?? workspaceActionDeadline),
    Effect.mapError((error) =>
      error instanceof WorkspaceActionTimeout
        ? new PublicSafeActionError({
            message: getFailureCopy(options).timeout(
              {},
              { locale: args.ctx.locale }
            ),
            cause: error,
          })
        : error
    )
  );

  return Effect.andThen(scheduleWorkspaceTelemetryFlush(), invocation);
};

const getWorkspaceActionContext = <S extends StandardSchemaV1>(
  args: WorkspaceActionArgs<S>
): WorkspaceActionContext<S> => ({
  clientInput: args.clientInput,
  locale: args.ctx.locale,
});

const readActionHeaders = Effect.tryPromise({
  try: () => headers(),
  catch: (cause) =>
    new RequestHeadersError({
      message: "Could not load the current request headers.",
      cause,
    }),
}).pipe(Effect.orDie);

const handleWorkspaceActionValidationFailure = async <
  S extends StandardSchemaV1,
>(
  operation: string,
  validationErrors: ValidationErrors<S>,
  logValidationPaths: boolean
): Promise<WorkspaceActionValidationErrors<S>> => {
  const issues = collectWorkspaceActionValidationIssues(validationErrors);

  await Effect.gen(function* () {
    yield* Effect.logWarning("Action input validation failed").pipe(
      Effect.annotateLogs({
        validationIssueCount: issues.length,
        ...(logValidationPaths && {
          validationPaths: [
            ...new Set(
              issues.map(({ path }) =>
                formatWorkspaceActionValidationPath(path)
              )
            ),
          ],
        }),
      })
    );
    yield* scheduleWorkspaceTelemetryFlush();
  }).pipe(runWorkspaceEffect(operation, { boundary: "action" }));

  const fieldErrors = Object.groupBy(
    issues.filter(({ path }) => path.length > 0),
    ({ path }) => path[0] ?? ""
  );

  return {
    formErrors: issues
      .filter(({ path }) => path.length === 0)
      .map(({ message }) => message),
    fieldErrors: Object.fromEntries(
      Object.entries(fieldErrors).map(([field, fieldIssues]) => [
        field,
        (fieldIssues ?? []).map(({ message, path }) => {
          const nestedPath = formatWorkspaceActionValidationPath(
            path.slice(1),
            ""
          );
          return nestedPath ? `${nestedPath}: ${message}` : message;
        }),
      ])
    ),
  } as WorkspaceActionValidationErrors<S>;
};

const collectWorkspaceActionValidationIssues = <T>(
  value: T,
  path: readonly string[] = []
): readonly WorkspaceActionValidationIssue[] => {
  if (Array.isArray(value)) {
    return value.flatMap((item) =>
      Predicate.isString(item) ? [{ message: item, path }] : []
    );
  }
  if (!Predicate.isObject(value)) return [];

  return Object.entries(value).flatMap(([key, item]) =>
    collectWorkspaceActionValidationIssues(
      item,
      key === "_errors" ? path : [...path, key]
    )
  );
};

const formatWorkspaceActionValidationPath = (
  path: readonly string[],
  root = "$"
) => {
  let formatted = root;
  for (const segment of path) {
    if (/^\d+$/.test(segment)) {
      formatted = `${formatted}[${segment}]`;
      continue;
    }
    formatted = formatted ? `${formatted}.${segment}` : segment;
  }
  return formatted;
};
