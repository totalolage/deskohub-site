import { eq, sql } from "drizzle-orm";
import { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import { Cause, Context, Data, Effect, Layer } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import { discountProductTargets, discounts } from "@/db/schema";
import { retryDatabaseRead } from "@/db/retry-database-read";
import {
  type DiscountDefinition,
  type DiscountDefinitionRow,
  type DiscountDefinitionMalformedError,
  decodeDiscountDefinition,
} from "./discount-definition";
import type { StoredDiscountId } from "./persistence-contracts";

export interface IDiscountDefinitionRepository {
  readonly loadById: (
    input: LoadDiscountDefinitionInput
  ) => Effect.Effect<
    DiscountDefinition,
    | EffectDrizzleQueryError
    | DiscountDefinitionNotFoundError
    | DiscountDefinitionMalformedError
  >;
}

interface LoadDiscountDefinitionInput {
  readonly discountId: StoredDiscountId;
}

export class DiscountDefinitionRepository extends Context.Service<
  DiscountDefinitionRepository,
  IDiscountDefinitionRepository
>()("@deskohub-workspace/discounts/DiscountDefinitionRepository") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const { db } = yield* WorkspaceDatabase;

      const loadById = Effect.fn("DiscountDefinitionRepository.loadById")(
        function* (input: LoadDiscountDefinitionInput) {
          const [discountRow, productTargets] = yield* db
            .transaction((tx) =>
              Effect.gen(function* () {
                yield* tx.execute(
                  sql`set transaction isolation level repeatable read`
                );

                const discountRow = yield* tx
                  .select()
                  .from(discounts)
                  .where(eq(discounts.id, input.discountId))
                  .limit(1);
                const productTargets = yield* tx
                  .select({
                    discountId: discountProductTargets.discountId,
                    productTarget: discountProductTargets.productTarget,
                  })
                  .from(discountProductTargets)
                  .where(eq(discountProductTargets.discountId, input.discountId));

                return [discountRow, productTargets] as const;
              })
            )
            .pipe(
              Effect.mapError(
                (cause) =>
                  cause instanceof EffectDrizzleQueryError
                    ? cause
                    : new EffectDrizzleQueryError({
                        query:
                          "load discount definition in repeatable read transaction",
                        params: [input.discountId],
                        cause: Cause.fail(cause),
                      })
              )
            )
            .pipe(retryDatabaseRead);

          const row = discountRow[0]
            ? ({
                ...discountRow[0],
                productTargets,
              } satisfies DiscountDefinitionRow)
            : null;

          if (!row) {
            return yield* new DiscountDefinitionNotFoundError({
              discountId: input.discountId,
              message: "Stored discount definition was not found.",
            });
          }

          return yield* decodeDiscountDefinition({ row });
        }
      );

      return { loadById } satisfies IDiscountDefinitionRepository;
    })
  );
}

export class DiscountDefinitionNotFoundError extends Data.TaggedError(
  "DiscountDefinitionNotFoundError"
)<{
  readonly discountId: StoredDiscountId;
  readonly message: string;
}> {}
