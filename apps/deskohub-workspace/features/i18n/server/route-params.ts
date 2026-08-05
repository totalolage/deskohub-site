import { Schema } from "effect";
import { locales } from "../routing";

const LocaleRouteParamSchema = Schema.Literals(locales);

export const getLocalizedParamsDecoder = <
  const Fields extends {
    readonly [Key in keyof Fields]: Schema.Decoder<unknown>;
  },
>(
  fields: Fields
) =>
  Schema.decodeUnknownOption(
    Schema.Struct({
      locale: LocaleRouteParamSchema,
      ...fields,
    })
  );
