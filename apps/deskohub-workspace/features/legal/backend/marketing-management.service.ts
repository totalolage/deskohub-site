import "server-only";

import { createHash, randomBytes } from "node:crypto";
import type { DotyposCustomerId } from "@deskohub/dotypos";
import { and, eq, gt, isNull } from "drizzle-orm";
import { Context, Data, Effect, Layer } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import { customerMarketingManagementTokens } from "@/db/schema/customer-marketing-management-tokens";
import { sensitiveDatabaseParameter } from "@/shared/backend/logging/database-query-parameter-classifier";

const tokenByteLength = 32;
const tokenTextLength = 43;
const linkLifetimeDays = 30;
const sessionLifetimeHours = 24;
const canonicalTokenPattern = /^[A-Za-z0-9_-]{43}$/;

export type MarketingManagementErrorReason =
  | "invalid_credential"
  | "unavailable";

export class MarketingManagementError extends Data.TaggedError(
  "MarketingManagementError"
)<{ readonly reason: MarketingManagementErrorReason }> {}

export interface IMarketingManagementService {
  readonly issue: (
    customerId: DotyposCustomerId
  ) => Effect.Effect<string, MarketingManagementError>;
  readonly exchange: (
    rawToken: string
  ) => Effect.Effect<
    { readonly token: string; readonly expiresAt: Date },
    MarketingManagementError
  >;
  readonly resolve: (
    rawCookie: string
  ) => Effect.Effect<DotyposCustomerId, MarketingManagementError>;
  readonly revoke: (
    rawCookie: string
  ) => Effect.Effect<void, MarketingManagementError>;
}

export class MarketingManagementService extends Context.Service<
  MarketingManagementService,
  IMarketingManagementService
