import {
  EffectAction,
  type EffectActionArgs,
  type EffectActionState,
} from "@deskohub/next-effect/effect-action";
import type { StandardSchemaV1 } from "@standard-schema/spec";
import {
  Cause,
  Data,
  Duration,
  Effect,
  Predicate,
  Ref,
  References,
  Result,
} from "effect";
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
import {
  collectSpanMetadata,
  continueActiveTrace,
} from "./observability/trace-correlation";
import { runStandaloneWorkspaceEffect } from "./standalone-workspace-effect";
import { RequestHeadersError } from "./utils/request-headers";
import {
  findNextControlFlow,
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
) =>
  createWorkspaceActionClient({
    // The shared runtime may be what failed, so this log goes through the
    // standalone one.
    logUnexpectedFailure: (error) =>
      logActionFailure(Cause.die(error)).pipe(
        continueActiveTrace,
        runStandaloneWorkspaceEffect(options.operation)
      ),
    unexpectedFailure: getFailureCopy(options).unexpected,
  });

/**
 * Logs one "Action failed" entry for an action that ended without a result:
 * its typed failure, or the whole cause of a defect or an interruption, such
 * as the handler interrupted at its deadline. The logger redacts messages and
 * payloads and keeps error classes and stack frames. The entry carries the
 * ids of the span it is logged in. Next.js control flow is not a failure and
 * stays unlogged.
 */
const logActionFailure = <E>(cause: Cause.Cause<E>) =>
  findNextControlFlow(cause) === undefined
    ? Effect.flatMap(collectSpanMetadata, (spanMetadata) =>
        Effect.logError("Action failed").pipe(
          Effect.annotateLogs({
            ...spanMetadata,
            ...describeActionFailure(cause),
          })
        )
      )
    : Effect.void;

const describeActionFailure = <E>(cause: Cause.Cause<E>) => {
  // Only the `cause` annotation redacts a defect that isn't an Error, such as
  // a thrown string.
  if (Cause.hasDies(cause)) return { failureKind: "defect", cause };
  return Result.match(Cause.findError(cause), {
    onFailure: () => ({ failureKind: "interruption", cause }),
    onSuccess: (error) => ({ failureKind: "failure", error }),
  });
};

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
    "deadline" | "failureCopy" | "fallback" | "logInput" | "operation"
  >,
  handler: () => Effect.Effect<A, E, BotProtectionService>
) => {
  const inActionLocale = (copy: LocalizedCopy) =>
    copy({}, { locale: args.ctx.locale });

  const handled = Effect.gen(function* () {
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
  });

  const invocation = Effect.gen(function* () {
    const failureLogged = yield* Ref.make(false);
    const logFailureOnce = <F>(cause: Cause.Cause<F>) =>
      Effect.flatMap(Ref.getAndSet(failureLogged, true), (logged) =>
        logged ? Effect.void : logActionFailure(cause)
      );

    return yield* readActionHeaders.pipe(
      Effect.flatMap((requestHeaders) =>
        handled.pipe(
          // Logged inside the request context to keep its annotations.
          Effect.onError(logFailureOnce),
          withWorkspaceRequestContext(requestHeaders)
        )
      ),
      // Logs what ended the action before its handler could, such as a header
      // read that outlived the deadline.
      Effect.onError(logFailureOnce),
      // Every failure logged above leaves as a public error, so the safe-action
      // client logs only what never got here.
      Effect.catchCause((cause) => {
        const controlFlow = findNextControlFlow(cause);
        if (controlFlow !== undefined) return Effect.die(controlFlow);

        // A defect or an interruption stays unexpected, even beside a typed
        // failure.
        const typedFailure = Cause.hasDies(cause)
          ? Result.fail(cause)
          : Cause.findError(cause);
        return Result.match(typedFailure, {
          onFailure: () =>
            Effect.fail(
              new PublicSafeActionError({
                message: inActionLocale(getFailureCopy(options).unexpected),
              })
            ),
          onSuccess: (error) =>
            Effect.fail(
              error instanceof PublicSafeActionError
                ? error
                : new PublicSafeActionError({
                    message: inActionLocale(
                      options.fallback ?? getFailureCopy(options).unexpected
                    ),
                    cause: error,
                  })
            ),
        });
      })
    );
  }).pipe(
    Effect.provideService(References.MinimumLogLevel, "All"),
    withActionDeadline(options.deadline ?? workspaceActionDeadline),
    Effect.mapError((error) =>
      error instanceof WorkspaceActionTimeout
        ? new PublicSafeActionError({
            message: inActionLocale(getFailureCopy(options).timeout),
            cause: error,
          })
        : error
    ),
    Effect.withSpan(options.operation, {
      attributes: { "action.locale": args.ctx.locale },
    })
  );

  // The runtime may run the action outside the request's async context, so
  // the request's span is captured here.
  return Effect.andThen(scheduleWorkspaceTelemetryFlush(), invocation).pipe(
    continueActiveTrace
  );
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
