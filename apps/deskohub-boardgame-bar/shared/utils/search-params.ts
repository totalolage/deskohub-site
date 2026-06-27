export type SearchParamsRecord = Record<string, string | string[] | undefined>;
export type SupportedSearchParams = URLSearchParams | SearchParamsRecord;

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
