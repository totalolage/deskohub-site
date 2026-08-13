import { Schema, type SchemaAST } from "effect";

export const makeSchemaParser = <A>(
  schema: Schema.Decoder<A>,
  options?: SchemaAST.ParseOptions
) => {
  const parse = Schema.decodeUnknownSync(schema, options);
  const safeParse = Schema.decodeUnknownResult(schema, options);

  return {
    parse,
    safeParse,
  };
};
