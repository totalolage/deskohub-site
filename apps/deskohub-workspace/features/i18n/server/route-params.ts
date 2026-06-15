import { Schema } from "effect";
import { locales } from "../routing";

const LocaleRouteParamSchema = Schema.Literal(...locales);

type ParamsDecoderFields<Fields extends Schema.Struct.Fields> = {
  readonly locale: typeof LocaleRouteParamSchema;
} & Fields;

type ParamsDecoderSchema<Fields extends Schema.Struct.Fields> = Schema.Schema<
  Schema.Struct.Type<ParamsDecoderFields<Fields>>,
  Schema.Struct.Encoded<ParamsDecoderFields<Fields>>,
  never
>;

export const getParamsDecoder = <
  Fields extends Schema.Struct.Fields & {
    readonly [Key in keyof Fields]: Schema.Schema.AnyNoContext;
  },
>(
  fields: Fields
) =>
  Schema.decodeUnknownOption(
    Schema.Struct({
      locale: LocaleRouteParamSchema,
      ...fields,
    }) as unknown as ParamsDecoderSchema<Fields>
  );
