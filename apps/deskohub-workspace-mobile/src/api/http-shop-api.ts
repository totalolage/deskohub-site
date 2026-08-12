import * as Crypto from "expo-crypto";
import {
  clearNativeSession,
  exchangeSignInHandoff,
  getNativeSessionCookie,
  prepareSignInHandoff,
} from "@/src/auth/native-session";
import type {
  Catalog,
  CheckoutQuote,
  Locale,
  LocalizedText,
  Money,
  Product,
  Purchase,
  PurchaseStatus,
  Seller,
  ShopEntitlement,
  ShopSession,
  TaxTreatment,
} from "@/src/domain/shop";
import { buildMobileApiUrl } from "./mobile-api-url";
import { type ShopApi, ShopApiError } from "./shop-api";

type RequestOptions = Readonly<{
  method?: "GET" | "POST";
  body?: unknown;
  mutationHeader?: Readonly<{ name: string; value: string }>;
}>;

type ApiEnvelope =
  | Readonly<{ ok: true; data: unknown }>
  | Readonly<{ ok: false; error: { code: string } }>;

type ApiMoney = Readonly<{ value: number; exponent: number; currency: string }>;
type ApiTax =
  | Readonly<{ kind: "not-applicable" }>
  | Readonly<{
      kind: "vat";
      rateBasisPoints: number;
      taxAmount: ApiMoney;
    }>;
type ApiTaxRegime =
  | Readonly<{ kind: "not-vat-payer" }>
  | Readonly<{ kind: "vat-payer"; vatId: string }>;

type ApiAccount = Readonly<{
  authenticated: true;
  webMutation: { headerName: string; headerValue: string };
  entitlement:
    | { kind: "eligible"; day: string; validUntil: string }
    | { kind: "locked"; reason: string };
}>;

type ApiCatalog = Readonly<{
  generatedAt: string;
  categories: readonly { id: string; name: string; color?: string }[];
  products: readonly {
    id: string;
    categoryId: string;
    name: string;
    description?: string;
    unitLabel?: string;
    imageUrl?: string;
    price: ApiMoney;
  }[];
}>;

type ApiQuote = Readonly<{
  fingerprint: string;
  expiresAt: string;
  taxRegime: ApiTaxRegime;
  items: readonly {
    productId: string;
    displayName: string;
    quantity: number;
    unitPrice: ApiMoney;
    lineTotal: ApiMoney;
    tax: ApiTax;
  }[];
  total: ApiMoney;
}>;

type ApiOrder = Readonly<{
  id: string;
  publicReference: string;
  createdAt: string;
  paymentState:
    | "not_started"
    | "pending"
    | "paid"
    | "failed"
    | "cancelled"
    | "expired";
  receiptState: "not_started" | "processing" | "sent" | "failed";
  taxRegime: ApiTaxRegime;
  total: ApiMoney;
  items: readonly {
    productId: string;
    displayName: string;
    quantity: number;
    unitPrice: ApiMoney;
    lineTotal: ApiMoney;
    tax: ApiTax;
  }[];
}>;

type ApiPaymentSession = Readonly<{ orderId: string; hostedPageUrl: string }>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalidResponse(): never {
  throw new ShopApiError(
    "The shop returned an invalid response",
    "invalid_response"
  );
}

function localized(value: string): LocalizedText {
  return { cs: value, en: value };
}

function mapMoney(value: ApiMoney): Money {
  if (
    value.currency !== "CZK" ||
    !Number.isSafeInteger(value.value) ||
    !Number.isSafeInteger(value.exponent) ||
    value.exponent < 0
  ) {
    return invalidResponse();
  }
  const minorUnits = value.value * 10 ** (2 - value.exponent);
  if (!Number.isSafeInteger(minorUnits)) return invalidResponse();
  return { currency: "CZK", minorUnits };
}

function mapTaxTreatment(
  taxRegime: ApiTaxRegime | null,
  taxes: readonly ApiTax[]
): TaxTreatment {
  if (!taxRegime || taxRegime.kind === "not-vat-payer")
    return { kind: "not_vat_payer" };
  const vatTaxes = taxes.filter(
    (tax): tax is Extract<ApiTax, { kind: "vat" }> => tax.kind === "vat"
  );
  return {
    kind: "vat_included",
    rateBasisPoints: vatTaxes[0]?.rateBasisPoints ?? 0,
    taxMinorUnits: vatTaxes.reduce(
      (total, tax) => total + mapMoney(tax.taxAmount).minorUnits,
      0
    ),
  };
}

function mapSeller(
  taxRegime: ApiTaxRegime | null,
  taxes: readonly ApiTax[]
): Seller {
  return {
    legalName: "Desktechub s.r.o.",
    identificationNumber: "24531596",
    ...(taxRegime?.kind === "vat-payer" && { vatId: taxRegime.vatId }),
    taxTreatment: mapTaxTreatment(taxRegime, taxes),
  };
}

function productColor(index: number): Product["color"] {
  return (["aqua", "orange", "yellow", "navy"] as const)[index % 4] ?? "navy";
}

