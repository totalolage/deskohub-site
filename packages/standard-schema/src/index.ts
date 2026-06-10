import type { StandardSchemaV1 } from "@standard-schema/spec";

type SchemaOutput<S extends StandardSchemaV1> = StandardSchemaV1.InferOutput<S>;

const isPromiseLike = <T>(value: T | Promise<T>): value is Promise<T> =>
  typeof (value as Promise<T>).then === "function";

const getSchemaValidationResult = <S extends StandardSchemaV1>(
  schema: S,
  value: unknown
): StandardSchemaV1.Result<SchemaOutput<S>> => {
  const result = schema["~standard"].validate(value) as
    | StandardSchemaV1.Result<SchemaOutput<S>>
    | Promise<StandardSchemaV1.Result<SchemaOutput<S>>>;

  if (isPromiseLike(result)) {
    throw new Error("Async Standard Schema validation is not supported here");
  }

  return result;
};

export const decodeStandardSchema = <S extends StandardSchemaV1>(
  schema: S,
  value: unknown
): SchemaOutput<S> | undefined => {
  const result = getSchemaValidationResult(schema, value);
  return result.issues ? undefined : result.value;
};

export const parseStandardSchema = <S extends StandardSchemaV1>(
  schema: S,
  value: unknown,
  invalidMessage: string
): SchemaOutput<S> => {
  const result = getSchemaValidationResult(schema, value);

  if (result.issues) {
    throw new Error(invalidMessage);
  }

  return result.value;
};
