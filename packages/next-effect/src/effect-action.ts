import type { StandardSchemaV1 } from "@standard-schema/spec";
import { Effect, type Layer } from "effect";
import type {
  ActionCallbacks,
  EffectiveThrows,
  FlattenedValidationErrors,
  HandleValidationErrorsShapeFn,
  MaybeBrandThrows,
  SafeActionClient,
  SafeActionFn,
  ValidationErrors,
  ValidationErrorsFormat,
} from "next-safe-action";
import type { EffectBoundaryOptions } from "./effect-boundary";
import { provideBoundaryLayer } from "./internal/boundary";
import {
  type EffectRunExit,
  type ExecuteRun,
  execute,
} from "./internal/executor";

type SchemaInput<S extends StandardSchemaV1> = StandardSchemaV1.InferInput<S>;
type SchemaOutput<S extends StandardSchemaV1> = StandardSchemaV1.InferOutput<S>;
type SchemaOutputOrDefault<MaybeSchema, Default> =
  MaybeSchema extends StandardSchemaV1 ? SchemaOutput<MaybeSchema> : Default;

export interface EffectActionArgs<
  S extends StandardSchemaV1,
  Ctx extends object,
  Metadata = unknown,
> {
  readonly parsedInput: SchemaOutput<S>;
  readonly clientInput: SchemaInput<S>;
  readonly bindArgsParsedInputs: readonly unknown[];
  readonly bindArgsClientInputs: readonly unknown[];
  readonly ctx: Ctx;
  readonly metadata: Metadata;
}

export interface EffectActionBoundaryInvocation<
  S extends StandardSchemaV1,
  Ctx extends object,
  Metadata,
> {
  readonly operation: string;
  readonly args: EffectActionArgs<S, Ctx, Metadata>;
}

export type EffectActionBoundaryPrepare<Ctx extends object, Metadata> = <
  S extends StandardSchemaV1,
  A,
  E,
>(
  invocation: EffectActionBoundaryInvocation<S, Ctx, Metadata>,
  effect: Effect.Effect<A, E, never>
) => Effect.Effect<A, unknown, never>;

export interface EffectActionBoundaryOptions<Ctx extends object, Metadata> {
  readonly runExit: EffectRunExit;
  readonly prepare: EffectActionBoundaryPrepare<Ctx, Metadata>;
}

interface EffectActionBaseOptions {
  readonly mapError?: (error: unknown) => unknown;
}

type EffectActionExecutorOptions =
  | {
      readonly run?: ExecuteRun;
      readonly runExit?: never;
    }
  | {
      readonly run?: never;
      readonly runExit: EffectRunExit;
    };

type EffectActionRunnableOptions = EffectActionBaseOptions &
  EffectActionExecutorOptions & {
    readonly layer?: undefined;
  };

type EffectActionLayerOptions<R, LE> = EffectActionBaseOptions &
  EffectActionExecutorOptions & {
    readonly layer: Layer.Layer<R, LE, never>;
  };

export type EffectActionOptions<R = never, LE = never> =
  | EffectActionRunnableOptions
  | EffectActionLayerOptions<R, LE>;

type SafeActionValidationErrors<
  ErrorsFormat extends ValidationErrorsFormat | undefined,
  S extends StandardSchemaV1,
> = ErrorsFormat extends "flattened"
  ? FlattenedValidationErrors<ValidationErrors<S>>
  : ValidationErrors<S>;

export interface EffectActionBoundary<
  ServerError,
  ErrorsFormat extends ValidationErrorsFormat | undefined,
  Metadata,
  Ctx extends object,
  ThrowsValidationErrors extends boolean = false,
> {
  readonly action: {
    <S extends StandardSchemaV1, A, E>(
      options: EffectBoundaryOptions & { readonly schema: S },
      handler: (
        args: EffectActionArgs<S, Ctx, Metadata>
      ) => Effect.Effect<A, E, never>
    ): MaybeBrandThrows<
      SafeActionFn<
        ServerError,
        S,
        readonly [],
        SafeActionValidationErrors<ErrorsFormat, S>,
        A
      >,
      ThrowsValidationErrors
    >;
    <S extends StandardSchemaV1, A, E, R, LE>(
      options: EffectBoundaryOptions & {
        readonly schema: S;
        readonly layer: Layer.Layer<R, LE, never>;
      },
      handler: (
        args: EffectActionArgs<S, Ctx, Metadata>
      ) => Effect.Effect<A, E, R>
    ): MaybeBrandThrows<
      SafeActionFn<
        ServerError,
        S,
        readonly [],
        SafeActionValidationErrors<ErrorsFormat, S>,
        A
      >,
      ThrowsValidationErrors
    >;
  };
}

