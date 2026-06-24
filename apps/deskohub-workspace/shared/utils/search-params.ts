import { Schema } from "effect";

export type SearchParamsRecord = Record<string, string | string[] | undefined>;
export type SupportedSearchParams = URLSearchParams | SearchParamsRecord;

const normalizeSearchParamsRecord = (searchParams: SearchParamsRecord) =>
  Object.fromEntries(
    Object.entries(searchParams).map(([key, value]) => [
      key,
      Array.isArray(value) ? value[0] : value,
    ])
  );

export const getSearchParamsDecoder = <A, I>(
  outputSchema: Schema.Codec<A, I>
) => {
  const decodeUnknown = Schema.decodeUnknownOption(outputSchema);
  return (searchParams: SearchParamsRecord) =>
    decodeUnknown(normalizeSearchParamsRecord(searchParams));
};

export const getSearchParam = (
  searchParams: SupportedSearchParams,
  key: string
): string | undefined => {
  if (searchParams instanceof URLSearchParams) {
    return searchParams.get(key) ?? undefined;
  }

  const value = searchParams[key];
  return Array.isArray(value) ? value[0] : value;
};
