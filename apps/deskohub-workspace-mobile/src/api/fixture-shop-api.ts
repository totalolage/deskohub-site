import { setCartQuantity } from "@/src/domain/cart";
import type {
  CartLine,
  Catalog,
  CheckoutQuote,
  PaymentHandoff,
  Product,
  Purchase,
  Seller,
  ShopEntitlement,
  ShopSession,
} from "@/src/domain/shop";
import { type ShopApi, ShopApiError } from "./shop-api";

const seller: Seller = {
  legalName: "Desktechub s.r.o.",
  identificationNumber: "24531596",
  taxTreatment: { kind: "not_vat_payer" },
};

const products: readonly Product[] = [
  {
    id: "mattoni-sparkling",
    categoryId: "cold-drinks",
    name: { cs: "Mattoni perlivá", en: "Mattoni sparkling" },
    description: {
      cs: "Minerální voda · 500 ml",
      en: "Mineral water · 500 ml",
    },
    price: { currency: "CZK", minorUnits: 3900 },
  },
  {
    id: "coca-cola-zero",
    categoryId: "cold-drinks",
    name: { cs: "Coca-Cola Zero", en: "Coca-Cola Zero" },
    description: { cs: "Plechovka · 330 ml", en: "Can · 330 ml" },
    price: { currency: "CZK", minorUnits: 4900 },
  },
  {
    id: "kombucha-ginger",
    categoryId: "cold-drinks",
    name: { cs: "Kombucha zázvor", en: "Ginger kombucha" },
    description: { cs: "Chlazená · 330 ml", en: "Chilled · 330 ml" },
    price: { currency: "CZK", minorUnits: 7900 },
  },
  {
    id: "oat-bar-cocoa",
    categoryId: "snacks",
    name: { cs: "Ovesná tyčinka kakao", en: "Cocoa oat bar" },
    description: { cs: "Rychlá svačina · 50 g", en: "Quick snack · 50 g" },
    price: { currency: "CZK", minorUnits: 4500 },
  },
  {
    id: "cashews-roasted",
    categoryId: "snacks",
    name: { cs: "Pražené kešu", en: "Roasted cashews" },
    description: { cs: "Lehce solené · 60 g", en: "Lightly salted · 60 g" },
    price: { currency: "CZK", minorUnits: 6900 },
  },
  {
    id: "filter-coffee",
    categoryId: "hot-drinks",
    name: { cs: "Filtrovaná káva", en: "Filter coffee" },
    description: { cs: "Jeden hrnek", en: "One cup" },
    price: { currency: "CZK", minorUnits: 5500 },
  },
];

const catalog: Catalog = {
  categories: [
    { id: "cold-drinks", name: { cs: "Studené nápoje", en: "Cold drinks" } },
    { id: "snacks", name: { cs: "Svačiny", en: "Snacks" } },
    { id: "hot-drinks", name: { cs: "Teplé nápoje", en: "Hot drinks" } },
  ],
  products,
  refreshedAt: new Date().toISOString(),
};

const demoPurchase: Purchase = {
  id: "DW-2408",
  publicReference: "DW-2408",
  createdAt: "2026-08-06T12:14:00.000Z",
  status: "paid",
  lines: [
    {
      productId: products[0]!.id,
      name: products[0]!.name,
      quantity: 1,
      unitPrice: products[0]!.price,
      lineTotal: products[0]!.price,
    },
    {
      productId: products[3]!.id,
      name: products[3]!.name,
      quantity: 1,
      unitPrice: products[3]!.price,
      lineTotal: products[3]!.price,
    },
  ],
  total: { currency: "CZK", minorUnits: 8400 },
  seller,
  receiptStatus: "sent",
};

const wait = (milliseconds = 220) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

