import { createFixtureShopApi } from "./fixture-shop-api";
import { createHttpShopApi } from "./http-shop-api";
import { type ShopApi, ShopApiError, type ShopApiRuntime } from "./shop-api";

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

export function selectShopApi(): ShopApiRuntime {
  const extra = (Constants.expoConfig?.extra ?? {}) as {
    apiOrigin?: string;
    shopApiMode?: "demo" | "live";
  };
  if (extra.shopApiMode === "demo") {
    return { api: createFixtureShopApi(), mode: "demo" };
  }

  const baseUrl = extra.apiOrigin?.trim();
  if (baseUrl) return { api: createHttpShopApi(baseUrl), mode: "live" };
  return { api: createUnavailableShopApi(), mode: "unavailable" };
}

export type { ShopApi, ShopApiRuntime } from "./shop-api";
export { ShopApiError } from "./shop-api";

import Constants from "expo-constants";
