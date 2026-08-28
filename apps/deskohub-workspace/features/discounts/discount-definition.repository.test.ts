import { describe, expect, test } from "bun:test";

describe("DiscountDefinitionRepository", () => {
  test("loads discount rows without relation hydration", async () => {
    const source = await Bun.file(
      new URL("./discount-definition.repository.ts", import.meta.url)
    ).text();

    expect(source).toContain("db\n            .transaction((tx) =>");
    expect(source).toContain(
      "sql`set transaction isolation level repeatable read`"
    );
    expect(source).toContain("tx\n                  .select()");
    expect(source).toContain(".from(discounts)");
    expect(source).toContain(".from(discountProductTargets)");
    expect(source).not.toContain(".query.discounts");
    expect(source).not.toContain("with: { productTargets: {} }");
  });

  test("preserves retryable query failures when normalizing transaction errors", async () => {
    const source = await Bun.file(
      new URL("./discount-definition.repository.ts", import.meta.url)
    ).text();

    expect(source).toContain(
      "cause instanceof EffectDrizzleQueryError\n                    ? cause"
    );
    expect(source).toContain("cause: Cause.fail(cause)");
  });
});
