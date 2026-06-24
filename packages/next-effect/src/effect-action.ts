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
import { execute, type ExecuteRun } from "./internal/executor";

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

type SafeActionValidationErrors<
  ErrorsFormat extends ValidationErrorsFormat | undefined,
  S extends StandardSchemaV1,
> = ErrorsFormat extends "flattened"
  ? FlattenedValidationErrors<ValidationErrors<S>>
  : ValidationErrors<S>;

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
      execute(Effect.provide(effect, options.layer), {
        mapError: options.mapError,
        run: options.run,
      })
    );
  }

  return makeEffectActionClient(
    actionClient,
    <A, E>(effect: Effect.Effect<A, E, never>) =>
      execute(effect, {
        mapError: options.mapError,
        run: options.run,
      })
  );
}

export const EffectAction = {
  fromClient,
};
