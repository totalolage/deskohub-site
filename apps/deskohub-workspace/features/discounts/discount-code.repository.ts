import type { DotyposCustomerId } from "@deskohub/dotypos";
import { eq } from "drizzle-orm";
import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import { Context, Effect, Layer, Option } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import { discountCodes } from "@/db/schema";
import { sensitiveDatabaseParameter } from "@/shared/backend/logging/database-query-parameter-classifier";
import {
  type DiscountCodeAvailability,
  type DiscountCodeConfiguration,
  type DiscountCodeConfigurationError,
  decodeDiscountCodeAvailability,
  decodeDiscountCodeConfiguration,
} from "./discount-code";
import { buildDiscountCodeAvailabilityQueries } from "./discount-code.repository-query";
import type {
  CanonicalDiscountCode,
  DiscountCodeId,
} from "./persistence-contracts";

export interface IDiscountCodeRepository {
  readonly findByCode: (
    input: FindDiscountCodeInput
  ) => Effect.Effect<
    Option.Option<DiscountCodeConfiguration>,
    EffectDrizzleQueryError | DiscountCodeConfigurationError
  >;
  readonly loadAvailability: (
    input: LoadDiscountCodeAvailabilityInput
  ) => Effect.Effect<
    DiscountCodeAvailability,
    EffectDrizzleQueryError | DiscountCodeConfigurationError
  >;
}

interface FindDiscountCodeInput {
  readonly code: CanonicalDiscountCode;
}

interface LoadDiscountCodeAvailabilityInput {
  readonly codeId: DiscountCodeId;
  readonly dotyposCustomerId: DotyposCustomerId;
}

export class DiscountCodeRepository extends Context.Service<
  DiscountCodeRepository,
  IDiscountCodeRepository
>()("@deskohub-workspace/discounts/DiscountCodeRepository") {
  static Live = Layer.effect(
    this,
    Effect.gen(function* () {
      const { db } = yield* WorkspaceDatabase;

      const findByCode = Effect.fn("DiscountCodeRepository.findByCode")(
        function* (input: FindDiscountCodeInput) {
          const [row] = yield* db
            .select()
            .from(discountCodes)
            .where(
              eq(discountCodes.code, sensitiveDatabaseParameter(input.code))
            )
            .limit(1);

          return yield* Option.fromNullishOr(row).pipe(
            Option.map((found) =>
              decodeDiscountCodeConfiguration({ row: found })
            ),
            Effect.transposeOption
          );
        }
      );

      const loadAvailability = Effect.fn(
        "DiscountCodeRepository.loadAvailability"
      )(function* (input: LoadDiscountCodeAvailabilityInput) {
        const queries = buildDiscountCodeAvailabilityQueries({ db, ...input });
        const [allowlistRows, activeClaimRows] = yield* Effect.all(
          [queries.allowlist, queries.activeClaims],
          { concurrency: "inherit" }
        );
        const availability = {
          allowlistSize: allowlistRows[0]?.allowlistSize ?? 0,
          customerAllowed: allowlistRows[0]?.customerAllowed ?? false,
          activeUseCount: activeClaimRows[0]?.activeUseCount ?? 0,
          customerHasRedeemed: activeClaimRows[0]?.customerHasRedeemed ?? false,
          customerHasReserved: activeClaimRows[0]?.customerHasReserved ?? false,
        };

        return yield* decodeDiscountCodeAvailability({
          codeId: input.codeId,
          availability,
        });
      });

      return {
        findByCode,
        loadAvailability,
      } satisfies IDiscountCodeRepository;
    })
  );
}
