import "@/shared/testing/workspace-test-env";

import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
} from "bun:test";
import {
  AdministrationLegacyUsername,
  CliAuthenticationChallenge,
  CliAuthenticationCode,
  type CliAuthenticationCodeType,
  CliAuthenticationVerifier,
  CliGrantRejected,
  CliGrantToken,
  CliSessionId,
  CliSessionUnauthorized,
  digestCliAuthenticationSecret,
  makeCliAuthenticationChallenge,
  makeCliAuthenticationSecret,
  makeCliAuthenticationVerifier,
} from "@deskohub/workspace-admin-api";
import { NodeCrypto } from "@effect/platform-node";
import { eq, inArray } from "drizzle-orm";
import { Effect, Layer } from "effect";
import { TestClock } from "effect/testing";
import { cliAuthenticationRequests, cliSessions } from "@/db/schema";
import type { CliAuthenticationRequestId } from "@/features/admin-cli/cli-identifiers";
import { cliAuthenticationRequestIdSchema } from "@/features/admin-cli/cli-identifiers";
import type { AdministratorAccountActor } from "@/features/administrators/account-role";
import { AccountRoleGrants } from "@/features/administrators/backend/account-role-grants.service";
import {
  connectWorkspacePostgresTestDatabase,
  type WorkspacePostgresTestDatabase,
} from "@/shared/testing/workspace-postgres-test-database.test-utils";
import {
  deleteTestAccounts,
  insertTestAccount,
  insertTestAdministrator,
} from "@/shared/testing/workspace-test-accounts.test-utils";
import { CliAuthentication } from "./cli-authentication.service";
import { type CliSessionLifetime, cliSessionLifetimeSchema } from "./contracts";

const postgresDatabase = await connectWorkspacePostgresTestDatabase();

const legacyUsername = AdministrationLegacyUsername.make("legacy-admin");

const digestSecret = (secret: string) =>
  digestCliAuthenticationSecret(secret).pipe(Effect.provide(NodeCrypto.layer));

const newSecret = () =>
  makeCliAuthenticationSecret().pipe(Effect.provide(NodeCrypto.layer));

