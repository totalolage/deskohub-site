import { Schema, type SchemaAST } from "effect";

export type SchemaSafeParseResult<A> =
  | {
      readonly success: true;
      readonly data: A;
    }
  | {
      readonly success: false;
      readonly error: unknown;
    };

export const makeEffectSchemaParser = <A>(
  schema: Schema.Decoder<A>,
  options?: SchemaAST.ParseOptions
) => {
  const parse: (input: unknown) => A = Schema.decodeUnknownSync(
    schema,
    options
  );

  return {
    parse,
    safeParse: (input: unknown): SchemaSafeParseResult<A> => {
      try {
        return { success: true, data: parse(input) };
      } catch (error) {
        return { success: false, error };
      }
    },
  };
};
