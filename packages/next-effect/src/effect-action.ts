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
  SafeActionResult,
  SafeStateActionFn,
  ValidationErrors,
  ValidationErrorsFormat,
} from "next-safe-action";
import type { EffectBoundaryOptions, EffectRunExit } from "./effect-boundary";
import { provideBoundaryLayer } from "./internal/boundary";
import {
  type ExecuteOptions,
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
  readonly run?: ExecuteRun;
}

interface EffectActionRunnableOptions extends EffectActionBaseOptions {
  readonly layer?: undefined;
}

interface EffectActionLayerOptions<R, LE> extends EffectActionBaseOptions {
  readonly layer: Layer.Layer<R, LE, never>;
}

export type EffectActionOptions<R = never, LE = never> =
  | EffectActionRunnableOptions
  | EffectActionLayerOptions<R, LE>;

const getExecuteOptions = <E>(
  options: EffectActionBaseOptions
): ExecuteOptions<E> =>
  options.run
    ? { mapError: options.mapError, run: options.run }
    : { mapError: options.mapError };

type SafeActionValidationErrors<
  ErrorsFormat extends ValidationErrorsFormat | undefined,
  S extends StandardSchemaV1,
> = ErrorsFormat extends "flattened"
  ? FlattenedValidationErrors<ValidationErrors<S>>
  : ValidationErrors<S>;

export interface EffectActionState<ServerError, S extends StandardSchemaV1> {
  readonly prevResult: SafeActionResult<ServerError, S, unknown, unknown>;
}

type EffectActionBoundaryLayerOptions<R, LE> = [R] extends [never]
  ? { readonly layer?: never }
  : { readonly layer: Layer.Layer<R, LE, never> };

export interface EffectActionBoundary<
  ServerError,
  ErrorsFormat extends ValidationErrorsFormat | undefined,
  Metadata,
  Ctx extends object,
  ThrowsValidationErrors extends boolean = false,
> {
  readonly action: {
    <S extends StandardSchemaV1, A, E, R = never, LE = never>(
      options: EffectBoundaryOptions & {
        readonly schema: S;
        readonly stateful: true;
      } & EffectActionBoundaryLayerOptions<R, LE>,
      handler: (
        args: EffectActionArgs<S, Ctx, Metadata>,
        state: EffectActionState<ServerError, S>
      ) => Effect.Effect<A, E, R>
    ): MaybeBrandThrows<
      SafeStateActionFn<
        ServerError,
        S,
        readonly [],
        SafeActionValidationErrors<ErrorsFormat, S>,
        A
      >,
      ThrowsValidationErrors
    >;
    <S extends StandardSchemaV1, A, E, R = never, LE = never>(
      options: EffectBoundaryOptions & {
        readonly schema: S;
        readonly stateful?: false;
      } & EffectActionBoundaryLayerOptions<R, LE>,
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
            (args) => runEffect(handler(args)),
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

type StatefulBoundaryActionInvocation<
  ServerError,
  S extends StandardSchemaV1,
  Metadata,
  Ctx extends object,
  A,
  E,
  R,
  LE,
> = readonly [
  declaration: EffectBoundaryOptions & {
    readonly schema: S;
    readonly stateful: true;
  } & EffectActionBoundaryLayerOptions<R, LE>,
  handler: (
    args: EffectActionArgs<S, Ctx, Metadata>,
    state: EffectActionState<ServerError, S>
  ) => Effect.Effect<A, E, R>,
];

type StatelessBoundaryActionInvocation<
  S extends StandardSchemaV1,
  Metadata,
  Ctx extends object,
  A,
  E,
  R,
  LE,
> = readonly [
  declaration: EffectBoundaryOptions & {
    readonly schema: S;
    readonly stateful?: false;
  } & EffectActionBoundaryLayerOptions<R, LE>,
  handler: (args: EffectActionArgs<S, Ctx, Metadata>) => Effect.Effect<A, E, R>,
];

const isStatefulBoundaryActionInvocation = <
  ServerError,
  S extends StandardSchemaV1,
  Metadata,
  Ctx extends object,
  A,
  E,
  R,
  LE,
>(
  invocation:
    | StatefulBoundaryActionInvocation<
        ServerError,
        S,
        Metadata,
        Ctx,
        A,
        E,
        R,
        LE
      >
    | StatelessBoundaryActionInvocation<S, Metadata, Ctx, A, E, R, LE>
): invocation is StatefulBoundaryActionInvocation<
  ServerError,
  S,
  Metadata,
  Ctx,
  A,
  E,
  R,
  LE
> => invocation[0].stateful === true;

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
  const executeHandler = <S extends StandardSchemaV1, A, E, R, LE>(
    declaration: EffectBoundaryOptions & {
      readonly layer?: Layer.Layer<R, LE, never>;
    },
    args: EffectActionArgs<S, Ctx, Metadata>,
    handler: () => Effect.Effect<A, E, R>
  ) => {
    const effect = provideBoundaryLayer(
      Effect.suspend(handler),
      declaration.layer
    );
    const prepared = Effect.suspend(() =>
      options.prepare({ operation: declaration.operation, args }, effect)
    ).pipe(
      Effect.annotateLogs({
        boundary: "action",
        operation: declaration.operation,
      })
    );

    return execute(prepared, { runExit: options.runExit });
  };

  function action<S extends StandardSchemaV1, A, E, R = never, LE = never>(
    declaration: EffectBoundaryOptions & {
      readonly schema: S;
      readonly stateful: true;
    } & EffectActionBoundaryLayerOptions<R, LE>,
    handler: (
      args: EffectActionArgs<S, Ctx, Metadata>,
      state: EffectActionState<ServerError, S>
    ) => Effect.Effect<A, E, R>
  ): MaybeBrandThrows<
    SafeStateActionFn<
      ServerError,
      S,
      readonly [],
      SafeActionValidationErrors<ErrorsFormat, S>,
      A
    >,
    ThrowsValidationErrors
  >;
  function action<S extends StandardSchemaV1, A, E, R = never, LE = never>(
    declaration: EffectBoundaryOptions & {
      readonly schema: S;
      readonly stateful?: false;
    } & EffectActionBoundaryLayerOptions<R, LE>,
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
  function action<S extends StandardSchemaV1, A, E, R, LE>(
    ...invocation:
      | StatefulBoundaryActionInvocation<
          ServerError,
          S,
          Metadata,
          Ctx,
          A,
          E,
          R,
          LE
        >
      | StatelessBoundaryActionInvocation<S, Metadata, Ctx, A, E, R, LE>
  ) {
    if (isStatefulBoundaryActionInvocation(invocation)) {
      const [declaration, handler] = invocation;
      const builder = actionClient.inputSchema(declaration.schema);

      return builder.stateAction((args, state) =>
        executeHandler(declaration, args, () => handler(args, state))
      );
    }

    const [declaration, handler] = invocation;
    const builder = actionClient.inputSchema(declaration.schema);

    return builder.action((args) =>
      executeHandler(declaration, args, () => handler(args))
    );
  }

  return { action };
}

export const EffectAction = {
  fromClient,
  makeBoundary,
};
