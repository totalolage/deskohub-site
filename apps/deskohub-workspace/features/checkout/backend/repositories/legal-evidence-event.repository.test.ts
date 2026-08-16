import { describe, expect, test } from "bun:test";

describe("LegalEvidenceEventRepository", () => {
  test("requires an order association and supports order-only goods evidence", async () => {
    const source = await Bun.file(
      new URL("./legal-evidence-event.repository.ts", import.meta.url)
    ).text();

    expect(source).toContain("orderId: Schema.optional(orderIdSchema)");
    expect(source).toContain(
      "input.orderId !== undefined || input.workspaceReservationId !== undefined"
    );
    expect(source).toContain("orderId: parsed.orderId");
    expect(source).not.toMatch(/customer(?:Email|Name|AccessCode)|rawPayload/);
  });
});
