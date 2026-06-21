import { Schema } from "effect";
import { locales } from "../routing";

const LocaleRouteParamSchema = Schema.Literals(locales);

type ParamsDecoderFields<Fields extends Schema.Struct.Fields> = {
  readonly locale: typeof LocaleRouteParamSchema;
} & Fields;

type ParamsDecoderSchema<Fields extends Schema.Struct.Fields> = Schema.Codec<
  Schema.Struct.Type<ParamsDecoderFields<Fields>>,
  Schema.Struct.Encoded<ParamsDecoderFields<Fields>>
>;

export const getParamsDecoder = <
  Fields extends Schema.Struct.Fields & {
    readonly [Key in keyof Fields]: Schema.Top;
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
