import { createHash } from "node:crypto";
import type { DotyposCustomerId } from "@deskohub/dotypos";
import { Effect, Schema } from "effect";
import { instantStringSchema } from "@/shared/utils/temporal";
import {
  type MobileShopCart,
  type MobileShopCartLine,
  type MobileShopCatalog,
  type MobileShopCheckoutAttemptId,
  type MobileShopCheckoutAttemptKey,
  type MobileShopLocale,
  type MobileShopQuote,
  type MobileShopQuoteItem,
  mobileShopCartSchema,
  mobileShopCheckoutAttemptKeySchema,
  type SellerTaxRegime,
} from "./contracts";
import { MobileShopFailure } from "./errors";

const MAX_PRODUCT_QUANTITY = 10;
const MAX_ORDER_QUANTITY = 30;
const QUOTE_LIFETIME_MINUTES = 5;

const decodeCart = Schema.decodeUnknownEffect(mobileShopCartSchema);

export const normalizeMobileShopCart = Effect.fn("mobileShop.normalizeCart")(
  function* (input: unknown) {
    const decoded = yield* decodeCart(input).pipe(
      Effect.mapError(
        (cause) => new MobileShopFailure({ code: "invalid_cart", cause })
      )
    );
    const quantities = new Map<MobileShopCartLine["productId"], number>();

    for (const line of decoded) {
      const quantity = (quantities.get(line.productId) ?? 0) + line.quantity;
      if (quantity > MAX_PRODUCT_QUANTITY) {
        return yield* new MobileShopFailure({
          code: "quantity_limit_exceeded",
        });
      }
      quantities.set(line.productId, quantity);
    }

    const totalQuantity = Array.from(quantities.values()).reduce(
      (total, quantity) => total + quantity,
      0
    );
    if (totalQuantity > MAX_ORDER_QUANTITY) {
      return yield* new MobileShopFailure({ code: "quantity_limit_exceeded" });
    }

    return Array.from(quantities, ([productId, quantity]) => ({
      productId,
      quantity,
    })).sort((left, right) => left.productId.localeCompare(right.productId));
  }
);

export const quoteMobileShopCart = Effect.fn("mobileShop.quoteCart")(
  function* (input: {
    readonly cart: unknown;
    readonly catalog: MobileShopCatalog;
    readonly locale: MobileShopLocale;
    readonly taxRegime: SellerTaxRegime;
    readonly now: Temporal.Instant;
  }) {
    if (input.taxRegime.kind !== "not-vat-payer") {
      return yield* new MobileShopFailure({ code: "catalog_unavailable" });
    }
    const cart = yield* normalizeMobileShopCart(input.cart);
    const products = new Map(
      input.catalog.products.map((product) => [product.id, product])
    );
    const items: MobileShopQuoteItem[] = [];

    for (const line of cart) {
      const product = products.get(line.productId);
      if (!product) {
        return yield* new MobileShopFailure({ code: "catalog_changed" });
      }
      const lineValue = product.price.value * line.quantity;
      if (!Number.isSafeInteger(lineValue) || lineValue <= 0) {
        return yield* new MobileShopFailure({ code: "catalog_unavailable" });
      }

      items.push({
        productId: product.id,
        categoryId: product.categoryId,
        productVersion: product.version,
        canonicalName: product.canonicalName,
        displayName: product.name,
        quantity: line.quantity,
        ...(product.unitLabel && { unitLabel: product.unitLabel }),
        unitPrice: product.price,
        lineTotal: { ...product.price, value: lineValue },
        tax: { kind: "not-applicable" },
      });
    }

    const totalValue = items.reduce(
      (total, item) => total + item.lineTotal.value,
      0
    );
    const moneyTemplate = items[0]?.lineTotal;
    if (
      !moneyTemplate ||
      !Number.isSafeInteger(totalValue) ||
      totalValue <= 0
    ) {
      return yield* new MobileShopFailure({ code: "catalog_unavailable" });
    }
    if (
      items.some(
        (item) =>
          item.lineTotal.currency !== moneyTemplate.currency ||
          item.lineTotal.exponent !== moneyTemplate.exponent
      )
    ) {
      return yield* new MobileShopFailure({ code: "catalog_unavailable" });
    }

    const quoteWithoutFingerprint = {
      expiresAt: instantStringSchema.make(
        input.now.add({ minutes: QUOTE_LIFETIME_MINUTES }).toString()
      ),
      locale: input.locale,
      taxRegime: input.taxRegime,
      items,
      total: { ...moneyTemplate, value: totalValue },
    };

    return {
      ...quoteWithoutFingerprint,
      fingerprint: fingerprintMobileShopQuote(quoteWithoutFingerprint),
    } satisfies MobileShopQuote;
  }
);

export const fingerprintMobileShopCart = (cart: MobileShopCart) =>
  hashCanonicalValue(
    [...cart]
      .sort((left, right) => left.productId.localeCompare(right.productId))
      .map(({ productId, quantity }) => ({ productId, quantity }))
  );

export const getMobileShopCheckoutAttemptKey = (input: {
  readonly customerId: DotyposCustomerId;
  readonly checkoutAttemptId: MobileShopCheckoutAttemptId;
}): MobileShopCheckoutAttemptKey =>
  mobileShopCheckoutAttemptKeySchema.make(
    hashCanonicalValue({
      version: 1,
      customerId: input.customerId,
      checkoutAttemptId: input.checkoutAttemptId,
    })
  );

const fingerprintMobileShopQuote = (
  quote: Omit<MobileShopQuote, "fingerprint">
) =>
  hashCanonicalValue({
    locale: quote.locale,
    taxRegime: quote.taxRegime,
    items: quote.items,
    total: quote.total,
  });

const hashCanonicalValue = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
