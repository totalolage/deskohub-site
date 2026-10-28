import {
  AdministrationActorEmail,
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
  toAdministrationActorName,
} from "@deskohub/workspace-admin-api";
import { WORKSPACE_SITE_TIME_ZONE } from "@deskohub/workspace-admin-api/site-time-zone";
import { NodeCrypto } from "@effect/platform-node";
import { and, desc, eq, gt, isNotNull, isNull, lt, or } from "drizzle-orm";
import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import {
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
import { authUser } from "@/db/schema/auth";
import "@/shared/polyfills/temporal";
import type { CustomerAccountId } from "@/features/account/customer-account";
import type { CliAuthenticationRequestId } from "@/features/admin-cli/cli-identifiers";
import { administrationHref } from "@/features/administration/administration-href";
import type { AdministratorAccountActor } from "@/features/administrators/account-role";
import { AccountRoleGrants } from "@/features/administrators/backend/account-role-grants.service";
import { addCalendarDuration, currentInstant } from "@/shared/utils/temporal";
import { revokeCliSessions } from "./administration-cli-access";
import { type CliSessionLifetime, cliSessionLifetimeSchema } from "./contracts";

const authenticationLifetimeMinutes = 5;
const grantLifetimeMinutes = 5;
const lastUsedWriteIntervalMinutes = 5;

export type CliSessionAdministrationItem = CliSessionType & {
  readonly revokedAt: string | null;
  readonly status: "active" | "expired" | "revoked";
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
  /**
   * Accepts a bearer only while its session is unrevoked and unexpired and
   * its approving account still holds the administrator role and isn't
   * awaiting deletion. The grant is read on every call.
   */
  readonly authenticateSession: (
    authorization: string
  ) => Effect.Effect<
    CliSessionType,
    | EffectDrizzleQueryError
    | PlatformError.PlatformError
    | CliSessionUnauthorized
  >;
  /** The administrator account that approved an authenticated session. */
  readonly sessionAdministrator: (
    sessionId: CliSessionIdType
  ) => Effect.Effect<
    AdministratorAccountActor,
    EffectDrizzleQueryError | CliSessionUnauthorized
  >;
  readonly inspectApproval: (
    code: CliAuthenticationCodeType
  ) => Effect.Effect<
    CliApprovalRequest | null,
    EffectDrizzleQueryError | PlatformError.PlatformError
  >;
  readonly approve: (input: {
    readonly code: CliAuthenticationCodeType;
    readonly approvedBy: AdministratorAccountActor;
    readonly sessionLifetime: CliSessionLifetime;
  }) => Effect.Effect<
    CliApprovalRequest,
    | EffectDrizzleQueryError
    | PlatformError.PlatformError
    | SqlError
    | CliApprovalUnavailableError
  >;
  readonly listSessions: (
    owner: CustomerAccountId
  ) => Effect.Effect<
    ReadonlyArray<CliSessionAdministrationItem>,
    EffectDrizzleQueryError
  >;
  readonly revoke: (input: {
    readonly owner: CustomerAccountId;
    readonly sessionId: CliSessionIdType;
  }) => Effect.Effect<boolean, EffectDrizzleQueryError>;
  readonly renameSession: (input: {
    readonly owner: CustomerAccountId;
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
      const database = yield* WorkspaceDatabase;
      const { db, transaction } = yield* WorkspaceDatabase;
      const crypto = yield* Crypto.Crypto;
      const roleGrants = yield* AccountRoleGrants;
      const holdsAdministratorRole = (accountId: CustomerAccountId) =>
        roleGrants.has({ accountId, role: "administrator" });
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
            sessionExpiresAt: cliSessions.expiresAt,
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
        const now = yield* currentInstant;
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
          // The proxy opens this unprefixed CLI URL in the operator's language.
          approvalPath: `${administrationHref(
            "/[locale]/admin/cli/authenticate"
          )}?code=${encodeURIComponent(code)}`,
          expiresAt: toIsoString(expiresAt),
        };
      });

      const status = Effect.fn("CliAuthentication.status")(function* (
        code: CliAuthenticationCodeType
      ) {
        const result = yield* loadRequest(code);
        const now = yield* currentInstant;
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
          const now = yield* currentInstant;
          return result ? toApprovalRequest(result, now) : null;
        }
      );

      const approve = Effect.fn("CliAuthentication.approve")(function* (input: {
        readonly code: CliAuthenticationCodeType;
        readonly approvedBy: AdministratorAccountActor;
        readonly sessionLifetime: CliSessionLifetime;
      }) {
        const result = yield* loadRequest(input.code);
        const now = yield* currentInstant;
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
        const [approved] = yield* transaction(
          Effect.gen(function* () {
            // The lock makes a concurrent revoke wait and then withdraw this
            // grant token, or makes this approval see the grant gone.
            const approverHoldsRole = yield* roleGrants.lockHeld({
              accountId: input.approvedBy.accountId,
              role: "administrator",
            });
            if (!approverHoldsRole) {
              return yield* new CliApprovalUnavailableError({
                message: "The approving account isn't an administrator.",
              });
            }
            return yield* db
              .update(cliAuthenticationRequests)
              .set({
                approvedAt: now,
                approvedByAccountId: input.approvedBy.accountId,
                approvedByAccountEmail: input.approvedBy.email,
                grantToken: grantToken,
                grantExpiresAt,
                sessionExpiresAt: toSessionExpiry(input.sessionLifetime, now),
              })
              .where(
                and(
                  eq(cliAuthenticationRequests.id, result.request.id),
                  isNull(cliAuthenticationRequests.approvedAt),
                  gt(cliAuthenticationRequests.expiresAt, now)
                )
              )
              .returning();
          })
        );

        if (!approved) {
          const latest = yield* loadRequest(input.code);
          if (!latest) {
            return yield* new CliApprovalUnavailableError({
              message: "This authentication request is invalid or has expired.",
            });
          }
          return toApprovalRequest(latest, now);
        }

        return toApprovalRequest(
          { request: approved, revokedAt: null, sessionExpiresAt: null },
          now
        );
      });

      const exchange = Effect.fn("CliAuthentication.exchange")(function* (
        input: ExchangeCliGrantType
      ) {
        const codeHash = yield* digestSecret(input.code);
        const challenge = yield* digestSecret(input.verifier);
        const now = yield* currentInstant;
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

        // A request approved before accounts carries only a username.
        const { approvedByAccountId, approvedByAccountEmail } = request;
        if (approvedByAccountId === null || approvedByAccountEmail === null) {
          return yield* rejectedGrant;
        }

        const accessToken = CliAccessToken.make(yield* makeSecret());
        const tokenHash = yield* digestSecret(accessToken);
        const sessionId = CliSessionId.make(yield* crypto.randomUUIDv7);

        const session = yield* transaction(
          Effect.gen(function* () {
            // The lock makes a concurrent revoke wait for this session and
            // revoke it too, or makes this exchange see the grant gone.
            const approverHoldsRole = yield* roleGrants.lockHeld({
              accountId: approvedByAccountId,
              role: "administrator",
            });
            if (!approverHoldsRole) return yield* rejectedGrant;

            yield* db.insert(cliSessions).values({
              id: sessionId,
              approvedByAccountId,
              approvedByAccountEmail: approvedByAccountEmail,
              tokenHash,
              clientName: request.clientName,
              cliVersion: request.cliVersion,
              buildTarget: request.buildTarget,
              createdAt: now,
              lastUsedAt: now,
              expiresAt: request.sessionExpiresAt,
            });

            const consumed = yield* db
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
              approvedBy: null,
              approvedByAccountId,
              approvedByAccountEmail,
              tokenHash,
              clientName: request.clientName,
              cliVersion: request.cliVersion,
              buildTarget: request.buildTarget,
              createdAt: now,
              lastUsedAt: now,
              expiresAt: request.sessionExpiresAt,
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
        const now = yield* currentInstant;
        // The inner join drops sessions without an approving account.
        const [found] = yield* db
          .select({ session: cliSessions })
          .from(cliSessions)
          .innerJoin(authUser, eq(cliSessions.approvedByAccountId, authUser.id))
          .where(
            and(
              eq(cliSessions.tokenHash, tokenHash),
              isNull(cliSessions.revokedAt),
              unexpiredSession(now),
              isNull(authUser.deletionRequestedAt)
            )
          )
          .limit(1);
        if (!found) return yield* unauthorizedSession;
        const { session } = found;

        if (
          session.approvedByAccountId === null ||
          !(yield* holdsAdministratorRole(session.approvedByAccountId))
        ) {
          return yield* unauthorizedSession;
        }

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
              unexpiredSession(now),
              lt(cliSessions.lastUsedAt, writeBefore)
            )
          )
          .returning();

        return toCliSession(updated ?? session);
      });

      const sessionAdministrator = Effect.fn(
        "CliAuthentication.sessionAdministrator"
      )(function* (sessionId: CliSessionIdType) {
        const [session] = yield* db
          .select({
            accountId: cliSessions.approvedByAccountId,
            email: cliSessions.approvedByAccountEmail,
          })
          .from(cliSessions)
          .where(eq(cliSessions.id, sessionId))
          .limit(1);
        if (!session?.accountId || !session.email) {
          return yield* unauthorizedSession;
        }
        return {
          accountId: session.accountId,
          email: session.email,
        } satisfies AdministratorAccountActor;
      });

      const listSessions = Effect.fn("CliAuthentication.listSessions")(
        function* (owner: CustomerAccountId) {
          const now = yield* currentInstant;
          const rows = yield* db
            .select()
            .from(cliSessions)
            .where(eq(cliSessions.approvedByAccountId, owner))
            .orderBy(desc(cliSessions.createdAt));
          return rows.map((row) => ({
            ...toCliSession(row),
            revokedAt: row.revokedAt ? toIsoString(row.revokedAt) : null,
            status: toSessionStatus(row, now),
          }));
        }
      );

      const revoke = Effect.fn("CliAuthentication.revoke")(function* (input: {
        readonly owner: CustomerAccountId;
        readonly sessionId: CliSessionIdType;
      }) {
        const revoked = yield* revokeCliSessions(input).pipe(
          Effect.provideService(WorkspaceDatabase, database)
        );
        return revoked.length > 0;
      });

      const renameSession = Effect.fn("CliAuthentication.renameSession")(
        function* (input: {
          readonly owner: CustomerAccountId;
          readonly sessionId: CliSessionIdType;
          readonly clientName: CliClientNameType;
        }) {
          const renamed = yield* db
            .update(cliSessions)
            .set({ clientName: input.clientName })
            .where(
              and(
                eq(cliSessions.id, input.sessionId),
                eq(cliSessions.approvedByAccountId, input.owner)
              )
            )
            .returning({ id: cliSessions.id });
          return renamed.length > 0;
        }
      );

      return {
        start,
        status,
        exchange,
        authenticateSession,
        sessionAdministrator,
        inspectApproval,
        approve,
        listSessions,
        revoke,
        renameSession,
      } satisfies ICliAuthentication;
    })
  );

  static Live = this.Default.pipe(
    Layer.provide(
      Layer.mergeAll(
        WorkspaceDatabase.Default,
        NodeCrypto.layer,
        AccountRoleGrants.Live
      )
    )
  );
}

