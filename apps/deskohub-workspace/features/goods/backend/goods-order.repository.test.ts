import { describe, expect, test } from "bun:test";

describe("GoodsOrderRepository", () => {
  test("issues the order, evidence, and cart mutation in one transaction", async () => {
    const source = await Bun.file(
      new URL("./goods-order.repository.ts", import.meta.url)
    ).text();
    const issue = source.slice(
      source.indexOf('"GoodsOrderRepository.issueTransaction"'),
      source.indexOf('"GoodsOrderRepository.loadIdempotentOrder"')
    );

    expect(source).toContain(
      "db.transaction((tx) => issueGoodsOrder(tx, input))"
    );
    expect(issue).toContain('.for("update")');
    expect(issue).toContain("goodsCartsEqual(current, input.expectedCart)");
    expect(issue).toContain("persistIssuedGoodsDiscountEvidence");
    expect(issue).toContain("persistLegalEvidenceEvents");
    expect(issue).toContain("tx.delete(goodsCartItems)");
    expect(issue).toContain("createdAt: input.issuedAt");
    expect(issue).toContain("fulfilledAt: input.issuedAt");
    expect(issue).toContain("updatedAt: input.issuedAt");
    expect(issue).toContain("createdAt: input.issuedAt");
    expect(issue.indexOf("persistIssuedGoodsDiscountEvidence")).toBeLessThan(
      issue.indexOf("tx.delete(goodsCartItems)")
    );
  });

  test("uses correlation uniqueness for concurrent idempotent replay", async () => {
    const source = await Bun.file(
      new URL("./goods-order.repository.ts", import.meta.url)
    ).text();

    expect(source).toContain("NexiCorrelationIdSchema.make(input.issuanceId)");
    expect(source).toContain(
      ".onConflictDoNothing({ target: orders.correlationId })"
    );
    expect(source).toContain('order.kind !== "goods"');
    expect(source).toContain("order.dotyposCustomerId !== input.customerId");
  });

  test("accepts only an exact replay of persisted issuance facts", async () => {
    const source = await Bun.file(
      new URL("./goods-order.repository.ts", import.meta.url)
    ).text();
    const replay = source.slice(
      source.indexOf('"GoodsOrderRepository.loadIdempotentOrder"'),
      source.indexOf('"GoodsOrderRepository.listTransaction"')
    );

    expect(source).toContain("loadIdempotentOrder(tx, input, correlationId)");
    expect(replay).toContain("goodsOrderLinesEqual");
    expect(replay).toContain("legalEvidenceEvents");
    expect(replay).toContain("discountApplications");
    expect(replay).toContain("persistIssuedGoodsDiscountEvidence");
    expect(replay).toContain("GoodsOrderIssuanceConflictError");
  });
});
