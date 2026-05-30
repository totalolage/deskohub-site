type NextSearchParams = Record<string, string | string[] | undefined>;
type SupportedSearchParams = URLSearchParams | NextSearchParams;

export const checkoutReturnStateTokenQueryParam = "checkoutToken";

const checkoutReturnStateTokenPattern = /^[A-Za-z0-9_-]{43}$/;

const getSearchParam = (
  searchParams: SupportedSearchParams,
  key: string
): string | undefined => {
  if (searchParams instanceof URLSearchParams) {
    return searchParams.get(key) ?? undefined;
  }

  const value = searchParams[key];
  return Array.isArray(value) ? value[0] : value;
};

export const parseCheckoutReturnStateToken = (
  value: string | undefined
): string | undefined => {
  const token = value?.trim();
  if (!token) return undefined;
  if (!checkoutReturnStateTokenPattern.test(token)) return undefined;

  return token;
};

export const getCheckoutReturnStateTokenFromSearchParams = (
  searchParams: SupportedSearchParams
) =>
  parseCheckoutReturnStateToken(
    getSearchParam(searchParams, checkoutReturnStateTokenQueryParam)
  );

export const appendCheckoutReturnStateToken = (url: URL, token: string) => {
  const parsedToken = parseCheckoutReturnStateToken(token);
  if (!parsedToken) {
    throw new Error("Invalid checkout return-state token");
  }

  url.searchParams.set(checkoutReturnStateTokenQueryParam, parsedToken);
};

export const appendExistingCheckoutReturnStateToken = (
  url: URL,
  searchParams: SupportedSearchParams
) => {
  const token = getCheckoutReturnStateTokenFromSearchParams(searchParams);
  if (token) {
    url.searchParams.set(checkoutReturnStateTokenQueryParam, token);
  }
};
