import Constants from "expo-constants";
import { createHttpShopApi } from "./http-shop-api";
import { type ShopApi, ShopApiError } from "./shop-api";

function createUnavailableShopApi(): ShopApi {
  const unavailable = async (): Promise<never> => {
    throw new ShopApiError("Mobile shop API is not configured", "unavailable");
  };
  return {
    getSession: unavailable,
    prepareSignInHandoff: unavailable,
    completeSignInHandoff: unavailable,
    signOut: unavailable,
    getEntitlement: unavailable,
    getCatalog: unavailable,
    quoteCart: unavailable,
    createHostedPayment: unavailable,
    reconcilePayment: unavailable,
    listPurchases: unavailable,
    getPurchase: unavailable,
  };
}

export function selectShopApi(): ShopApi {
  const extra = (Constants.expoConfig?.extra ?? {}) as {
    apiOrigin?: string;
  };

  const baseUrl = extra.apiOrigin?.trim();
  return baseUrl ? createHttpShopApi(baseUrl) : createUnavailableShopApi();
}

export type { ShopApi } from "./shop-api";
export { ShopApiError } from "./shop-api";
