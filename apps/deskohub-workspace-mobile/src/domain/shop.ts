export type Locale = "cs" | "en";

export type LocalizedText = Readonly<Record<Locale, string>>;

export type Money = Readonly<{
  currency: "CZK";
  minorUnits: number;
}>;

export type TaxTreatment =
  | Readonly<{ kind: "not_vat_payer" }>
  | Readonly<{
      kind: "vat_included";
      rateBasisPoints: number;
      taxMinorUnits: number;
    }>;

export type Seller = Readonly<{
  legalName: string;
  identificationNumber: string;
  vatId?: string;
  taxTreatment: TaxTreatment;
}>;

export type Category = Readonly<{
  id: string;
  name: LocalizedText;
}>;

export type Product = Readonly<{
  id: string;
  categoryId: string;
  name: LocalizedText;
  description: LocalizedText;
  price: Money;
  imageUrl?: string;
  color: "aqua" | "orange" | "yellow" | "navy";
  initials: string;
}>;

export type Catalog = Readonly<{
  categories: readonly Category[];
  products: readonly Product[];
  refreshedAt: string;
}>;

export type CartLine = Readonly<{
  productId: string;
  quantity: number;
}>;

export type QuoteLine = Readonly<{
  productId: string;
  name: LocalizedText;
  quantity: number;
  unitPrice: Money;
  lineTotal: Money;
}>;

export type CheckoutQuote = Readonly<{
  id: string;
  expiresAt: string;
  lines: readonly QuoteLine[];
  total: Money;
  seller: Seller;
}>;

export type PurchaseStatus =
  | "not_started"
  | "payment_pending"
  | "paid"
  | "failed"
  | "cancelled"
  | "expired";

export type ReceiptStatus = "not_started" | "processing" | "sent" | "failed";

export type Purchase = Readonly<{
  id: string;
  publicReference: string;
  createdAt: string;
  status: PurchaseStatus;
  lines: readonly QuoteLine[];
  total: Money;
  seller: Seller;
  receiptStatus: ReceiptStatus;
}>;

export type PaymentHandoff = Readonly<{
  orderId: string;
  hostedPaymentUrl: string;
}>;

export type ShopSession =
  | Readonly<{ kind: "signed_out" }>
  | Readonly<{
      kind: "signed_in";
      customer: { email: string | null; displayName: string | null };
    }>;

export type ShopEntitlement =
  | Readonly<{
      kind: "eligible";
      localDate: string;
      expiresAt: string;
    }>
  | Readonly<{
      kind: "locked";
      nextReservationStartsAt: string | null;
    }>;

export type AppUpdateState =
  | Readonly<{ kind: "current"; checkedAt: string }>
  | Readonly<{ kind: "small_update_ready" }>
  | Readonly<{ kind: "apk_update_waiting_for_wifi" }>
  | Readonly<{ kind: "applying" }>
  | Readonly<{ kind: "error" }>;
