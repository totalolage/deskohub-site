import { describe, expect, test } from "bun:test";

describe("DiscountDefinitionRepository", () => {
  test("loads discount rows without relation hydration", async () => {
    const source = await Bun.file(
      new URL("./discount-definition.repository.ts", import.meta.url)
    ).text();

    expect(source).toContain("db\n            .select({");
    expect(source).toContain(".from(discounts)");
    expect(source).toContain(".leftJoin(");
    expect(source).not.toContain(".query.discounts");
    expect(source).not.toContain("with: { productTargets: {} }");
  });

  test("keeps retryable failures typed without transaction cleanup", async () => {
    const source = await Bun.file(
      new URL("./discount-definition.repository.ts", import.meta.url)
    ).text();

    expect(source).toContain(".pipe(retryDatabaseRead)");
    expect(source).not.toContain(".transaction(");
  });
});
