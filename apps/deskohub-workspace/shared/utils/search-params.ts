import { Schema } from "effect";

export type SearchParamsRecord = Record<string, string | string[] | undefined>;
export type SupportedSearchParams = URLSearchParams | SearchParamsRecord;

/** Query values by name; an absent or empty value stays out of an href. */
export type SearchParamValues = Readonly<Record<string, string | undefined>>;

/**
 * How a decoder reads a key the URL repeats: by its first value, or as if
 * the key were absent.
 */
export type RepeatedSearchParams = "first" | "absent";

const normalizeSearchParamsRecord = (
  searchParams: SearchParamsRecord,
  repeated: RepeatedSearchParams
) =>
  Object.fromEntries(
    Object.entries(searchParams).flatMap(([key, value]) => {
      if (!Array.isArray(value)) return [[key, value]];
      return repeated === "first" ? [[key, value[0]]] : [];
    })
  );

export const getSearchParamsDecoder = <A>(
  outputSchema: Schema.Decoder<A>,
  { repeated = "first" }: { readonly repeated?: RepeatedSearchParams } = {}
) => {
  const decodeUnknown = Schema.decodeUnknownOption(outputSchema);
  return (searchParams: SearchParamsRecord) =>
    decodeUnknown(normalizeSearchParamsRecord(searchParams, repeated));
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

/** The path with the given query values, leaving out empty ones. */
export const getHrefWithSearchParams = <Path extends string>(
  path: Path,
  values: SearchParamValues
): Path | `${Path}?${string}` => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value) search.set(key, value);
  }
  const query = search.toString();
  return query ? `${path}?${query}` : path;
};
