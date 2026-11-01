import "server-only";

import type { DotyposCustomerId } from "@deskohub/dotypos";
import { and, eq } from "drizzle-orm";
import { Data, Effect, Option } from "effect";
import { WorkspaceTransaction } from "@/db/database.service";
import {
  discountCodes,
  promotionCodeCustomers,
  promotionCodes,
} from "@/db/schema";
import {
  type CanonicalPromotionCode,
  canonicalPromotionCodeSchema,
} from "./contracts";
import type {
  DiscountCodeId,
  PromotionCodeId,
  StoredDiscountId,
} from "./persistence-contracts";
import { generatePromotionCode } from "./promotion-code";

/** Everything an ordinary discount code row owns; omitted limits are unlimited. */
export type DiscountCodeValues = {
  readonly code: CanonicalPromotionCode;
  readonly discountId: StoredDiscountId;
  readonly enabled: boolean;
  readonly validFrom: Temporal.Instant | null;
  readonly validUntil: Temporal.Instant | null;
  readonly maxUses: number | null;
  readonly maxUsesPerCustomer: number | null;
  /** An empty audience leaves the code open to every customer. */
  readonly audience: readonly DotyposCustomerId[];
};

type InsertedDiscountCode = {
  readonly id: DiscountCodeId;
  readonly promotionCodeId: PromotionCodeId;
  readonly code: CanonicalPromotionCode;
};

/**
 * Inserts the code's rows unless another promotion already took its value.
 * Skipping a taken value fails no statement, so the caller's transaction stays
 * usable without a savepoint.
 */
const insertUnlessCodeTaken = Effect.fn("DiscountCodes.insertUnlessCodeTaken")(
  function* (values: DiscountCodeValues, onTakenCode: "fail" | "skip") {
    const { db } = yield* WorkspaceTransaction;
    const promotionValues = {
      code: values.code,
      enabled: values.enabled,
      validFrom: values.validFrom,
      validUntil: values.validUntil,
    };
    const insertPromotion = db
      .insert(promotionCodes)
      .values({ kind: "discount", ...promotionValues });
    const [promotion] = yield* (
      onTakenCode === "skip"
        ? insertPromotion.onConflictDoNothing({ target: promotionCodes.code })
        : insertPromotion
    ).returning({ id: promotionCodes.id });
    if (!promotion) return Option.none<InsertedDiscountCode>();
    const [code] = yield* db
      .insert(discountCodes)
      .values({
        ...promotionValues,
        promotionCodeId: promotion.id,
        discountId: values.discountId,
        maxUses: values.maxUses,
        maxUsesPerCustomer: values.maxUsesPerCustomer,
      })
      .returning({ id: discountCodes.id });
    if (!code)
      return yield* Effect.die(
        new Error("Discount code insert returned no identifier.")
      );
    if (values.audience.length > 0)
      yield* db.insert(promotionCodeCustomers).values(
        values.audience.map((dotyposCustomerId) => ({
          promotionCodeId: promotion.id,
          dotyposCustomerId,
        }))
      );
    return Option.some<InsertedDiscountCode>({
      id: code.id,
      promotionCodeId: promotion.id,
      code: values.code,
    });
  }
);

/**
 * Records a discount code in the shared promotion registry, its discount-code
 * child, and its customer audience, committing with the caller. A taken code
 * value fails with the registry's unique violation.
 */
export const insertDiscountCode = Effect.fn("DiscountCodes.insert")(function* (
  values: DiscountCodeValues
) {
  const inserted = yield* insertUnlessCodeTaken(values, "fail");
  return Option.isSome(inserted)
    ? inserted.value
    : yield* Effect.die(new Error("Promotion insert returned no identifier."));
});

/** Generated values repeatedly collided with existing codes. */
export class DiscountCodeSpaceExhausted extends Data.TaggedError(
  "DiscountCodeSpaceExhausted"
)<{ readonly attempts: number }> {}

const generatedCodeAttempts = 8;

class GeneratedCodeTaken extends Data.TaggedError("GeneratedCodeTaken") {}

/** Records a discount code under a fresh random value, retrying taken values. */
export const insertGeneratedDiscountCode = Effect.fn(
  "DiscountCodes.insertGenerated"
)((values: Omit<DiscountCodeValues, "code">) =>
  Effect.suspend(() =>
    insertUnlessCodeTaken(
      {
        ...values,
        code: canonicalPromotionCodeSchema.make(generatePromotionCode()),
      },
      "skip"
    )
  ).pipe(
    Effect.flatMap(
      Option.match({
        onNone: () => Effect.fail(new GeneratedCodeTaken()),
        onSome: Effect.succeed,
      })
    ),
    Effect.retry({
      times: generatedCodeAttempts - 1,
      while: (error) => error._tag === "GeneratedCodeTaken",
    }),
    Effect.catchTag("GeneratedCodeTaken", () =>
      Effect.fail(
        new DiscountCodeSpaceExhausted({ attempts: generatedCodeAttempts })
      )
    )
  )
);

/**
 * Disables an ordinary discount code in the shared registry and its legacy
 * mirror, committing with the caller. Disabled codes keep their history.
 * Returns whether the code exists.
 */
export const disableDiscountCode = Effect.fn("DiscountCodes.disable")(
  function* (code: CanonicalPromotionCode) {
    const { db } = yield* WorkspaceTransaction;
    const now = Temporal.Now.instant();
    const promotions = yield* db
      .update(promotionCodes)
      .set({ enabled: false, updatedAt: now })
      .where(
        and(eq(promotionCodes.code, code), eq(promotionCodes.kind, "discount"))
      )
      .returning({ id: promotionCodes.id });
    yield* db
      .update(discountCodes)
      .set({ enabled: false, updatedAt: now })
      .where(eq(discountCodes.code, code));
    return promotions.length > 0;
  }
);
