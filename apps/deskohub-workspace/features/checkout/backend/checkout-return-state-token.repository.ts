import "server-only";

import { createHash, createHmac, randomBytes } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import { Context, Data, Effect, Layer } from "effect";
import {
  type DatabaseError,
  runDb,
  WorkspaceDatabase,
} from "@/db/database.service";
import {
  type CheckoutReturnStateToken,
  checkoutReturnStateTokens,
} from "@/db/schema";
import { env } from "@/env";
import type { CheckoutReturnStateJson } from "@/features/checkout/types/checkout-return-state";

const checkoutReturnStateTokenTtlMilliseconds = 10 * 60 * 1000;

export class CheckoutReturnStateTokenError extends Data.TaggedError(
  "CheckoutReturnStateTokenError"
)<{
  readonly message: string;
}> {}

export interface CheckoutReturnStateTokenRepository {
  readonly create: (input: {
    readonly paymentOrderId: string;
    readonly state: CheckoutReturnStateJson;
  }) => Effect.Effect<string, DatabaseError>;
  readonly consume: (input: {
    readonly paymentOrderId: string;
    readonly token: string;
  }) => Effect.Effect<
    CheckoutReturnStateToken,
    DatabaseError | CheckoutReturnStateTokenError
  >;
}

export const CheckoutReturnStateTokenRepository =
  Context.GenericTag<CheckoutReturnStateTokenRepository>(
    "CheckoutReturnStateTokenRepository"
  );

const generateCheckoutReturnStateToken = () =>
  randomBytes(32).toString("base64url");

const hashCheckoutReturnStateToken = (token: string) => {
  if (env.CHECKOUT_RETURN_STATE_TOKEN_SECRET) {
    return createHmac("sha256", env.CHECKOUT_RETURN_STATE_TOKEN_SECRET)
      .update(token)
      .digest("base64url");
  }

  return createHash("sha256").update(token).digest("base64url");
};

const getCheckoutReturnStateTokenExpiresAt = () =>
  new Date(Date.now() + checkoutReturnStateTokenTtlMilliseconds);

export const CheckoutReturnStateTokenRepositoryLive = Layer.effect(
  CheckoutReturnStateTokenRepository,
  Effect.gen(function* () {
    const { db } = yield* WorkspaceDatabase;

    return CheckoutReturnStateTokenRepository.of({
      create: Effect.fn("checkoutReturnStateTokens.create")(
        function* (input) {
          const token = generateCheckoutReturnStateToken();
          const tokenHash = hashCheckoutReturnStateToken(token);

          yield* runDb("checkoutReturnStateTokens.create", async () => {
            await db.insert(checkoutReturnStateTokens).values({
              tokenHash,
              paymentOrderId: input.paymentOrderId,
              state: input.state,
              expiresAt: getCheckoutReturnStateTokenExpiresAt(),
            });
          });

          return token;
        },
        (effect, input) =>
          effect.pipe(
            Effect.annotateLogs({ paymentOrderId: input.paymentOrderId })
          )
      ),
      consume: Effect.fn("checkoutReturnStateTokens.consume")(
        function* (input) {
          const tokenHash = hashCheckoutReturnStateToken(input.token);

          const [token] = yield* runDb(
            "checkoutReturnStateTokens.consume",
            async () =>
              await db
                .update(checkoutReturnStateTokens)
                .set({ consumedAt: new Date(), updatedAt: new Date() })
                .where(
                  and(
                    eq(checkoutReturnStateTokens.tokenHash, tokenHash),
                    eq(
                      checkoutReturnStateTokens.paymentOrderId,
                      input.paymentOrderId
                    ),
                    isNull(checkoutReturnStateTokens.consumedAt),
                    sql`${checkoutReturnStateTokens.expiresAt} > now()`
                  )
                )
                .returning()
          );

          if (!token) {
            return yield* new CheckoutReturnStateTokenError({
              message:
                "Checkout return-state token was invalid, expired, or already used.",
            });
          }

          return token;
        },
        (effect, input) =>
          effect.pipe(
            Effect.annotateLogs({ paymentOrderId: input.paymentOrderId })
          )
      ),
    });
  })
);
