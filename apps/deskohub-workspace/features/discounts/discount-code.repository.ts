import { eq } from "drizzle-orm";
import { Context, Effect, Layer, Option } from "effect";
import {
  type DatabaseError,
  runDb,
  WorkspaceDatabase,
} from "@/db/database.service";
import { discountCodes } from "@/db/schema";
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
  readonly findByCode: (input: {
    readonly code: CanonicalDiscountCode;
  }) => Effect.Effect<
    Option.Option<DiscountCodeConfiguration>,
    DatabaseError | DiscountCodeConfigurationError
  >;
  readonly loadAvailability: (input: {
    readonly codeId: DiscountCodeId;
    readonly dotyposCustomerId: string;
    readonly at: Date;
  }) => Effect.Effect<
    DiscountCodeAvailability,
    DatabaseError | DiscountCodeConfigurationError
  >;
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
        function* (input) {
          const row = yield* runDb(
            "discountCodes.findByCode",
            async () =>
              await db.query.discountCodes.findFirst({
                where: eq(discountCodes.code, input.code),
              })
          );

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
      )(function* (input) {
        const availability = yield* runDb(
          "discountCodes.loadAvailability",
          async () => {
            const queries = buildDiscountCodeAvailabilityQueries({
              db,
              ...input,
            });
            const [allowlistRows, activeClaimRows] = await Promise.all([
              queries.allowlist,
              queries.activeClaims,
            ]);

            return {
              allowlistSize: allowlistRows[0]?.allowlistSize ?? 0,
              customerAllowed: allowlistRows[0]?.customerAllowed ?? false,
              activeUseCount: activeClaimRows[0]?.activeUseCount ?? 0,
              customerHasRedeemed:
                activeClaimRows[0]?.customerHasRedeemed ?? false,
            };
          }
        );

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
