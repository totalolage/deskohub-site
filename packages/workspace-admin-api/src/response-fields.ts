import { Effect, Schema } from "effect";

/**
 * Response fields a newer `dhw` must still decode from an older server, which
 * omits fields it doesn't know yet. Each helper names the value an absent key
 * decodes to.
 */
export const fieldWithDefault = <S extends Schema.Top>(
  schema: S,
  value: S["Type"]
) => schema.pipe(Schema.withDecodingDefaultTypeKey(Effect.succeed(value)));

/** A nullable response field; absent decodes as null. */
export const nullableField = <S extends Schema.Top>(schema: S) =>
  Schema.NullOr(schema).pipe(
    Schema.withDecodingDefaultTypeKey(Effect.succeed(null))
  );

/** A list response field; absent decodes as empty. */
export const listField = <S extends Schema.Top>(schema: S) =>
  Schema.Array(schema).pipe(
    Schema.withDecodingDefaultTypeKey(
      Effect.succeed([] as ReadonlyArray<S["Type"]>)
    )
  );
