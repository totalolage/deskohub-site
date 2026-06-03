import { Option, Schema } from "effect";
import { getSearchParam, type SupportedSearchParams } from "@/shared/utils";

export const checkoutReturnStateTokenQueryParam = "checkoutToken";

const checkoutReturnStateTokenPattern = /^[A-Za-z0-9_-]{43}$/;

export const CheckoutReturnStateTokenSchema = Schema.transform(
  Schema.String,
  Schema.String.pipe(
    Schema.pattern(checkoutReturnStateTokenPattern, {
      description:
        "Checkout return-state token must be 43 URL-safe base64 characters.",
    })
  ),
  {
    strict: true,
    decode: (token) => token.trim(),
    encode: (token) => token,
  }
).annotations({
  identifier: "CheckoutReturnStateToken",
  description: "URL-safe checkout return-state token query parameter.",
});

export const parseCheckoutReturnStateToken = (
  value: string | undefined
): string | undefined => {
  const decodedToken = Schema.decodeUnknownOption(
    CheckoutReturnStateTokenSchema
  )(value);
  return Option.getOrUndefined(decodedToken);
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
