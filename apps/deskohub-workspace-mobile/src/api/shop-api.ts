import type {
  CartLine,
  Catalog,
  CheckoutQuote,
  Locale,
  PaymentHandoff,
  Purchase,
  ShopEntitlement,
  ShopSession,
} from "@/src/domain/shop";

export class ShopApiError extends Error {
  constructor(
    message: string,
    readonly kind:
      | "offline"
      | "unauthorized"
      | "invalid_response"
      | "unavailable"
      | "unknown",
    readonly status?: number
  ) {
    super(message);
    this.name = "ShopApiError";
  }
}

export interface ShopApi {
  getSession(): Promise<ShopSession>;
  prepareSignInHandoff(locale: Locale): Promise<{
    readonly url: string;
    readonly callbackUrl?: string;
  }>;
  completeSignInHandoff(callbackUrl?: string): Promise<ShopSession>;
  signOut(): Promise<void>;
  getEntitlement(): Promise<ShopEntitlement>;
  getCatalog(locale: Locale): Promise<Catalog>;
  quoteCart(lines: readonly CartLine[], locale: Locale): Promise<CheckoutQuote>;
  createHostedPayment(
    quote: CheckoutQuote,
    lines: readonly CartLine[],
    locale: Locale
  ): Promise<PaymentHandoff>;
  reconcilePayment(orderId: string): Promise<Purchase>;
  listPurchases(): Promise<readonly Purchase[]>;
  getPurchase(orderId: string): Promise<Purchase>;
}