describe.skipIf(!postgresDatabase)(
  "CliAuthentication administrator accounts on Postgres",
  () => {
    const postgres = postgresDatabase as WorkspacePostgresTestDatabase;
    let authentication: CliAuthentication["Service"];
    let grants: AccountRoleGrants["Service"];
    let alice: AdministratorAccountActor;
    let bob: AdministratorAccountActor;
    const fixtureAccounts: AdministratorAccountActor[] = [];
    const fixtureSessionIds: CliSessionId[] = [];
    const fixtureRequestIds: CliAuthenticationRequestId[] = [];
    const fixtureCodeHashes: string[] = [];

    beforeAll(async () => {
      const services = await Effect.runPromise(
        Effect.all({
          authentication: CliAuthentication,
          grants: AccountRoleGrants,
        }).pipe(
          Effect.provide(
            CliAuthentication.Default.pipe(
              Layer.provideMerge(
                AccountRoleGrants.Default.pipe(Layer.provide(postgres.layer))
              ),
              Layer.provide(Layer.merge(postgres.layer, NodeCrypto.layer))
            )
          )
        )
      );
      authentication = services.authentication;
      grants = services.grants;
      alice = await insertTestAdministrator(postgres, "cli-alice");
      bob = await insertTestAdministrator(postgres, "cli-bob");
      fixtureAccounts.push(alice, bob);
    });

    afterEach(async () => {
      const requestIds = [...fixtureRequestIds];
      const codeHashes = [...fixtureCodeHashes];
      const sessionIds = [...fixtureSessionIds];
      fixtureRequestIds.length = 0;
      fixtureCodeHashes.length = 0;
      fixtureSessionIds.length = 0;
      if (requestIds.length > 0) {
        await Effect.runPromise(
          postgres.db
            .delete(cliAuthenticationRequests)
            .where(inArray(cliAuthenticationRequests.id, requestIds))
        );
      }
      if (codeHashes.length > 0) {
        await Effect.runPromise(
          postgres.db
            .delete(cliAuthenticationRequests)
            .where(inArray(cliAuthenticationRequests.codeHash, codeHashes))
        );
      }
      if (sessionIds.length > 0) {
        await Effect.runPromise(
          postgres.db
            .delete(cliSessions)
            .where(inArray(cliSessions.id, sessionIds))
        );
      }
    });

    afterAll(() => deleteTestAccounts(postgres, fixtureAccounts));

    const insertAdministrator = async (label: string) => {
      const administrator = await insertTestAdministrator(postgres, label);
      fixtureAccounts.push(administrator);
      return administrator;
    };

    /** A session approved by `owner`, or a legacy Basic-auth one. */
    const insertSessionFixture = async (
      owner: AdministratorAccountActor | "legacy"
    ) => {
      const bearer = await Effect.runPromise(newSecret());
      const id = CliSessionId.make(crypto.randomUUID());
      await Effect.runPromise(
        postgres.db.insert(cliSessions).values({
          id,
          ...(owner === "legacy"
            ? { approvedBy: legacyUsername }
            : {
                approvedByAccountId: owner.accountId,
                approvedByAccountEmail: owner.email,
              }),
          tokenHash: await Effect.runPromise(digestSecret(bearer)),
          clientName: "Fixture CLI",
          cliVersion: "1.0.0",
          buildTarget: "development",
          createdAt: Temporal.Instant.from("2026-08-10T10:00:00.000Z"),
          lastUsedAt: Temporal.Instant.from("2026-08-10T10:00:00.000Z"),
        })
      );
      fixtureSessionIds.push(id);
      return { bearer, id };
    };

    /** A request approved by `approver`, or by a legacy Basic-auth user. */
    const insertApprovedGrantFixture = async (
      approver: AdministratorAccountActor | "legacy"
    ) => {
      const code = await Effect.runPromise(newSecret());
      const verifier = await Effect.runPromise(newSecret());
      const grantToken = await Effect.runPromise(newSecret());
      const id = cliAuthenticationRequestIdSchema.make(crypto.randomUUID());
      await Effect.runPromise(
        postgres.db.insert(cliAuthenticationRequests).values({
          id,
          codeHash: await Effect.runPromise(digestSecret(code)),
          challenge: await Effect.runPromise(digestSecret(verifier)),
          clientName: "Grant fixture CLI",
          cliVersion: "1.0.0",
          buildTarget: "development",
          createdAt: Temporal.Instant.from("2026-08-10T10:00:00.000Z"),
          expiresAt: Temporal.Instant.from("2026-08-10T10:05:00.000Z"),
          approvedAt: Temporal.Instant.from("2026-08-10T10:01:00.000Z"),
          ...(approver === "legacy"
            ? { approvedBy: legacyUsername }
            : {
                approvedByAccountId: approver.accountId,
                approvedByAccountEmail: approver.email,
              }),
          grantToken,
          grantExpiresAt: Temporal.Now.instant().add({ hours: 1 }),
        })
      );
      fixtureRequestIds.push(id);
      return { code, grantToken, verifier };
    };

    const exchangeGrant = (
      grant: Readonly<{
        code: string;
        grantToken: string;
        verifier: string;
      }>
    ) =>
      authentication.exchange({
        code: CliAuthenticationCode.make(grant.code),
        grantToken: CliGrantToken.make(grant.grantToken),
        verifier: CliAuthenticationVerifier.make(grant.verifier),
      });

    const loadSessionRow = async (id: CliSessionId) => {
      const [row] = await Effect.runPromise(
        postgres.db
          .select()
          .from(cliSessions)
          .where(eq(cliSessions.id, id))
          .limit(1)
      );
      return row ?? null;
    };

    const countSessions = async () => {
      const rows = await Effect.runPromise(
        postgres.db.select({ id: cliSessions.id }).from(cliSessions)
      );
      return rows.length;
    };

    const authenticateBearer = (bearer: string) =>
      Effect.runPromise(
        Effect.result(authentication.authenticateSession(`Bearer ${bearer}`))
      );

    test("lists, renames, and revokes only the owning account's sessions", async () => {
      const aliceSession = await insertSessionFixture(alice);
      const bobSession = await insertSessionFixture(bob);

      const aliceSessions = await Effect.runPromise(
        authentication.listSessions(alice.accountId)
      );
      const bobSessions = await Effect.runPromise(
        authentication.listSessions(bob.accountId)
      );
      expect(aliceSessions.map((row) => row.id)).toEqual([aliceSession.id]);
      expect(aliceSessions[0]?.approvedBy).toBe(alice.email);
      expect(aliceSessions[0]?.approvedByEmail).toBe(alice.email);
      expect(bobSessions.map((row) => row.id)).toEqual([bobSession.id]);

      const foreignRename = await Effect.runPromise(
        authentication.renameSession({
          owner: bob.accountId,
          sessionId: aliceSession.id,
          clientName: "Hijacked label",
        })
      );
      expect(foreignRename).toBe(false);
      expect(
        (
          await Effect.runPromise(authentication.listSessions(alice.accountId))
        )[0]?.clientName
      ).toBe("Fixture CLI");

      const foreignRevoke = await Effect.runPromise(
        authentication.revoke({
          owner: bob.accountId,
          sessionId: aliceSession.id,
        })
      );
      expect(foreignRevoke).toBe(false);
      const unknownRevoke = await Effect.runPromise(
        authentication.revoke({
          owner: alice.accountId,
          sessionId: CliSessionId.make(crypto.randomUUID()),
        })
      );
      expect(unknownRevoke).toBe(false);

      const selfRename = await Effect.runPromise(
        authentication.renameSession({
          owner: alice.accountId,
          sessionId: aliceSession.id,
          clientName: "Alice laptop",
        })
      );
      expect(selfRename).toBe(true);
      expect(
        (
          await Effect.runPromise(authentication.listSessions(alice.accountId))
        )[0]?.clientName
      ).toBe("Alice laptop");

      const selfRevoke = await Effect.runPromise(
        authentication.revoke({
          owner: alice.accountId,
          sessionId: aliceSession.id,
        })
      );
      expect(selfRevoke).toBe(true);
      const repeatRevoke = await Effect.runPromise(
        authentication.revoke({
          owner: alice.accountId,
          sessionId: aliceSession.id,
        })
      );
      expect(repeatRevoke).toBe(false);
    });

    test("rejects a legacy session without an approving account before touching last use", async () => {
      const fixture = await insertSessionFixture("legacy");

      const result = await authenticateBearer(fixture.bearer);

      expect(result._tag).toBe("Failure");
      if (result._tag === "Failure") {
        expect(result.failure).toBeInstanceOf(CliSessionUnauthorized);
      }
      expect(
        (await loadSessionRow(fixture.id))?.lastUsedAt.equals(
          Temporal.Instant.from("2026-08-10T10:00:00.000Z")
        )
      ).toBe(true);
    });

    test("rejects a bearer on the next request after its approver loses the grant", async () => {
      const carol = await insertAdministrator("cli-carol");
      const fixture = await insertSessionFixture(carol);

      const accepted = await authenticateBearer(fixture.bearer);
      expect(accepted._tag).toBe("Success");
      expect(
        await Effect.runPromise(authentication.sessionAdministrator(fixture.id))
      ).toEqual(carol);

      await Effect.runPromise(
        grants.revoke({ accountId: carol.accountId, role: "administrator" })
      );
      const revoked = await authenticateBearer(fixture.bearer);
      expect(revoked._tag).toBe("Failure");
      if (revoked._tag === "Failure") {
        expect(revoked.failure).toBeInstanceOf(CliSessionUnauthorized);
      }

      await Effect.runPromise(
        grants.grant({
          accountId: carol.accountId,
          role: "administrator",
          grantedBy: alice.accountId,
        })
      );
      expect((await authenticateBearer(fixture.bearer))._tag).toBe("Success");

      const malformed = await Effect.runPromise(
        Effect.flip(
          authentication.authenticateSession("Bearer malformed-token")
        )
      );
      expect(malformed).toBeInstanceOf(CliSessionUnauthorized);
    });

    test("rejects a bearer whose approving account awaits deletion or was deleted", async () => {
      const dana = await insertAdministrator("cli-dana");
      const fixture = await insertSessionFixture(dana);
      expect((await authenticateBearer(fixture.bearer))._tag).toBe("Success");

      await postgres.pool.query(
        `update auth."user" set deletion_requested_at = now() where id = $1`,
        [dana.accountId]
      );
      expect((await authenticateBearer(fixture.bearer))._tag).toBe("Failure");

      await deleteTestAccounts(postgres, [dana]);
      const orphaned = await loadSessionRow(fixture.id);
      expect(orphaned?.approvedByAccountId).toBeNull();
      expect(orphaned?.approvedByAccountEmail).toBe(dana.email);
      expect((await authenticateBearer(fixture.bearer))._tag).toBe("Failure");
      const orphanedAdministrator = await Effect.runPromise(
        Effect.flip(authentication.sessionAdministrator(fixture.id))
      );
      expect(orphanedAdministrator).toBeInstanceOf(CliSessionUnauthorized);
    });

    test("rejects legacy and no-longer-granted approvers at grant exchange before inserting a session", async () => {
      const sessionsBefore = await countSessions();

      const legacyError = await Effect.runPromise(
        Effect.flip(exchangeGrant(await insertApprovedGrantFixture("legacy")))
      );
      expect(legacyError).toBeInstanceOf(CliGrantRejected);
      expect(await countSessions()).toBe(sessionsBefore);

      const signedInOnly = await insertTestAccount(postgres, "cli-not-admin");
      fixtureAccounts.push(signedInOnly);
      const ungrantedError = await Effect.runPromise(
        Effect.flip(
          exchangeGrant(await insertApprovedGrantFixture(signedInOnly))
        )
      );
      expect(ungrantedError).toBeInstanceOf(CliGrantRejected);
      expect(await countSessions()).toBe(sessionsBefore);

      const granted = await Effect.runPromise(
        exchangeGrant(await insertApprovedGrantFixture(alice))
      );
      fixtureSessionIds.push(granted.session.id);
      expect(granted.session.approvedBy).toBe(alice.email);
      expect(granted.session.approvedByEmail).toBe(alice.email);
      expect(await countSessions()).toBe(sessionsBefore + 1);
      const row = await loadSessionRow(granted.session.id);
      expect(row).toMatchObject({
        approvedBy: null,
        approvedByAccountId: alice.accountId,
        approvedByAccountEmail: alice.email,
      });
    });

    test("records the approving account on the request and attributes the exchanged session to it", async () => {
      const verifier = await Effect.runPromise(
        makeCliAuthenticationVerifier.pipe(Effect.provide(NodeCrypto.layer))
      );
      const challenge = await Effect.runPromise(
        makeCliAuthenticationChallenge(verifier).pipe(
          Effect.provide(NodeCrypto.layer)
        )
      );
      const started = await Effect.runPromise(
        authentication.start({
          challenge,
          clientName: "Flow CLI",
          cliVersion: "1.0.0",
          buildTarget: "development",
        })
      );
      const codeHash = await Effect.runPromise(digestSecret(started.code));
      fixtureCodeHashes.push(codeHash);

      const approved = await Effect.runPromise(
        authentication.approve({
          approvedBy: alice,
          code: started.code,
          sessionLifetime: cliSessionLifetimeSchema.cases.Never.make({}),
        })
      );
      expect(approved.state).toBe("approved");
      const [request] = await Effect.runPromise(
        postgres.db
          .select()
          .from(cliAuthenticationRequests)
          .where(eq(cliAuthenticationRequests.codeHash, codeHash))
      );
      expect(request).toMatchObject({
        approvedBy: null,
        approvedByAccountId: alice.accountId,
        approvedByAccountEmail: alice.email,
      });

      const status = await Effect.runPromise(
        authentication.status(started.code)
      );
      expect(status.authStatus).toBe("approved");
      if (status.authStatus !== "approved") return;

      const granted = await Effect.runPromise(
        exchangeGrant({
          code: started.code,
          grantToken: status.grantToken,
          verifier,
        })
      );
      fixtureSessionIds.push(granted.session.id);
      expect(granted.session.approvedBy).toBe(alice.email);
      expect(granted.session.approvedByEmail).toBe(alice.email);

      const aliceSessions = await Effect.runPromise(
        authentication.listSessions(alice.accountId)
      );
      expect(aliceSessions.map((row) => row.id)).toContain(granted.session.id);
      const bobSessions = await Effect.runPromise(
        authentication.listSessions(bob.accountId)
      );
      expect(bobSessions.map((row) => row.id)).not.toContain(
        granted.session.id
      );

      const authenticated = await Effect.runPromise(
        authentication.authenticateSession(`Bearer ${granted.accessToken}`)
      );
      expect(authenticated.id).toBe(granted.session.id);
      expect(authenticated.approvedBy).toBe(alice.email);
      expect(authenticated.approvedByEmail).toBe(alice.email);
    });

    const authenticateThroughApproval = async (
      sessionLifetime: CliSessionLifetime
    ) => {
      const verifier = await Effect.runPromise(
        makeCliAuthenticationVerifier.pipe(Effect.provide(NodeCrypto.layer))
      );
      const challenge = await Effect.runPromise(
        makeCliAuthenticationChallenge(verifier).pipe(
          Effect.provide(NodeCrypto.layer)
        )
      );
      const started = await Effect.runPromise(
        authentication.start({
          challenge,
          clientName: "Expiring CLI",
          cliVersion: "1.0.0",
          buildTarget: "development",
        })
      );
      fixtureCodeHashes.push(
        await Effect.runPromise(digestSecret(started.code))
      );
      await Effect.runPromise(
        authentication.approve({
          approvedBy: alice,
          code: started.code,
          sessionLifetime,
        })
      );
      const status = await Effect.runPromise(
        authentication.status(started.code)
      );
      if (status.authStatus !== "approved") {
        throw new Error(`Unexpected status ${status.authStatus}`);
      }
      const granted = await Effect.runPromise(
        exchangeGrant({
          code: started.code,
          grantToken: status.grantToken,
          verifier,
        })
      );
      fixtureSessionIds.push(granted.session.id);
      return { code: started.code, granted };
    };

    test("issues sessions that never expire when approved without a lifetime", async () => {
      const { granted } = await authenticateThroughApproval(
        cliSessionLifetimeSchema.cases.Never.make({})
      );

      expect(granted.session.expiresAt).toBeNull();
      expect((await loadSessionRow(granted.session.id))?.expiresAt).toBeNull();
    });

    // 24 Oct 14:00 CEST plus one month crosses the 25 Oct switch to CET and
    // keeps the local wall-clock time; 31 Oct plus one month clamps to the
    // last day of November.
    test.each([
      ["2026-10-24T12:00:00.000Z", "2026-11-24T13:00:00Z"],
      ["2026-10-31T12:00:00.000Z", "2026-11-30T12:00:00Z"],
    ])(
      "expires sessions one Prague calendar month after approval at %s",
      async (approvedAtIso, expectedExpiry) => {
        const approvedAt = Temporal.Instant.from(approvedAtIso);
        const lifetime = cliSessionLifetimeSchema.cases.Duration.make({
          amount: 1,
          unit: "months",
        });
        const approve = (code: CliAuthenticationCodeType) =>
          Effect.gen(function* () {
            yield* TestClock.setTime(approvedAt.epochMilliseconds);
            return yield* authentication.approve({
              approvedBy: alice,
              code,
              sessionLifetime: lifetime,
            });
          }).pipe(Effect.provide(TestClock.layer()));
        const started = await Effect.runPromise(
          authentication.start({
            challenge: CliAuthenticationChallenge.make(
              await Effect.runPromise(newSecret())
            ),
            clientName: "Calendar CLI",
            cliVersion: "1.0.0",
            buildTarget: "development",
          })
        );
        fixtureCodeHashes.push(
          await Effect.runPromise(digestSecret(started.code))
        );
        await Effect.runPromise(
          postgres.db
            .update(cliAuthenticationRequests)
            .set({
              createdAt: approvedAt.subtract({ minutes: 1 }),
              expiresAt: approvedAt.add({ minutes: 4 }),
            })
            .where(
              eq(
                cliAuthenticationRequests.codeHash,
                await Effect.runPromise(digestSecret(started.code))
              )
            )
        );
        await Effect.runPromise(approve(started.code));

        const [request] = await Effect.runPromise(
          postgres.db
            .select()
            .from(cliAuthenticationRequests)
            .where(
              eq(
                cliAuthenticationRequests.codeHash,
                await Effect.runPromise(digestSecret(started.code))
              )
            )
        );
        expect(request?.sessionExpiresAt?.toString()).toBe(expectedExpiry);
      }
    );

    test("rejects a session whose expiry has passed and reports it as expired", async () => {
      const approvedNoEarlierThan = Temporal.Instant.fromEpochMilliseconds(
        Date.now()
      );
      const { code, granted } = await authenticateThroughApproval(
        cliSessionLifetimeSchema.cases.Duration.make({
          amount: 1,
          unit: "hours",
        })
      );
      const bearer = `Bearer ${granted.accessToken}`;
      const now = Temporal.Instant.fromEpochMilliseconds(Date.now());
      const expiresAt = Temporal.Instant.from(granted.session.expiresAt ?? "");
      expect(
        Temporal.Instant.compare(
          expiresAt,
          approvedNoEarlierThan.add({ hours: 1 })
        )
      ).toBeGreaterThanOrEqual(0);
      expect(
        Temporal.Instant.compare(expiresAt, now.add({ hours: 1 }))
      ).toBeLessThanOrEqual(0);

      const active = await Effect.runPromise(
        authentication.authenticateSession(bearer)
      );
      expect(active.id).toBe(granted.session.id);

      await Effect.runPromise(
        postgres.db
          .update(cliSessions)
          .set({
            createdAt: now.subtract({ hours: 2 }),
            lastUsedAt: now.subtract({ hours: 2 }),
            expiresAt: now.subtract({ seconds: 1 }),
          })
          .where(eq(cliSessions.id, granted.session.id))
      );

      const expiredError = await Effect.runPromise(
        Effect.flip(authentication.authenticateSession(bearer))
      );
      expect(expiredError).toBeInstanceOf(CliSessionUnauthorized);
      expect(
        (await loadSessionRow(granted.session.id))?.lastUsedAt.equals(
          now.subtract({ hours: 2 })
        )
      ).toBe(true);

      const listed = await Effect.runPromise(
        authentication.listSessions(alice.accountId)
      );
      expect(
        listed.find((session) => session.id === granted.session.id)?.status
      ).toBe("expired");
      expect(
        (await Effect.runPromise(authentication.status(code))).authStatus
      ).toBe("expired");
    });
  }
);