interface EffectActionSafeClient<
  ServerError,
  ErrorsFormat extends ValidationErrorsFormat | undefined,
  Metadata,
  HasMetadata extends boolean,
  Ctx extends object,
  OutputSchema extends StandardSchemaV1 | undefined,
  BindArgsSchemas extends readonly [],
  ThrowsValidationErrors extends boolean,
  PreValidationCtx extends object,
  R,
> {
  inputSchema<S extends StandardSchemaV1>(
    schema: S,
    utils?: {
      readonly handleValidationErrorsShape?: HandleValidationErrorsShapeFn<
        S,
        BindArgsSchemas,
        Metadata,
        Ctx,
        SafeActionValidationErrors<ErrorsFormat, S>
      >;
    }
  ): {
    action<
      A extends SchemaOutputOrDefault<OutputSchema, unknown>,
      E,
      Utils extends ActionCallbacks<
        ServerError,
        Metadata,
        Ctx,
        S,
        BindArgsSchemas,
        SafeActionValidationErrors<ErrorsFormat, S>,
        A,
        PreValidationCtx
      > = ActionCallbacks<
        ServerError,
        Metadata,
        Ctx,
        S,
        BindArgsSchemas,
        SafeActionValidationErrors<ErrorsFormat, S>,
        A,
        PreValidationCtx
      >,
    >(
      this: HasMetadata extends true ? object : never,
      handler: (
        args: EffectActionArgs<S, Ctx, Metadata>
      ) => Effect.Effect<A, E, R>,
      utils?: Utils
    ): MaybeBrandThrows<
      SafeActionFn<
        ServerError,
        S,
        BindArgsSchemas,
        SafeActionValidationErrors<ErrorsFormat, S>,
        A
      >,
      EffectiveThrows<ThrowsValidationErrors, Utils>
    >;
  };
}

function makeEffectActionClient<
  ServerError,
  ErrorsFormat extends ValidationErrorsFormat | undefined,
  MetadataSchema extends StandardSchemaV1 | undefined,
  Ctx extends object,
  InputSchemaFn extends
    | ((clientInput?: unknown) => Promise<StandardSchemaV1>)
    | undefined,
  InputSchema extends StandardSchemaV1 | undefined,
  BindArgsSchemas extends readonly [],
  ShapedErrors,
  ThrowsValidationErrors extends boolean,
  PreValidationCtx extends object,
  R,
  Metadata,
>(
  actionClient: SafeActionClient<
    ServerError,
    ErrorsFormat,
    MetadataSchema,
    Metadata,
    true,
    Ctx,
    InputSchemaFn,
    InputSchema,
    undefined,
    BindArgsSchemas,
    ShapedErrors,
    ThrowsValidationErrors,
    false,
    PreValidationCtx
  >,
  runEffect: <A, E>(effect: Effect.Effect<A, E, R>) => Promise<A>
): EffectActionSafeClient<
  ServerError,
  ErrorsFormat,
  Metadata,
  true,
  Ctx,
  undefined,
  BindArgsSchemas,
  ThrowsValidationErrors,
  PreValidationCtx,
  R
> {
  return {
    inputSchema(schema, inputUtils) {
      const builder = actionClient.inputSchema(schema, inputUtils);

      return {
        action(handler, actionUtils) {
          return builder.action(
            (args) => runEffect(Effect.suspend(() => handler(args))),
            actionUtils
          );
        },
      };
    },
  };
}

function fromClient<
  ServerError,
  ErrorsFormat extends ValidationErrorsFormat | undefined,
  MetadataSchema extends StandardSchemaV1 | undefined,
  Metadata,
  Ctx extends object,
  InputSchemaFn extends
    | ((clientInput?: unknown) => Promise<StandardSchemaV1>)
    | undefined,
  InputSchema extends StandardSchemaV1 | undefined,
  BindArgsSchemas extends readonly [],
  ShapedErrors,
  ThrowsValidationErrors extends boolean,
  PreValidationCtx extends object,
>(
  actionClient: SafeActionClient<
    ServerError,
    ErrorsFormat,
    MetadataSchema,
    Metadata,
    true,
    Ctx,
    InputSchemaFn,
    InputSchema,
    undefined,
    BindArgsSchemas,
    ShapedErrors,
    ThrowsValidationErrors,
    false,
    PreValidationCtx
  >,
  options?: EffectActionRunnableOptions
): EffectActionSafeClient<
  ServerError,
  ErrorsFormat,
  Metadata,
  true,
  Ctx,
  undefined,
  BindArgsSchemas,
  ThrowsValidationErrors,
  PreValidationCtx,
  never
