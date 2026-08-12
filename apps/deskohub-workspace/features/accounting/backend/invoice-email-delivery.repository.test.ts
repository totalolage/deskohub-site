import { describe, expect, test } from "bun:test";

const repositorySource = () =>
  Bun.file(
    new URL("./invoice-email-delivery.repository.ts", import.meta.url)
  ).text();

describe("invoice email delivery repository", () => {
  test("claims only failed or stale processing deliveries", async () => {
    const source = await repositorySource();
    const claim = source.slice(
      source.indexOf(
        'claim: Effect.fn("InvoiceEmailDeliveryRepository.claim")'
      ),
      source.indexOf(
        'markAccepted: Effect.fn("InvoiceEmailDeliveryRepository.markAccepted")'
      )
    );

    expect(claim).toContain(".onConflictDoUpdate({");
    expect(claim).toContain('eq(invoiceEmailDeliveries.state, "failed")');
    expect(claim).toContain('eq(invoiceEmailDeliveries.state, "processing")');
    expect(claim).toContain(
      "lt(invoiceEmailDeliveries.updatedAt, staleProcessingBefore)"
    );
    expect(claim).not.toContain('eq(invoiceEmailDeliveries.state, "accepted")');
    expect(claim).toContain("invoiceEmailDeliveries.attemptCount} + 1");
  });

  test("uses the claimed attempt number for terminal updates", async () => {
    const source = await repositorySource();
    const attemptGuard =
      "eq(invoiceEmailDeliveries.attemptCount, input.attemptNumber)";

    expect(source.split(attemptGuard)).toHaveLength(3);
    expect(source).toContain('state: "accepted"');
    expect(source).toContain('state: "failed"');
  });
});
