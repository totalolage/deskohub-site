import { eq } from "drizzle-orm";
import { Context, Data, Effect, Layer } from "effect";
import {
  type DatabaseError,
  runDb,
  WorkspaceDatabase,
} from "@/db/database.service";
import { discounts } from "@/db/schema";
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
    | DatabaseError
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
          const row = yield* runDb(
            "discountDefinitions.loadById",
            async () =>
              await db.query.discounts.findFirst({
                where: eq(discounts.id, input.discountId),
                with: { productTargets: true },
              })
          );

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
