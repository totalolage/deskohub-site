import { lt, lte } from "drizzle-orm";
import { Context, Data, Effect, Layer } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import {
  authOauthAccessToken,
  authOauthClientAssertion,
  authOauthRefreshToken,
  authRateLimit,
  authSession,
  authVerification,
} from "@/db/schema/auth";
import { betterAuthMagicLinkOptions } from "./auth-options";

type DeletedAuthRowCounts = {
  readonly sessions: number;
  readonly verifications: number;
  readonly rateLimitRows: number;
  readonly agentAccessTokens: number;
  readonly agentRefreshTokens: number;
  readonly agentClientAssertions: number;
};

/**
 * Fixed, non-PII cleanup failure. Raw database errors never cross this
 * boundary, so operator logs stay free of table payloads.
 */
export class AuthCleanupFailure extends Data.TaggedError("AuthCleanupFailure")<{
  readonly code: "account.cleanup.unavailable";
}> {}

type AuthCleanupInput = {
  /** The moment the sweep treats as now; rows must be older to be deleted. */
  readonly now: Date;
};

interface IAuthCleanupService {
  readonly deleteExpiredRows: (
    input: AuthCleanupInput
  ) => Effect.Effect<DeletedAuthRowCounts, AuthCleanupFailure>;
}

/**
 * Daily maintenance of the authentication schema: ordinary set-based
 * deletion of expired sessions and verifications, rate-limit rows whose
 * last request is older than the longest configured rate-limit window, and
 * the expired access tokens, refresh tokens, and client-assertion replay
 * records of customers' AI agents. Revoked agent tokens stay until they
 * expire, since refresh-token replay detection reads them. No queue,
 * archive, lock, or provider cleanup runs here.
 */
export class AuthCleanupService extends Context.Service<
  AuthCleanupService,
  IAuthCleanupService
>()("@deskohub-workspace/account/AuthCleanupService") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const { db } = yield* WorkspaceDatabase;
      const deleteExpiredRows = Effect.fn(
        "AuthCleanupService.deleteExpiredRows"
      )(function* (input: AuthCleanupInput) {
        const rateLimitCutoffMs =
          input.now.getTime() -
          betterAuthMagicLinkOptions.rateLimit.window * 1000;

        return yield* Effect.gen(function* () {
          const sessions = yield* db
            .delete(authSession)
            .where(lte(authSession.expiresAt, input.now))
            .returning({ id: authSession.id });
          const verifications = yield* db
            .delete(authVerification)
            .where(lte(authVerification.expiresAt, input.now))
            .returning({ id: authVerification.id });
          const rateLimitRows = yield* db
            .delete(authRateLimit)
            .where(lt(authRateLimit.lastRequest, rateLimitCutoffMs))
            .returning({ id: authRateLimit.id });
          const agentAccessTokens = yield* db
            .delete(authOauthAccessToken)
            .where(lte(authOauthAccessToken.expiresAt, input.now))
            .returning({ id: authOauthAccessToken.id });
          // An expired refresh token's remaining access tokens go with it
          // (ON DELETE CASCADE); they expire long before it does.
          const agentRefreshTokens = yield* db
            .delete(authOauthRefreshToken)
            .where(lte(authOauthRefreshToken.expiresAt, input.now))
            .returning({ id: authOauthRefreshToken.id });
          const agentClientAssertions = yield* db
            .delete(authOauthClientAssertion)
            .where(lte(authOauthClientAssertion.expiresAt, input.now))
            .returning({ id: authOauthClientAssertion.id });
          return {
            sessions: sessions.length,
            verifications: verifications.length,
            rateLimitRows: rateLimitRows.length,
            agentAccessTokens: agentAccessTokens.length,
            agentRefreshTokens: agentRefreshTokens.length,
            agentClientAssertions: agentClientAssertions.length,
          } satisfies DeletedAuthRowCounts;
        }).pipe(
          Effect.mapError(
            () =>
              new AuthCleanupFailure({ code: "account.cleanup.unavailable" })
          )
        );
      });

      return { deleteExpiredRows } satisfies IAuthCleanupService;
    })
  );

  static Live = this.Default.pipe(Layer.provide(WorkspaceDatabase.Default));
}
