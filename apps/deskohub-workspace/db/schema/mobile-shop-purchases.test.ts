import { describe, expect, test } from "bun:test";
import { getTableConfig } from "drizzle-orm/pg-core";
import {
  mobileShopPurchaseOrderItems,
  mobileShopPurchaseOrders,
  mobileShopPurchasePaymentAttempts,
  mobileShopPurchaseReceiptDeliveries,
  mobileShopPurchaseStockAttempts,
  mobileShopPurchaseWebhookEvents,
} from "./mobile-shop-purchases";

describe("mobile shop purchase persistence", () => {
  test("keeps purchases owned by Dotypos customer IDs without account PII", () => {
    const tables = [
      mobileShopPurchaseOrders,
      mobileShopPurchaseOrderItems,
      mobileShopPurchasePaymentAttempts,
      mobileShopPurchaseWebhookEvents,
      mobileShopPurchaseReceiptDeliveries,
      mobileShopPurchaseStockAttempts,
    ];
    const columns = tables.flatMap((table) =>
      getTableConfig(table).columns.map(({ name }) => name)
    );

    expect(columns).toContain("dotypos_customer_id");
    expect(columns).toContain("authorizing_dotypos_reservation_id");
    expect(columns).not.toContain("account_id");
    expect(columns).not.toContain("email");
    expect(columns).not.toContain("phone");
    expect(columns).not.toContain("raw_payload");
    expect(columns).not.toContain("receipt_body");
  });

  test("enforces idempotent purchase, provider, receipt, and stock identities", () => {
    const orderConfig = getTableConfig(mobileShopPurchaseOrders);
    const itemConfig = getTableConfig(mobileShopPurchaseOrderItems);
    const paymentConfig = getTableConfig(mobileShopPurchasePaymentAttempts);
    const receiptConfig = getTableConfig(mobileShopPurchaseReceiptDeliveries);
    const stockConfig = getTableConfig(mobileShopPurchaseStockAttempts);

    expect(
      orderConfig.columns.find(({ name }) => name === "checkout_attempt_key")
        ?.isUnique
    ).toBe(true);
    expect(
      itemConfig.indexes.find(
        ({ config }) =>
          config.name === "mobile_shop_purchase_order_items_product_unique_idx"
      )?.config.unique
    ).toBe(true);
    expect(
      paymentConfig.indexes.find(
        ({ config }) =>
          config.name ===
          "mobile_shop_purchase_payment_attempts_provider_order_unique_idx"
      )?.config.unique
    ).toBe(true);
    expect(
      receiptConfig.columns.find(({ name }) => name === "purchase_order_id")
        ?.primary
    ).toBe(true);
    expect(
      stockConfig.columns.find(({ name }) => name === "purchase_order_id")
        ?.primary
    ).toBe(true);
  });

  test("guards terminal and retry-sensitive lifecycle facts", () => {
    const orderChecks = getTableConfig(mobileShopPurchaseOrders).checks.map(
      ({ name }) => name
    );
    const stockChecks = getTableConfig(
      mobileShopPurchaseStockAttempts
    ).checks.map(({ name }) => name);

    expect(orderChecks).toEqual(
      expect.arrayContaining([
        "mobile_shop_purchase_orders_paid_at_check",
        "mobile_shop_purchase_orders_payment_failure_check",
        "mobile_shop_purchase_orders_stock_retry_check",
        "mobile_shop_purchase_orders_tax_regime_check",
      ])
    );
    expect(stockChecks).toContain(
      "mobile_shop_purchase_stock_attempts_retry_check"
    );
    expect(stockChecks).toContain(
      "mobile_shop_purchase_stock_attempts_synced_warehouse_check"
    );
  });

  test("generated migration is additive and limited to account and mobile shop tables", async () => {
    const migration = await Bun.file(
      new URL(
        "../migrations/20260811230738_past_alex_power/migration.sql",
        import.meta.url
      )
    ).text();

    for (const table of [
      "mobile_shop_purchase_order_items",
      "mobile_shop_purchase_orders",
      "mobile_shop_purchase_payment_attempts",
      "mobile_shop_purchase_receipt_deliveries",
      "mobile_shop_purchase_stock_attempts",
      "mobile_shop_purchase_webhook_events",
    ]) {
      expect(migration).toContain(`CREATE TABLE "${table}"`);
    }
    expect(migration).not.toContain(
      'CREATE TABLE "accounting_document_snapshots"'
    );
    expect(migration).toContain('CREATE TABLE "customer_account_links"');
    expect(migration).not.toContain('CREATE TABLE "discount_targets"');
    expect(migration).not.toContain("DROP TABLE");
  });
});
