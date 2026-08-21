import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";

const readRepository = () =>
  Bun.file(new URL("./invoice.repository.ts", import.meta.url)).text();

describe("invoice repository persistence contract", () => {
  test("locks the order and rechecks idempotency before numbering", async () => {
    const source = await readRepository();
    const transaction = source.slice(source.indexOf("db.transaction((tx)"));
    const rowLock = transaction.indexOf('.for("update")');
    const existingLookup = transaction.indexOf("const [existing]");
    const counterAllocation = transaction.indexOf(
      ".insert(invoiceNumberCounters)"
    );
    const invoiceInsert = transaction.indexOf(".insert(invoices)");

    expect(rowLock).toBeGreaterThan(-1);
    expect(transaction).toContain("coalesce(");
    expect(transaction).toContain("paymentAttempts.orderId");
    expect(existingLookup).toBeGreaterThan(rowLock);
    expect(counterAllocation).toBeGreaterThan(existingLookup);
    expect(invoiceInsert).toBeGreaterThan(counterAllocation);
  });

  test("allocates in the invoice transaction without a PostgreSQL sequence", async () => {
    const source = await readRepository();

    expect(source).toContain(".onConflictDoUpdate({");
    expect(source).toContain("lastSequence: sql`");
    expect(source).toContain("invoiceNumberCounters.lastSequence} + 1");
    expect(source).not.toContain("maximumAnnualInvoiceSequence");
    expect(source).not.toContain("setWhere:");
    expect(source).not.toContain("nextval");
  });

  test("checks paid ownership and encrypts only after document validation", async () => {
    const source = await readRepository();
    const issue = source.slice(
      source.indexOf('const issue = Effect.fn("InvoiceRepository.issue")')
    );

    expect(issue).toContain('locked.paymentAttemptState !== "paid"');
    expect(issue).toContain('locked.orderPaymentState !== "paid"');
    expect(issue).toContain("locked.activePaymentAttemptId");
    expect(issue).toContain("locked.paidAt === null");
    expect(issue).toContain('locked.fulfillmentState !== "fulfilled"');
    expect(issue).toContain("locked.fulfilledAt === null");
    expect(issue).toContain("paidAt: locked.paidAt");
    expect(issue).toContain("fulfilledAt: locked.fulfilledAt");
    expect(issue.indexOf("invoiceDocumentSchema")).toBeLessThan(
      issue.indexOf("encryptAccountingSnapshot(")
    );
    expect(issue).toContain("Effect.withTracerEnabled(false)");
  });

  test("does not return an order invoice for a different attempt", async () => {
    const source = await readRepository();
    const issue = source.slice(
      source.indexOf('const issue = Effect.fn("InvoiceRepository.issue")')
    );

    expect(issue).toContain("existing.paymentAttemptId !== paymentAttemptId");
  });

  test("requires and validates complete buyer details instead of using the source buyer", async () => {
    const source = await readRepository();
    const issue = source.slice(
      source.indexOf('const issue = Effect.fn("InvoiceRepository.issue")')
    );

    expect(issue).toContain("readonly buyer: InvoiceBuyer");
    expect(issue).toContain("Schema.decodeUnknownEffect(invoiceBuyerSchema");
    expect(issue).not.toContain("input.buyer ?? source.buyer");
  });

  test("serializes manual invoice ids and compares normalized retries before numbering", async () => {
    const source = await readRepository();
    const issue = source.slice(
      source.indexOf(
        'const issueManual = Effect.fn("InvoiceRepository.issueManual")'
      )
    );
    const advisoryLock = issue.indexOf("pg_advisory_xact_lock");
    const existingLookup = issue.indexOf("const [existing]");
    const counterAllocation = issue.indexOf(".insert(invoiceNumberCounters)");

    expect(issue).toContain("normalizeManualInvoiceInput(input)");
    expect(issue).toContain("validateManualInvoiceRetry");
    expect(advisoryLock).toBeGreaterThan(-1);
    expect(existingLookup).toBeGreaterThan(advisoryLock);
    expect(counterAllocation).toBeGreaterThan(existingLookup);
  });
});
