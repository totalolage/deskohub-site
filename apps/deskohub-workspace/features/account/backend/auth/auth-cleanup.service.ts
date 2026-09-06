import { lt, lte } from "drizzle-orm";
import { Context, Data, Effect, Layer } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import { authRateLimit, authSession, authVerification } from "@/db/schema/auth";
import { betterAuthMagicLinkOptions } from "./auth-options";

export type DeletedAuthRowCounts = {
  readonly sessions: number;
  readonly verifications: number;
  readonly rateLimitRows: number;
};

/**
 * Fixed, non-PII cleanup failure. Raw database errors never cross this
 * boundary, so operator logs stay free of table payloads.
 */
export class AuthCleanupFailure extends Data.TaggedError("AuthCleanupFailure")<{
  readonly code: "account.cleanup.unavailable";
}> {}

export type AuthCleanupInput = {
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
 * deletion of expired sessions and verifications, plus rate-limit rows whose
 * last request is older than the longest configured rate-limit window. No
 * queue, archive, lock, or provider cleanup runs here.
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
          return {
            sessions: sessions.length,
            verifications: verifications.length,
            rateLimitRows: rateLimitRows.length,
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
