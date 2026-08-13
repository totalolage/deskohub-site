import type { DotyposCustomerId } from "@deskohub/dotypos";
import { eq } from "drizzle-orm";
import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import { Context, Effect, Layer, Option, Schema } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import { discountCodes, promotionCodes, vouchers } from "@/db/schema";
import { sensitiveDatabaseParameter } from "@/shared/backend/logging/database-query-parameter-classifier";
import type {
  CanonicalPromotionCode,
  DiscountCodeId,
  PromotionCodeId,
  VoucherId,
} from "./persistence-contracts";
import {
  type DiscountCodeAvailability,
  decodePromotionConfiguration,
  PromotionCodeConfigurationError,
  type SubmittedPromotionConfiguration,
  type VoucherAvailability,
} from "./promotion-code";
import {
  buildDiscountCodeAvailabilityQuery,
  buildPromotionAudienceQuery,
  buildVoucherAvailabilityQuery,
} from "./promotion-code.repository-query";

type RepositoryError =
  | EffectDrizzleQueryError
  | PromotionCodeConfigurationError;

export interface IPromotionCodeRepository {
  readonly findByCode: (input: {
    readonly code: CanonicalPromotionCode;
  }) => Effect.Effect<
    Option.Option<SubmittedPromotionConfiguration>,
    RepositoryError
  >;
  readonly loadDiscountCodeAvailability: (input: {
    readonly promotionCodeId: PromotionCodeId;
    readonly codeId: DiscountCodeId;
    readonly dotyposCustomerId: DotyposCustomerId;
  }) => Effect.Effect<DiscountCodeAvailability, RepositoryError>;
  readonly loadVoucherAvailability: (input: {
    readonly promotionCodeId: PromotionCodeId;
    readonly voucherId: VoucherId;
    readonly dotyposCustomerId: DotyposCustomerId;
  }) => Effect.Effect<VoucherAvailability, RepositoryError>;
}

export class PromotionCodeRepository extends Context.Service<
  PromotionCodeRepository,
  IPromotionCodeRepository
>()("@deskohub-workspace/discounts/PromotionCodeRepository") {
  static Live = Layer.effect(
    this,
    Effect.gen(function* () {
      const { db } = yield* WorkspaceDatabase;

      const findByCode = Effect.fn("PromotionCodeRepository.findByCode")(
        function* (input: { readonly code: CanonicalPromotionCode }) {
          const [row] = yield* db
            .select({
              promotionCodeId: promotionCodes.id,
              kind: promotionCodes.kind,
              code: promotionCodes.code,
              enabled: promotionCodes.enabled,
              validFrom: promotionCodes.validFrom,
              validUntil: promotionCodes.validUntil,
              discountCodeId: discountCodes.id,
              discountId: discountCodes.discountId,
              maxUses: discountCodes.maxUses,
              voucherId: vouchers.id,
              issuedAmountValue: vouchers.issuedAmountValue,
              issuedAmountExponent: vouchers.issuedAmountExponent,
              issuedAmountCurrency: vouchers.issuedAmountCurrency,
            })
            .from(promotionCodes)
            .leftJoin(
              discountCodes,
              eq(discountCodes.promotionCodeId, promotionCodes.id)
            )
            .leftJoin(vouchers, eq(vouchers.promotionCodeId, promotionCodes.id))
            .where(
              eq(promotionCodes.code, sensitiveDatabaseParameter(input.code))
            )
            .limit(1);

          return yield* Option.fromNullishOr(row).pipe(
            Option.map((found) => decodePromotionConfiguration({ row: found })),
            Effect.transposeOption
          );
        }
      );

      const loadDiscountCodeAvailability = Effect.fn(
        "PromotionCodeRepository.loadDiscountCodeAvailability"
      )(function* (input: {
        readonly promotionCodeId: PromotionCodeId;
        readonly codeId: DiscountCodeId;
        readonly dotyposCustomerId: DotyposCustomerId;
      }) {
        const [audienceRows, claimRows] = yield* Effect.all(
          [
            buildPromotionAudienceQuery({ db, ...input }),
            buildDiscountCodeAvailabilityQuery({ db, ...input }),
          ],
          { concurrency: "inherit" }
        );
        return yield* Schema.decodeUnknownEffect(
          discountCodeAvailabilitySchema,
          { errors: "all", onExcessProperty: "error" }
        )({
          allowlistSize: audienceRows[0]?.allowlistSize ?? 0,
          customerAllowed: audienceRows[0]?.customerAllowed ?? false,
          activeUseCount: claimRows[0]?.activeUseCount ?? 0,
          customerHasRedeemed: claimRows[0]?.customerHasRedeemed ?? false,
          customerHasReserved: claimRows[0]?.customerHasReserved ?? false,
        }).pipe(
          Effect.mapError((cause) =>
            malformedAvailability(input.promotionCodeId, cause)
          )
        );
      });

      const loadVoucherAvailability = Effect.fn(
        "PromotionCodeRepository.loadVoucherAvailability"
      )(function* (input: {
        readonly promotionCodeId: PromotionCodeId;
        readonly voucherId: VoucherId;
        readonly dotyposCustomerId: DotyposCustomerId;
      }) {
        const [audienceRows, claimRows] = yield* Effect.all(
          [
            buildPromotionAudienceQuery({ db, ...input }),
            buildVoucherAvailabilityQuery({ db, ...input }),
          ],
          { concurrency: "inherit" }
        );
        return yield* Schema.decodeUnknownEffect(voucherAvailabilitySchema, {
          errors: "all",
          onExcessProperty: "error",
        })({
          allowlistSize: audienceRows[0]?.allowlistSize ?? 0,
          customerAllowed: audienceRows[0]?.customerAllowed ?? false,
          customerHasReserved: claimRows[0]?.customerHasReserved ?? false,
          usedValue: claimRows[0]?.usedValue ?? 0,
        }).pipe(
          Effect.mapError((cause) =>
            malformedAvailability(input.promotionCodeId, cause)
          )
        );
      });

      return {
        findByCode,
        loadDiscountCodeAvailability,
        loadVoucherAvailability,
      } satisfies IPromotionCodeRepository;
    })
  );
}

const availabilityBase = {
  allowlistSize: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  customerAllowed: Schema.Boolean,
};

const discountCodeAvailabilitySchema = Schema.Struct({
  ...availabilityBase,
  activeUseCount: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  customerHasRedeemed: Schema.Boolean,
  customerHasReserved: Schema.Boolean,
});

const voucherAvailabilitySchema = Schema.Struct({
  ...availabilityBase,
  customerHasReserved: Schema.Boolean,
  usedValue: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
});

const malformedAvailability = (
  promotionCodeId: PromotionCodeId,
  cause: unknown
) =>
  new PromotionCodeConfigurationError({
    promotionCodeId,
    message: "Stored promotion availability is malformed.",
    cause,
  });
