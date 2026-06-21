import { getSearchParam, type SupportedSearchParams } from "@/shared/utils";

export const checkoutReturnStateTokenQueryParam = "checkoutToken";

const checkoutReturnStateTokenPattern = /^[A-Za-z0-9_-]{43}$/;

export const parseCheckoutReturnStateToken = (
  value: string | undefined
): string | undefined => {
  const token = value?.trim();
  return token && checkoutReturnStateTokenPattern.test(token)
    ? token
    : undefined;
};

export const getCheckoutReturnStateTokenFromSearchParams = (
  searchParams: SupportedSearchParams
) =>
  parseCheckoutReturnStateToken(
    getSearchParam(searchParams, checkoutReturnStateTokenQueryParam)
  );

export const appendExistingCheckoutReturnStateToken = (
  url: URL,
  searchParams: SupportedSearchParams
) => {
  const token = getCheckoutReturnStateTokenFromSearchParams(searchParams);
  if (token) url.searchParams.set(checkoutReturnStateTokenQueryParam, token);
};
