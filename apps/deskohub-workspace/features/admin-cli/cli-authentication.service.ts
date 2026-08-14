import {
  CliAccessToken,
  type CliAccessTokenType,
  CliAuthenticationCode,
  type CliAuthenticationCodeType,
  type CliAuthenticationStatusType,
  type CliClientNameType,
  CliGrantRejected,
  CliGrantToken,
  CliSessionId,
  type CliSessionIdType,
  type CliSessionType,
  CliSessionUnauthorized,
  digestCliAuthenticationSecret,
  type ExchangeCliGrantType,
  makeCliAuthenticationSecret,
  type StartCliAuthenticationType,
} from "@deskohub/workspace-admin-api";
import { NodeCrypto } from "@effect/platform-node";
import { Temporal } from "@js-temporal/polyfill";
import { and, desc, eq, gt, isNotNull, isNull, lt, or } from "drizzle-orm";
import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import {
  Clock,
  Context,
  Crypto,
  Data,
  Effect,
  Layer,
  Option,
  type PlatformError,
  Schema,
} from "effect";
import type { SqlError } from "effect/unstable/sql/SqlError";
import { WorkspaceDatabase } from "@/db/database.service";
import {
  type CliAuthenticationRequestRow,
  type CliSessionRow,
  cliAuthenticationRequests,
  cliSessions,
} from "@/db/schema";
import type { CliAuthenticationRequestId } from "@/features/admin-cli/cli-identifiers";

const authenticationLifetimeMinutes = 5;
const grantLifetimeMinutes = 5;
const lastUsedWriteIntervalMinutes = 5;

export type CliSessionAdministrationItem = CliSessionType & {
  readonly revokedAt: string | null;
};

export type CliApprovalRequest = {
  readonly id: CliAuthenticationRequestId;
  readonly clientName: string;
  readonly cliVersion: string;
  readonly buildTarget: StartCliAuthenticationType["buildTarget"];
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly state: "pending" | "approved" | "granted" | "expired" | "revoked";
};

interface ICliAuthentication {
  readonly start: (input: StartCliAuthenticationType) => Effect.Effect<
    {
      readonly code: CliAuthenticationCodeType;
      readonly approvalPath: string;
      readonly expiresAt: string;
    },
    EffectDrizzleQueryError | PlatformError.PlatformError
  >;
  readonly status: (
    code: CliAuthenticationCodeType
  ) => Effect.Effect<
    CliAuthenticationStatusType,
    EffectDrizzleQueryError | PlatformError.PlatformError
  >;
  readonly exchange: (input: ExchangeCliGrantType) => Effect.Effect<
    {
      readonly accessToken: CliAccessTokenType;
      readonly session: CliSessionType;
    },
    | EffectDrizzleQueryError
    | PlatformError.PlatformError
    | SqlError
    | CliGrantRejected
  >;
  readonly authenticateSession: (
    authorization: string
  ) => Effect.Effect<
    CliSessionType,
    | EffectDrizzleQueryError
    | PlatformError.PlatformError
    | CliSessionUnauthorized
  >;
  readonly inspectApproval: (
    code: CliAuthenticationCodeType
  ) => Effect.Effect<
    CliApprovalRequest | null,
    EffectDrizzleQueryError | PlatformError.PlatformError
  >;
  readonly approve: (
    code: CliAuthenticationCodeType
  ) => Effect.Effect<
    CliApprovalRequest,
    | EffectDrizzleQueryError
    | PlatformError.PlatformError
    | CliApprovalUnavailableError
  >;
  readonly listSessions: () => Effect.Effect<
    ReadonlyArray<CliSessionAdministrationItem>,
    EffectDrizzleQueryError
  >;
  readonly revoke: (
    sessionId: CliSessionIdType
  ) => Effect.Effect<boolean, EffectDrizzleQueryError>;
  readonly renameSession: (input: {
    readonly sessionId: CliSessionIdType;
    readonly clientName: CliClientNameType;
  }) => Effect.Effect<boolean, EffectDrizzleQueryError>;
}

export class CliAuthentication extends Context.Service<
  CliAuthentication,
  ICliAuthentication
