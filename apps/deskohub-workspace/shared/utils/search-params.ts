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

/**
 * Search params in the shape Next.js passes to a page, so a route handler can
 * share a page's parser: a repeated key becomes an array.
 */
export const getSearchParamsRecord = (
  searchParams: URLSearchParams
): SearchParamsRecord =>
  Object.fromEntries(
    [...new Set(searchParams.keys())].map((key) => {
      const values = searchParams.getAll(key);
      return [key, values.length === 1 ? values[0] : values];
    })
  );

/** The record as query parameters, keeping every value of a repeated key. */
export const toURLSearchParams = (
  searchParams: SearchParamsRecord
): URLSearchParams =>
  new URLSearchParams(
    Object.entries(searchParams).flatMap(([key, value]) =>
      [value ?? []].flat().map((item) => [key, item])
    )
  );
