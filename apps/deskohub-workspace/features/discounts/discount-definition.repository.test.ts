import { describe, expect, test } from "bun:test";
import { Effect, Layer } from "effect";
import { makeRecordingWorkspaceDatabase } from "@/shared/testing/workspace-recording-database.test-utils";
import {
  DiscountDefinitionNotFoundError,
  DiscountDefinitionRepository,
} from "./discount-definition.repository";

const makeRepository = async () => {
  const recording = await makeRecordingWorkspaceDatabase();
  const repository = await Effect.runPromise(
    Effect.gen(function* () {
      return yield* DiscountDefinitionRepository;
    }).pipe(
      Effect.provide(
        DiscountDefinitionRepository.Default.pipe(
          Layer.provide(recording.layer)
        )
      )
    )
  );
  return { recording, repository };
};

const loadMissingDiscount = (
  repository: Awaited<ReturnType<typeof makeRepository>>["repository"]
) =>
  Effect.flip(repository.loadById({ discountId: "missing-discount" as never }));

describe("DiscountDefinitionRepository", () => {
  test("loads discount rows with a product-target left join and no relation hydration", async () => {
    const { recording, repository } = await makeRepository();

    await Effect.runPromise(loadMissingDiscount(repository)).catch(
      () => undefined
    );

    expect(recording.statements).toHaveLength(1);
    const { sql, params } = recording.statements[0];
    expect(sql).toContain('from "discounts"');
    expect(sql).toContain('left join "discount_targets"');
    expect(sql).toContain('"discounts"."id" = $1');
    expect(params).toContain("missing-discount");
    expect(sql.toLowerCase()).not.toContain("json");
  });

  test("fails with a typed not-found error when no stored row matches", async () => {
    const { recording, repository } = await makeRepository();

    const error = await Effect.runPromise(loadMissingDiscount(repository));

    expect(error).toBeInstanceOf(DiscountDefinitionNotFoundError);
    expect(recording.statements).toHaveLength(1);
  });

  test("reads outside a transaction", async () => {
    const { recording, repository } = await makeRepository();

    await Effect.runPromise(loadMissingDiscount(repository)).catch(
      () => undefined
    );

    expect(
      recording.statements.map(({ sql }) => sql.toLowerCase())
    ).not.toContain("begin");
  });
});