>()("@deskohub-workspace/legal/MarketingManagementService") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const { db } = yield* WorkspaceDatabase;

      const issue: IMarketingManagementService["issue"] = Effect.fn(
        "MarketingManagementService.issue"
      )(function* (customerId) {
        const token = yield* makeToken;
        const now = Temporal.Now.instant();

        yield* db
          .insert(customerMarketingManagementTokens)
          .values({
            tokenHash: sensitiveDatabaseParameter(hashToken(token)),
            dotyposCustomerId: customerId,
            purpose: "link",
            expiresAt: now.add({ hours: linkLifetimeDays * 24 }),
            revokedAt: null,
          })
          .pipe(Effect.mapError(() => unavailableError()));

        return token;
      });

      const exchange: IMarketingManagementService["exchange"] = Effect.fn(
        "MarketingManagementService.exchange"
      )(function* (rawToken) {
        const token = parseToken(rawToken);
        if (token === null) return yield* invalidCredentialError();

        const sessionToken = yield* makeToken;
        const now = Temporal.Now.instant();
        const sessionLifetime = now.add({ hours: sessionLifetimeHours });
        const linkHash = hashToken(token);
        const sessionHash = hashToken(sessionToken);

        const exchanged = yield* db
          .transaction((tx) =>
            Effect.gen(function* () {
              const [link] = yield* tx
                .update(customerMarketingManagementTokens)
                .set({ revokedAt: now })
                .where(
                  and(
                    eq(
                      customerMarketingManagementTokens.tokenHash,
                      sensitiveDatabaseParameter(linkHash)
                    ),
                    eq(customerMarketingManagementTokens.purpose, "link"),
                    isNull(customerMarketingManagementTokens.revokedAt),
                    gt(customerMarketingManagementTokens.expiresAt, now)
                  )
                )
                .returning({
                  dotyposCustomerId:
                    customerMarketingManagementTokens.dotyposCustomerId,
                  expiresAt: customerMarketingManagementTokens.expiresAt,
                });

              if (!link) return null;

              const expiresAt = earliestInstant(
                sessionLifetime,
                link.expiresAt
              );
              yield* tx.insert(customerMarketingManagementTokens).values({
                tokenHash: sensitiveDatabaseParameter(sessionHash),
                dotyposCustomerId: link.dotyposCustomerId,
                purpose: "session",
                expiresAt,
                revokedAt: null,
              });

              return { token: sessionToken, expiresAt };
            })
          )
          .pipe(Effect.mapError(() => unavailableError()));

        if (exchanged === null) return yield* invalidCredentialError();

        return {
          token: exchanged.token,
          expiresAt: new Date(exchanged.expiresAt.epochMilliseconds),
        };
      });

      const resolve: IMarketingManagementService["resolve"] = Effect.fn(
        "MarketingManagementService.resolve"
      )(function* (rawCookie) {
        const token = parseToken(rawCookie);
        if (token === null) return yield* invalidCredentialError();

        const [session] = yield* db
          .select({
            dotyposCustomerId:
              customerMarketingManagementTokens.dotyposCustomerId,
          })
          .from(customerMarketingManagementTokens)
          .where(
            and(
              eq(
                customerMarketingManagementTokens.tokenHash,
                sensitiveDatabaseParameter(hashToken(token))
              ),
              eq(customerMarketingManagementTokens.purpose, "session"),
              isNull(customerMarketingManagementTokens.revokedAt),
              gt(
                customerMarketingManagementTokens.expiresAt,
                Temporal.Now.instant()
              )
            )
          )
          .limit(1)
          .pipe(Effect.mapError(() => unavailableError()));

        if (!session) return yield* invalidCredentialError();
        return session.dotyposCustomerId;
      });

      const revoke: IMarketingManagementService["revoke"] = Effect.fn(
        "MarketingManagementService.revoke"
      )(function* (rawCookie) {
        const token = parseToken(rawCookie);
        if (token === null) return yield* invalidCredentialError();

        const tokenHash = hashToken(token);
        const revoked = yield* db
          .update(customerMarketingManagementTokens)
          .set({ revokedAt: Temporal.Now.instant() })
          .where(
            and(
              eq(
                customerMarketingManagementTokens.tokenHash,
                sensitiveDatabaseParameter(tokenHash)
              ),
              eq(customerMarketingManagementTokens.purpose, "session"),
              isNull(customerMarketingManagementTokens.revokedAt)
            )
          )
          .returning({ tokenHash: customerMarketingManagementTokens.tokenHash })
          .pipe(Effect.mapError(() => unavailableError()));

        if (revoked.length > 0) return;

        const [existing] = yield* db
          .select({ purpose: customerMarketingManagementTokens.purpose })
          .from(customerMarketingManagementTokens)
          .where(
            eq(
              customerMarketingManagementTokens.tokenHash,
              sensitiveDatabaseParameter(tokenHash)
            )
          )
          .limit(1)
          .pipe(Effect.mapError(() => unavailableError()));

        if (existing && existing.purpose !== "session") {
          return yield* invalidCredentialError();
        }
      });

      return MarketingManagementService.of({
        issue,
        exchange,
        resolve,
        revoke,
      });
    })
  );
}

const makeToken = Effect.try({
  try: () => randomBytes(tokenByteLength).toString("base64url"),
  catch: () => unavailableError(),
});

const parseToken = (rawToken: string): string | null => {
  if (
    rawToken.length !== tokenTextLength ||
    !canonicalTokenPattern.test(rawToken)
  ) {
    return null;
  }

  const decoded = Buffer.from(rawToken, "base64url");
  return decoded.length === tokenByteLength &&
    decoded.toString("base64url") === rawToken
    ? rawToken
    : null;
};

const hashToken = (token: string): string =>
  createHash("sha256").update(token, "utf8").digest("hex");

const earliestInstant = (
  left: Temporal.Instant,
  right: Temporal.Instant
): Temporal.Instant =>
  Temporal.Instant.compare(left, right) <= 0 ? left : right;

const invalidCredentialError = () =>
  new MarketingManagementError({ reason: "invalid_credential" });

const unavailableError = () =>
  new MarketingManagementError({ reason: "unavailable" });