>;
function fromClient<
  ServerError,
  ErrorsFormat extends ValidationErrorsFormat | undefined,
  MetadataSchema extends StandardSchemaV1 | undefined,
  Metadata,
  Ctx extends object,
  InputSchemaFn extends
    | ((clientInput?: unknown) => Promise<StandardSchemaV1>)
    | undefined,
  InputSchema extends StandardSchemaV1 | undefined,
  BindArgsSchemas extends readonly [],
  ShapedErrors,
  ThrowsValidationErrors extends boolean,
  PreValidationCtx extends object,
  R,
  LE,
>(
  actionClient: SafeActionClient<
    ServerError,
    ErrorsFormat,
    MetadataSchema,
    Metadata,
    true,
    Ctx,
    InputSchemaFn,
    InputSchema,
    undefined,
    BindArgsSchemas,
    ShapedErrors,
    ThrowsValidationErrors,
    false,
    PreValidationCtx
  >,
  options: EffectActionLayerOptions<R, LE>
): EffectActionSafeClient<
  ServerError,
  ErrorsFormat,
  Metadata,
  true,
  Ctx,
  undefined,
  BindArgsSchemas,
  ThrowsValidationErrors,
  PreValidationCtx,
  R
>;
function fromClient(
  actionClient: SafeActionClient<
    unknown,
    ValidationErrorsFormat | undefined,
    undefined,
    unknown,
    true,
    object,
    ((clientInput?: unknown) => Promise<StandardSchemaV1>) | undefined,
    StandardSchemaV1 | undefined,
    undefined,
    readonly [],
    unknown,
    boolean,
    false,
    object
  >,
  options: EffectActionOptions<unknown, unknown> = {}
): unknown {
  assertExecutorOptions(options);

  if (options.layer) {
    return makeEffectActionClient(actionClient, (effect) =>
      execute(Effect.provide(effect, options.layer), getExecuteOptions(options))
    );
  }

  return makeEffectActionClient(
    actionClient,
    <A, E>(effect: Effect.Effect<A, E, never>) =>
      execute(effect, getExecuteOptions(options))
  );
}

function makeBoundary<
  ServerError,
  ErrorsFormat extends ValidationErrorsFormat | undefined,
  MetadataSchema extends StandardSchemaV1 | undefined,
  Metadata,
  Ctx extends object,
  InputSchemaFn extends
    | ((clientInput?: unknown) => Promise<StandardSchemaV1>)
    | undefined,
  InputSchema extends StandardSchemaV1 | undefined,
  BindArgsSchemas extends readonly [],
  ShapedErrors,
  ThrowsValidationErrors extends boolean,
  PreValidationCtx extends object,
>(
  actionClient: SafeActionClient<
    ServerError,
    ErrorsFormat,
    MetadataSchema,
    Metadata,
    true,
    Ctx,
    InputSchemaFn,
    InputSchema,
    undefined,
    BindArgsSchemas,
    ShapedErrors,
    ThrowsValidationErrors,
    false,
    PreValidationCtx
  >,
  options: EffectActionBoundaryOptions<Ctx, Metadata>
): EffectActionBoundary<
  ServerError,
  ErrorsFormat,
  Metadata,
  Ctx,
  ThrowsValidationErrors
> {
  const action = (<S extends StandardSchemaV1, A, E, R, LE>(
    declaration: EffectBoundaryOptions & {
      readonly schema: S;
      readonly layer?: Layer.Layer<R, LE, never>;
    },
    handler: (
      args: EffectActionArgs<S, Ctx, Metadata>
    ) => Effect.Effect<A, E, R>
  ) => {
    const builder = actionClient.inputSchema(declaration.schema);

    return builder.action((args) => {
      const effect = provideBoundaryLayer(
        Effect.suspend(() => handler(args)),
        declaration.layer
      );
      const prepared = options
        .prepare({ operation: declaration.operation, args }, effect)
        .pipe(
          Effect.annotateLogs({
            boundary: "action",
            operation: declaration.operation,
          })
        );

      return execute(prepared, { runExit: options.runExit });
    });
  }) as unknown as EffectActionBoundary<
    ServerError,
    ErrorsFormat,
    Metadata,
    Ctx,
    ThrowsValidationErrors
  >["action"];

  return { action };
}

function getExecuteOptions(
  options: EffectActionBaseOptions & EffectActionExecutorOptions
) {
  return options.runExit
    ? { mapError: options.mapError, runExit: options.runExit }
    : { mapError: options.mapError, run: options.run };
}

function assertExecutorOptions(options: {
  readonly run?: ExecuteRun;
  readonly runExit?: EffectRunExit;
}) {
  if (process.env.NODE_ENV !== "production" && options.run && options.runExit) {
    throw new TypeError("EffectAction cannot combine runExit with run");
  }
}

export const EffectAction = {
  fromClient,
  makeBoundary,
};