>()("@deskohub-workspace/admin-cli/CliAuthentication") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const { db } = yield* WorkspaceDatabase;
      const crypto = yield* Crypto.Crypto;
      const makeSecret = () =>
        makeCliAuthenticationSecret().pipe(
          Effect.provideService(Crypto.Crypto, crypto)
        );
      const digestSecret = (secret: string) =>
        digestCliAuthenticationSecret(secret).pipe(
          Effect.provideService(Crypto.Crypto, crypto)
        );

      const loadRequest = Effect.fn("CliAuthentication.loadRequest")(function* (
        code: CliAuthenticationCodeType
      ) {
        const codeHash = yield* digestSecret(code);
        const [result] = yield* db
          .select({
            request: cliAuthenticationRequests,
            revokedAt: cliSessions.revokedAt,
          })
          .from(cliAuthenticationRequests)
          .leftJoin(
            cliSessions,
            eq(cliAuthenticationRequests.sessionId, cliSessions.id)
          )
          .where(eq(cliAuthenticationRequests.codeHash, codeHash))
          .limit(1);
        return result ?? null;
      });

      const start = Effect.fn("CliAuthentication.start")(function* (
        input: StartCliAuthenticationType
      ) {
        const code = CliAuthenticationCode.make(yield* makeSecret());
        const codeHash = yield* digestSecret(code);
        const now = yield* nowInstant;
        const expiresAt = now.add({ minutes: authenticationLifetimeMinutes });

        yield* db
          .delete(cliAuthenticationRequests)
          .where(
            and(
              isNull(cliAuthenticationRequests.sessionId),
              or(
                and(
                  isNull(cliAuthenticationRequests.approvedAt),
                  lt(cliAuthenticationRequests.expiresAt, now)
                ),
                and(
                  isNotNull(cliAuthenticationRequests.approvedAt),
                  lt(cliAuthenticationRequests.grantExpiresAt, now)
                )
              )
            )
          );
        yield* db.insert(cliAuthenticationRequests).values({
          codeHash,
          challenge: input.challenge,
          clientName: input.clientName,
          cliVersion: input.cliVersion,
          buildTarget: input.buildTarget,
          createdAt: now,
          expiresAt,
        });

        return {
          code,
          approvalPath: `/admin/cli/authenticate?code=${encodeURIComponent(code)}`,
          expiresAt: toIsoString(expiresAt),
        };
      });

      const status = Effect.fn("CliAuthentication.status")(function* (
        code: CliAuthenticationCodeType
      ) {
        const result = yield* loadRequest(code);
        const now = yield* nowInstant;
        if (!result) return { authStatus: "expired" } as const;

        const currentStatus = toAuthenticationStatus(result, now);
        if (
          currentStatus.authStatus === "expired" &&
          result.request.grantToken
        ) {
          yield* db
            .update(cliAuthenticationRequests)
            .set({ grantToken: null })
            .where(
              and(
                eq(cliAuthenticationRequests.id, result.request.id),
                isNull(cliAuthenticationRequests.consumedAt),
                lt(cliAuthenticationRequests.grantExpiresAt, now)
              )
            );
        }
        return currentStatus;
      });

      const inspectApproval = Effect.fn("CliAuthentication.inspectApproval")(
        function* (code: CliAuthenticationCodeType) {
          const result = yield* loadRequest(code);
          const now = yield* nowInstant;
          return result ? toApprovalRequest(result, now) : null;
        }
      );

      const approve = Effect.fn("CliAuthentication.approve")(function* (
        code: CliAuthenticationCodeType
      ) {
        const result = yield* loadRequest(code);
        const now = yield* nowInstant;
        if (!result) {
          return yield* new CliApprovalUnavailableError({
            message: "This authentication request is invalid or has expired.",
          });
        }

        const current = toApprovalRequest(result, now);
        if (current.state !== "pending") {
          return current;
        }

        const grantToken = CliGrantToken.make(yield* makeSecret());
        const grantExpiresAt = now.add({ minutes: grantLifetimeMinutes });
        const [approved] = yield* db
          .update(cliAuthenticationRequests)
          .set({
            approvedAt: now,
            grantToken,
            grantExpiresAt,
          })
          .where(
            and(
              eq(cliAuthenticationRequests.id, result.request.id),
              isNull(cliAuthenticationRequests.approvedAt),
              gt(cliAuthenticationRequests.expiresAt, now)
            )
          )
          .returning();

        if (!approved) {
          const latest = yield* loadRequest(code);
          if (!latest) {
            return yield* new CliApprovalUnavailableError({
              message: "This authentication request is invalid or has expired.",
            });
          }
          return toApprovalRequest(latest, now);
        }

        return toApprovalRequest({ request: approved, revokedAt: null }, now);
      });

      const exchange = Effect.fn("CliAuthentication.exchange")(function* (
        input: ExchangeCliGrantType
      ) {
        const codeHash = yield* digestSecret(input.code);
        const challenge = yield* digestSecret(input.verifier);
        const now = yield* nowInstant;
        const [request] = yield* db
          .select()
          .from(cliAuthenticationRequests)
          .where(
            and(
              eq(cliAuthenticationRequests.codeHash, codeHash),
              eq(cliAuthenticationRequests.challenge, challenge),
              eq(cliAuthenticationRequests.grantToken, input.grantToken),
              isNotNull(cliAuthenticationRequests.approvedAt),
              isNull(cliAuthenticationRequests.consumedAt),
              gt(cliAuthenticationRequests.grantExpiresAt, now)
            )
          )
          .limit(1);
        if (!request) return yield* rejectedGrant;

        const accessToken = CliAccessToken.make(yield* makeSecret());
        const tokenHash = yield* digestSecret(accessToken);
        const sessionId = CliSessionId.make(yield* crypto.randomUUIDv7);

        const session = yield* db.transaction((tx) =>
          Effect.gen(function* () {
            yield* tx.insert(cliSessions).values({
              id: sessionId,
              tokenHash,
              clientName: request.clientName,
              cliVersion: request.cliVersion,
              buildTarget: request.buildTarget,
              createdAt: now,
              lastUsedAt: now,
            });

            const consumed = yield* tx
              .update(cliAuthenticationRequests)
              .set({
                consumedAt: now,
                grantToken: null,
                sessionId,
              })
              .where(
                and(
                  eq(cliAuthenticationRequests.codeHash, codeHash),
                  eq(cliAuthenticationRequests.challenge, challenge),
                  eq(cliAuthenticationRequests.grantToken, input.grantToken),
                  isNotNull(cliAuthenticationRequests.approvedAt),
                  isNull(cliAuthenticationRequests.consumedAt),
                  gt(cliAuthenticationRequests.grantExpiresAt, now)
                )
              )
              .returning();

            if (consumed.length === 0) return yield* rejectedGrant;
            return {
              id: sessionId,
              tokenHash,
              clientName: request.clientName,
              cliVersion: request.cliVersion,
              buildTarget: request.buildTarget,
              createdAt: now,
              lastUsedAt: now,
              revokedAt: null,
            } satisfies CliSessionRow;
          })
        );

        return { accessToken, session: toCliSession(session) };
      });

      const authenticateSession = Effect.fn(
        "CliAuthentication.authenticateSession"
      )(function* (authorization: string) {
        const token = readBearerToken(authorization);
        if (!token) return yield* unauthorizedSession;

        const tokenHash = yield* digestSecret(token);
        const [session] = yield* db
          .select()
          .from(cliSessions)
          .where(
            and(
              eq(cliSessions.tokenHash, tokenHash),
              isNull(cliSessions.revokedAt)
            )
          )
          .limit(1);
        if (!session) return yield* unauthorizedSession;

        const now = yield* nowInstant;
        const writeBefore = now.subtract({
          minutes: lastUsedWriteIntervalMinutes,
        });
        const [updated] = yield* db
          .update(cliSessions)
          .set({ lastUsedAt: now })
          .where(
            and(
              eq(cliSessions.id, session.id),
              isNull(cliSessions.revokedAt),
              lt(cliSessions.lastUsedAt, writeBefore)
            )
          )
          .returning();

        return toCliSession(updated ?? session);
      });

      const listSessions = Effect.fn("CliAuthentication.listSessions")(
        function* () {
          const rows = yield* db
            .select()
            .from(cliSessions)
            .orderBy(desc(cliSessions.createdAt));
          return rows.map((row) => ({
            ...toCliSession(row),
            revokedAt: row.revokedAt ? toIsoString(row.revokedAt) : null,
          }));
        }
      );

      const revoke = Effect.fn("CliAuthentication.revoke")(function* (
        sessionId: CliSessionIdType
      ) {
        const now = yield* nowInstant;
        const revoked = yield* db
          .update(cliSessions)
          .set({ revokedAt: now })
          .where(
            and(eq(cliSessions.id, sessionId), isNull(cliSessions.revokedAt))
          )
          .returning({ id: cliSessions.id });
        return revoked.length > 0;
      });

      const renameSession = Effect.fn("CliAuthentication.renameSession")(
        function* (input: {
          readonly sessionId: CliSessionIdType;
          readonly clientName: CliClientNameType;
        }) {
          const renamed = yield* db
            .update(cliSessions)
            .set({ clientName: input.clientName })
            .where(eq(cliSessions.id, input.sessionId))
            .returning({ id: cliSessions.id });
          return renamed.length > 0;
        }
      );

      return {
        start,
        status,
        exchange,
        authenticateSession,
        inspectApproval,
        approve,
        listSessions,
        revoke,
        renameSession,
      } satisfies ICliAuthentication;
    })
  );

  static Live = this.Default.pipe(
    Layer.provide(WorkspaceDatabase.Default),
    Layer.provide(NodeCrypto.layer)
  );
}

