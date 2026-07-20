import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import { Context, Data, Effect, Layer } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import {
  type DiscountDefinition,
  type DiscountDefinitionMalformedError,
  decodeDiscountDefinition,
} from "./discount-definition";
import type { StoredDiscountId } from "./persistence-contracts";

export interface IDiscountDefinitionRepository {
  readonly loadById: (input: {
    readonly discountId: StoredDiscountId;
  }) => Effect.Effect<
    DiscountDefinition,
    | EffectDrizzleQueryError
    | DiscountDefinitionNotFoundError
    | DiscountDefinitionMalformedError
  >;
}

export class DiscountDefinitionRepository extends Context.Service<
  DiscountDefinitionRepository,
  IDiscountDefinitionRepository
>()("@deskohub-workspace/discounts/DiscountDefinitionRepository") {
  static Live = Layer.effect(
    this,
    Effect.gen(function* () {
      const { db } = yield* WorkspaceDatabase;

      const loadById = Effect.fn("DiscountDefinitionRepository.loadById")(
        function* (input) {
          const row = yield* db.query.discounts.findFirst({
            where: { id: input.discountId },
            with: { productTargets: true },
          });

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
