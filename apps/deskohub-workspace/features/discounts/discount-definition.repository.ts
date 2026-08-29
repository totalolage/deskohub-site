import { eq, getTableColumns } from "drizzle-orm";
import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import { Context, Data, Effect, Layer } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import { retryDatabaseRead } from "@/db/retry-database-read";
import { discountProductTargets, discounts } from "@/db/schema";
import {
  type DiscountDefinition,
  type DiscountDefinitionMalformedError,
  type DiscountDefinitionRow,
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
          const rows = yield* db
            .select({
              discount: getTableColumns(discounts),
              productTarget: {
                discountId: discountProductTargets.discountId,
                productTarget: discountProductTargets.productTarget,
              },
            })
            .from(discounts)
            .leftJoin(
              discountProductTargets,
              eq(discountProductTargets.discountId, discounts.id)
            )
            .where(eq(discounts.id, input.discountId))
            .pipe(retryDatabaseRead);

          const firstRow = rows[0];
          const row =
            firstRow &&
            ({
              ...firstRow.discount,
              productTargets: rows
                .map(({ productTarget }) => productTarget)
                .filter(Boolean),
            } satisfies DiscountDefinitionRow);

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