export class CliApprovalUnavailableError extends Data.TaggedError(
  "CliApprovalUnavailableError"
)<{ readonly message: string }> {}

const nowInstant = Clock.currentTimeMillis.pipe(
  Effect.map(Temporal.Instant.fromEpochMilliseconds)
);

const toIsoString = (instant: Temporal.Instant) =>
  instant.toString({ smallestUnit: "millisecond" });

const toCliSession = (row: CliSessionRow): CliSessionType => ({
  id: row.id,
  clientName: row.clientName,
  cliVersion: row.cliVersion,
  buildTarget: row.buildTarget,
  createdAt: toIsoString(row.createdAt),
  lastUsedAt: toIsoString(row.lastUsedAt),
});

const toAuthenticationStatus = (
  result: {
    readonly request: CliAuthenticationRequestRow;
    readonly revokedAt: Temporal.Instant | null;
  },
  now: Temporal.Instant
): CliAuthenticationStatusType => {
  const { request, revokedAt } = result;
  if (request.sessionId) {
    return { authStatus: revokedAt ? "revoked" : "granted" };
  }
  if (
    !request.approvedAt &&
    Temporal.Instant.compare(now, request.expiresAt) < 0
  ) {
    return {
      authStatus: "pending",
      expiresAt: toIsoString(request.expiresAt),
    };
  }
  const grantToken = Option.getOrUndefined(
    Schema.decodeUnknownOption(CliGrantToken)(request.grantToken)
  );
  if (
    request.approvedAt &&
    grantToken &&
    request.grantExpiresAt &&
    Temporal.Instant.compare(now, request.grantExpiresAt) < 0
  ) {
    return {
      authStatus: "approved",
      grantToken,
      expiresAt: toIsoString(request.grantExpiresAt),
    };
  }
  return { authStatus: "expired" };
};

const toApprovalRequest = (
  result: {
    readonly request: CliAuthenticationRequestRow;
    readonly revokedAt: Temporal.Instant | null;
  },
  now: Temporal.Instant
): CliApprovalRequest => ({
  id: result.request.id,
  clientName: result.request.clientName,
  cliVersion: result.request.cliVersion,
  buildTarget: result.request.buildTarget,
  createdAt: toIsoString(result.request.createdAt),
  expiresAt: toIsoString(result.request.expiresAt),
  state: toAuthenticationStatus(result, now).authStatus,
});

const readBearerToken = (authorization: string) => {
  const match = /^Bearer ([A-Za-z0-9_-]{43})$/i.exec(authorization);
  return match?.[1];
};

const rejectedGrant = Effect.fail(
  new CliGrantRejected({
    message: "The CLI authentication grant is invalid or has expired.",
  })
);

const unauthorizedSession = Effect.fail(
  new CliSessionUnauthorized({
    message: "The CLI session is invalid or has been revoked.",
  })
);