export function createFixtureShopApi(): ShopApi {
  let session: ShopSession = { kind: "signed_out" };
  const requestedEmail = "alex@example.com";
  let purchases: Purchase[] = [demoPurchase];
  const reconciliationCounts = new Map<string, number>();
  const quotes = new Map<string, CheckoutQuote>();

  const requireSession = () => {
    if (session.kind === "signed_out") {
      throw new ShopApiError("Authentication required", "unauthorized", 401);
    }
    return session;
  };

  return {
    async getSession() {
      await wait();
      return session;
    },
    async prepareSignInHandoff() {
      return { url: "https://app.workspace.deskohub.cz/en-US/auth/sign-in" };
    },
    async completeSignInHandoff() {
      await wait();
      session = {
        kind: "signed_in",
        customer: {
          email: requestedEmail,
          displayName: requestedEmail.startsWith("alex") ? "Alex" : null,
        },
      };
      return session;
    },
    async signOut() {
      await wait(100);
      session = { kind: "signed_out" };
    },
    async getEntitlement(): Promise<ShopEntitlement> {
      const currentSession = requireSession();
      await wait();
      if (currentSession.customer.email?.startsWith("locked")) {
        return {
          kind: "locked",
          nextReservationStartsAt: "2026-08-18T07:00:00.000Z",
        };
      }
      return {
        kind: "eligible",
        localDate: "2026-08-11",
        expiresAt: "2026-08-11T21:59:59.999Z",
      };
    },
    async getCatalog() {
      requireSession();
      await wait();
      return { ...catalog, refreshedAt: new Date().toISOString() };
    },
    async quoteCart(lines: readonly CartLine[]): Promise<CheckoutQuote> {
      requireSession();
      await wait();
      const normalized = lines.reduce<CartLine[]>(
        (cart, line) => setCartQuantity(cart, line.productId, line.quantity),
        []
      );
      const quoteLines = normalized.map((line) => {
        const product = products.find(
          (candidate) => candidate.id === line.productId
        );
        if (!product)
          throw new ShopApiError(
            "Product is no longer available",
            "invalid_response"
          );
        return {
          productId: product.id,
          name: product.name,
          quantity: line.quantity,
          unitPrice: product.price,
          lineTotal: {
            currency: "CZK" as const,
            minorUnits: product.price.minorUnits * line.quantity,
          },
        };
      });
      const quote: CheckoutQuote = {
        id: `quote-${Date.now()}`,
        expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
        lines: quoteLines,
        total: {
          currency: "CZK",
          minorUnits: quoteLines.reduce(
            (total, line) => total + line.lineTotal.minorUnits,
            0
          ),
        },
        seller,
      };
      quotes.set(quote.id, quote);
      return quote;
    },
    async createHostedPayment(requestedQuote): Promise<PaymentHandoff> {
      requireSession();
      await wait();
      const quote = quotes.get(requestedQuote.id);
      if (!quote) {
        throw new ShopApiError("Quote has expired", "invalid_response");
      }
      const orderId = `DW-${String(Date.now()).slice(-6)}`;
      purchases = [
        {
          id: orderId,
          publicReference: orderId,
          createdAt: new Date().toISOString(),
          status: "payment_pending",
          lines: quote.lines,
          total: quote.total,
          seller,
          receiptStatus: "not_started",
        },
        ...purchases,
      ];
      return {
        orderId,
        hostedPaymentUrl: `https://payments.example.invalid/orders/${orderId}`,
      };
    },
    async reconcilePayment(orderId) {
      requireSession();
      await wait(380);
      const purchase = purchases.find((candidate) => candidate.id === orderId);
      if (!purchase)
        throw new ShopApiError("Purchase not found", "invalid_response", 404);
      const count = (reconciliationCounts.get(orderId) ?? 0) + 1;
      reconciliationCounts.set(orderId, count);
      const reconciled =
        count >= 1
          ? {
              ...purchase,
              status: "paid" as const,
              receiptStatus: "sent" as const,
            }
          : purchase;
      purchases = purchases.map((candidate) =>
        candidate.id === orderId ? reconciled : candidate
      );
      return reconciled;
    },
    async listPurchases() {
      requireSession();
      await wait();
      return purchases;
    },
    async getPurchase(orderId) {
      requireSession();
      await wait();
      const purchase = purchases.find((candidate) => candidate.id === orderId);
      if (!purchase)
        throw new ShopApiError("Purchase not found", "invalid_response", 404);
      return purchase;
    },
  };
}