function mapCatalog(value: ApiCatalog): Catalog {
  if (!Array.isArray(value.categories) || !Array.isArray(value.products))
    return invalidResponse();
  return {
    refreshedAt: value.generatedAt,
    categories: value.categories.map((category) => ({
      id: category.id,
      name: localized(category.name),
    })),
    products: value.products.map((product, index) => ({
      id: product.id,
      categoryId: product.categoryId,
      name: localized(product.name),
      description: localized(
        [product.description, product.unitLabel].filter(Boolean).join(" · ")
      ),
      ...(product.imageUrl ? { imageUrl: product.imageUrl } : {}),
      price: mapMoney(product.price),
      color: productColor(index),
      initials: product.name.trim().slice(0, 2).toLocaleUpperCase() || "DW",
    })),
  };
}

function mapQuote(value: ApiQuote): CheckoutQuote {
  if (!Array.isArray(value.items)) return invalidResponse();
  return {
    id: value.fingerprint,
    expiresAt: value.expiresAt,
    lines: value.items.map((item) => ({
      productId: item.productId,
      name: localized(item.displayName),
      quantity: item.quantity,
      unitPrice: mapMoney(item.unitPrice),
      lineTotal: mapMoney(item.lineTotal),
    })),
    total: mapMoney(value.total),
    seller: mapSeller(
      value.taxRegime,
      value.items.map((item) => item.tax)
    ),
  };
}

function mapPaymentState(value: ApiOrder["paymentState"]): PurchaseStatus {
  if (value === "pending") return "payment_pending";
  return value;
}

function mapOrder(value: ApiOrder): Purchase {
  if (!Array.isArray(value.items)) return invalidResponse();
  return {
    id: value.id,
    publicReference: value.publicReference,
    createdAt: value.createdAt,
    status: mapPaymentState(value.paymentState),
    receiptStatus: value.receiptState,
    total: mapMoney(value.total),
    lines: value.items.map((item) => ({
      productId: item.productId,
      name: { cs: item.displayName, en: item.displayName },
      quantity: item.quantity,
      unitPrice: mapMoney(item.unitPrice),
      lineTotal: mapMoney(item.lineTotal),
    })),
    seller: mapSeller(
      value.taxRegime,
      value.items.map((item) => item.tax)
    ),
  };
}

function mapEntitlement(account: ApiAccount): ShopEntitlement {
  if (account.entitlement.kind === "eligible") {
    return {
      kind: "eligible",
      localDate: account.entitlement.day,
      expiresAt: account.entitlement.validUntil,
    };
  }
  return { kind: "locked", nextReservationStartsAt: null };
}

function errorKindForCode(code: string): ShopApiError["kind"] {
  if (code === "unauthorized") return "unauthorized";
  if (code === "service_unavailable" || code === "catalog_unavailable")
    return "unavailable";
  return "unknown";
}