class CliApprovalUnavailableError extends Data.TaggedError(
  "CliApprovalUnavailableError"
)<{ readonly message: string }> {}

const toIsoString = (instant: Temporal.Instant) =>
  instant.toString({ smallestUnit: "millisecond" });

const unexpiredSession = (now: Temporal.Instant) =>
  or(isNull(cliSessions.expiresAt), gt(cliSessions.expiresAt, now));

const toSessionExpiry = (
  lifetime: CliSessionLifetime,
  approvedAt: Temporal.Instant
) =>
  cliSessionLifetimeSchema.match(lifetime, {
    Never: () => null,
    Duration: ({ amount, unit }) =>
      addCalendarDuration({
        instant: approvedAt,
        duration: { [unit]: amount },
        timeZone: WORKSPACE_SITE_TIME_ZONE,
      }),
  });

const toSessionStatus = (
  row: CliSessionRow,
  now: Temporal.Instant
): CliSessionAdministrationItem["status"] => {
  if (row.revokedAt) return "revoked";
  if (row.expiresAt && Temporal.Instant.compare(now, row.expiresAt) >= 0) {
    return "expired";
  }
  return "active";
};

const toSessionApprover = (accountEmail: string | null) => {
  if (accountEmail === null) return { approvedBy: null, approvedByEmail: null };
  const email = AdministrationActorEmail.make(accountEmail);
  return {
    approvedBy: toAdministrationActorName(email),
    approvedByEmail: email,
  };
};

const toCliSession = (row: CliSessionRow): CliSessionType => ({
  id: row.id,
  ...toSessionApprover(row.approvedByAccountEmail),
  clientName: row.clientName,
  cliVersion: row.cliVersion,
  buildTarget: row.buildTarget,
  createdAt: toIsoString(row.createdAt),
  lastUsedAt: toIsoString(row.lastUsedAt),
  expiresAt: row.expiresAt ? toIsoString(row.expiresAt) : null,
});

const toAuthenticationStatus = (
  result: {
    readonly request: CliAuthenticationRequestRow;
    readonly revokedAt: Temporal.Instant | null;
    readonly sessionExpiresAt: Temporal.Instant | null;
  },
  now: Temporal.Instant
): CliAuthenticationStatusType => {
  const { request, revokedAt, sessionExpiresAt } = result;
  if (request.sessionId) {
    if (revokedAt) return { authStatus: "revoked" };
    if (
      sessionExpiresAt &&
      Temporal.Instant.compare(now, sessionExpiresAt) >= 0
    ) {
      return { authStatus: "expired" };
    }
    return { authStatus: "granted" };
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
    readonly sessionExpiresAt: Temporal.Instant | null;
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
    message: "The CLI session is invalid, has expired, or has been revoked.",
  })
);
