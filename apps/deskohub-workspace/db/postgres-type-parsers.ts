import { type CustomTypesConfig, types } from "pg";

export const drizzleRawTypeOids = [
  1082, // date
  1114, // timestamp
  1115, // timestamp[]
  1182, // date[]
  1184, // timestamptz
  1185, // timestamptz[]
  1186, // interval
  1187, // interval[]
  1231, // numeric[]
] as const;

const drizzleRawTypeOidSet = new Set<number>(drizzleRawTypeOids);
const parseRawValue = (value: string) => value;

export const drizzleRawTypeParsers: CustomTypesConfig = {
  getTypeParser: (oid, format) =>
    format !== "binary" && drizzleRawTypeOidSet.has(oid)
      ? parseRawValue
      : types.getTypeParser(oid, format),
};