async function requestEnvelope<T>(
  baseUrl: string,
  path: string,
  options: RequestOptions = {}
): Promise<T> {
  let response: Response;
  try {
    const headers: Record<string, string> = { accept: "application/json" };
    if (options.body) headers["content-type"] = "application/json";
    if (options.mutationHeader)
      headers[options.mutationHeader.name] = options.mutationHeader.value;
    const nativeSession = await getNativeSessionCookie();
    if (nativeSession) headers.Cookie = nativeSession;
    response = await fetch(buildMobileApiUrl(baseUrl, path), {
      method: options.method ?? "GET",
      credentials: "include",
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
  } catch {
    throw new ShopApiError("Network request failed", "offline");
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return invalidResponse();
  }
  if (!isRecord(payload) || typeof payload.ok !== "boolean")
    return invalidResponse();
  const envelope = payload as ApiEnvelope;
  if (!envelope.ok) {
    const code =
      isRecord(envelope.error) && typeof envelope.error.code === "string"
        ? envelope.error.code
        : "service_unavailable";
    throw new ShopApiError(code, errorKindForCode(code), response.status);
  }
  return envelope.data as T;
}

async function requestAuthSignOut(baseUrl: string): Promise<void> {
  let response: Response;
  try {
    const nativeSession = await getNativeSessionCookie();
    response = await fetch(buildMobileApiUrl(baseUrl, "/api/auth/sign-out"), {
      method: "POST",
      credentials: "include",
      headers: {
        "content-type": "application/json",
        ...(nativeSession ? { Cookie: nativeSession } : {}),
      },
      body: "{}",
    });
  } catch {
    throw new ShopApiError("Network request failed", "offline");
  }
  if (!response.ok)
    throw new ShopApiError("Sign out failed", "unknown", response.status);
}

const apiLocale = (locale: Locale) => (locale === "cs" ? "cs-CZ" : "en-US");

export function createHttpShopApi(baseUrl: string): ShopApi {
  const normalizedBaseUrl = baseUrl.trim();
  let account: ApiAccount | null = null;
  let checkoutAttempt:
    | { readonly requestKey: string; readonly id: string }
    | undefined;

  const loadAccount = async () => {
    const nextAccount = await requestEnvelope<ApiAccount>(
      normalizedBaseUrl,
      "/api/v1/mobile/account"
    );
    if (nextAccount.authenticated !== true || !nextAccount.webMutation)
      return invalidResponse();
    account = nextAccount;
    return nextAccount;
  };

  const mutationHeader = async () => {
    const current = account ?? (await loadAccount());
    return {
      name: current.webMutation.headerName,
      value: current.webMutation.headerValue,
    };
  };

  return {
    async getSession(): Promise<ShopSession> {
      try {
        await loadAccount();
        return {
          kind: "signed_in",
          customer: { email: null, displayName: null },
        };
      } catch (error) {
        if (error instanceof ShopApiError && error.kind === "unauthorized")
          return { kind: "signed_out" };
        throw error;
      }
    },
    prepareSignInHandoff(locale) {
      return prepareSignInHandoff(normalizedBaseUrl, locale);
    },
    async completeSignInHandoff(callbackUrl): Promise<ShopSession> {
      if (callbackUrl)
        await exchangeSignInHandoff(normalizedBaseUrl, callbackUrl);
      try {
        await loadAccount();
        return {
          kind: "signed_in",
          customer: { email: null, displayName: null },
        };
      } catch (error) {
        if (error instanceof ShopApiError && error.kind === "unauthorized")
          return { kind: "signed_out" };
        throw error;
      }
    },
    async signOut() {
      try {
        await requestAuthSignOut(normalizedBaseUrl);
      } finally {
        await clearNativeSession();
        account = null;
      }
    },
    async getEntitlement() {
      return mapEntitlement(account ?? (await loadAccount()));
    },
    async getCatalog(locale) {
      const value = await requestEnvelope<ApiCatalog>(
        normalizedBaseUrl,
        `/api/v1/mobile/catalog?locale=${encodeURIComponent(apiLocale(locale))}`
      );
      return mapCatalog(value);
    },
    async quoteCart(lines, locale) {
      const value = await requestEnvelope<ApiQuote>(
        normalizedBaseUrl,
        "/api/v1/mobile/quotes",
        {
          method: "POST",
          mutationHeader: await mutationHeader(),
          body: { locale: apiLocale(locale), cart: lines },
        }
      );
      return mapQuote(value);
    },
    async createHostedPayment(quote, lines, locale) {
      const header = await mutationHeader();
      const requestKey = JSON.stringify([
        quote.id,
        quote.expiresAt,
        locale,
        lines,
      ]);
      if (checkoutAttempt?.requestKey !== requestKey) {
        checkoutAttempt = { requestKey, id: Crypto.randomUUID() };
      }
      const order = await requestEnvelope<ApiOrder>(
        normalizedBaseUrl,
        "/api/v1/mobile/orders",
        {
          method: "POST",
          mutationHeader: header,
          body: {
            checkoutAttemptId: checkoutAttempt.id,
            quoteFingerprint: quote.id,
            quoteExpiresAt: quote.expiresAt,
            locale: apiLocale(locale),
            cart: lines,
          },
        }
      );
      const payment = await requestEnvelope<ApiPaymentSession>(
        normalizedBaseUrl,
        `/api/v1/mobile/orders/${encodeURIComponent(order.id)}/payment`,
        { method: "POST", mutationHeader: header }
      );
      return {
        orderId: payment.orderId,
        hostedPaymentUrl: payment.hostedPageUrl,
      };
    },
    async reconcilePayment(orderId) {
      const order = await requestEnvelope<ApiOrder>(
        normalizedBaseUrl,
        `/api/v1/mobile/orders/${encodeURIComponent(orderId)}`
      );
      return mapOrder(order);
    },
    async listPurchases() {
      const purchases: Purchase[] = [];
      const seenCursors = new Set<string>();
      let cursor: string | undefined;
      do {
        const path = cursor
          ? `/api/v1/mobile/orders?cursor=${encodeURIComponent(cursor)}`
          : "/api/v1/mobile/orders";
        const history = await requestEnvelope<{
          orders: readonly ApiOrder[];
          nextCursor?: string;
        }>(normalizedBaseUrl, path);
        if (!Array.isArray(history.orders)) return invalidResponse();
        purchases.push(...history.orders.map(mapOrder));
        const nextCursor = history.nextCursor;
        if (nextCursor === undefined) break;
        if (
          typeof nextCursor !== "string" ||
          nextCursor.length === 0 ||
          seenCursors.has(nextCursor)
        ) {
          return invalidResponse();
        }
        seenCursors.add(nextCursor);
        cursor = nextCursor;
      } while (cursor);
      return purchases;
    },
    async getPurchase(orderId) {
      const order = await requestEnvelope<ApiOrder>(
        normalizedBaseUrl,
        `/api/v1/mobile/orders/${encodeURIComponent(orderId)}`
      );
      return mapOrder(order);
    },
  };
}
