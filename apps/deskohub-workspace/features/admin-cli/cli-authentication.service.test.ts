import "@/shared/testing/workspace-test-env";

import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import {
  AdministrationActorUsername,
  type AdministrationActorUsernameType,
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
import { makeConfiguredAdministratorsMock } from "@/shared/administrator/configured-administrators.service.mock";
import {
  connectWorkspacePostgresTestDatabase,
  type WorkspacePostgresTestDatabase,
} from "@/shared/testing/workspace-postgres-test-database.test-utils";
import { CliAuthentication } from "./cli-authentication.service";
import { type CliSessionLifetime, cliSessionLifetimeSchema } from "./contracts";

const postgresDatabase = await connectWorkspacePostgresTestDatabase();

const alice = AdministrationActorUsername.make("alice");
const bob = AdministrationActorUsername.make("bob");

const digestSecret = (secret: string) =>
  digestCliAuthenticationSecret(secret).pipe(Effect.provide(NodeCrypto.layer));

const newSecret = () =>
  makeCliAuthenticationSecret().pipe(Effect.provide(NodeCrypto.layer));

describe.skipIf(!postgresDatabase)(
  "CliAuthentication administrator ownership on Postgres",
  () => {
    const postgres = postgresDatabase as WorkspacePostgresTestDatabase;
    const configured: readonly AdministrationActorUsernameType[] = [alice, bob];
    const withoutAlice: readonly AdministrationActorUsernameType[] = [bob];
    let authentication: CliAuthentication["Service"];
    let authenticationWithoutAlice: CliAuthentication["Service"];
    const fixtureSessionIds: CliSessionId[] = [];
    const fixtureRequestIds: CliAuthenticationRequestId[] = [];
    const fixtureCodeHashes: string[] = [];

    beforeAll(async () => {
      const makeService = (
        usernames: readonly AdministrationActorUsernameType[]
      ) =>
        Effect.runPromise(
          Effect.gen(function* () {
            return yield* CliAuthentication;
          }).pipe(
            Effect.provide(
              CliAuthentication.Default.pipe(
                Layer.provide(
                  Layer.mergeAll(
                    postgres.layer,
                    NodeCrypto.layer,
                    makeConfiguredAdministratorsMock(usernames)
                  )
                )
              )
            )
          )
        );
      authentication = await makeService(configured);
      authenticationWithoutAlice = await makeService(withoutAlice);
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

    const insertSessionFixture = async (
      owner: AdministrationActorUsernameType
    ) => {
      const bearer = await Effect.runPromise(newSecret());
      const id = CliSessionId.make(crypto.randomUUID());
      await Effect.runPromise(
        postgres.db.insert(cliSessions).values({
          id,
          approvedBy: owner,
          tokenHash: await Effect.runPromise(digestSecret(bearer)),
          clientName: `${owner} CLI`,
          cliVersion: "1.0.0",
          buildTarget: "development",
          createdAt: Temporal.Instant.from("2026-08-10T10:00:00.000Z"),
          lastUsedAt: Temporal.Instant.from("2026-08-10T10:00:00.000Z"),
        })
      );
      fixtureSessionIds.push(id);
      return { bearer, id };
    };

    const insertApprovedGrantFixture = async (
      approvedBy: AdministrationActorUsernameType | null
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
          approvedBy,
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
      }>,
      service: CliAuthentication["Service"] = authentication
    ) =>
      service.exchange({
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

    test("lists, renames, and revokes only the exact owner's sessions", async () => {
      const aliceSession = await insertSessionFixture(alice);
      const bobSession = await insertSessionFixture(bob);

      const aliceSessions = await Effect.runPromise(
        authentication.listSessions(alice)
      );
      const bobSessions = await Effect.runPromise(
        authentication.listSessions(bob)
      );
      expect(aliceSessions.map((row) => row.id)).toEqual([aliceSession.id]);
      expect(bobSessions.map((row) => row.id)).toEqual([bobSession.id]);

      const foreignRename = await Effect.runPromise(
        authentication.renameSession({
          owner: bob,
          sessionId: aliceSession.id,
          clientName: "Hijacked label",
        })
      );
      expect(foreignRename).toBe(false);
      expect(
        (await Effect.runPromise(authentication.listSessions(alice)))[0]
          ?.clientName
      ).toBe(`${alice} CLI`);

      const foreignRevoke = await Effect.runPromise(
        authentication.revoke({ owner: bob, sessionId: aliceSession.id })
      );
      expect(foreignRevoke).toBe(false);
      const unknownRevoke = await Effect.runPromise(
        authentication.revoke({
          owner: alice,
          sessionId: CliSessionId.make(crypto.randomUUID()),
        })
      );
      expect(unknownRevoke).toBe(false);

      const selfRename = await Effect.runPromise(
        authentication.renameSession({
          owner: alice,
          sessionId: aliceSession.id,
          clientName: "Alice laptop",
        })
      );
      expect(selfRename).toBe(true);
      expect(
        (await Effect.runPromise(authentication.listSessions(alice)))[0]
          ?.clientName
      ).toBe("Alice laptop");

      const selfRevoke = await Effect.runPromise(
        authentication.revoke({ owner: alice, sessionId: aliceSession.id })
      );
      expect(selfRevoke).toBe(true);
      const repeatRevoke = await Effect.runPromise(
        authentication.revoke({ owner: alice, sessionId: aliceSession.id })
      );
      expect(repeatRevoke).toBe(false);
    });

    test("rejects a removed administrator's bearer before mutating last use and keeps same-username rotation valid", async () => {
      const fixture = await insertSessionFixture(alice);

      const removedError = await Effect.runPromise(
        Effect.flip(
          authenticationWithoutAlice.authenticateSession(
            `Bearer ${fixture.bearer}`
          )
        )
      );
      expect(removedError).toBeInstanceOf(CliSessionUnauthorized);
      const untouchedRow = await loadSessionRow(fixture.id);
      expect(
        untouchedRow?.lastUsedAt.equals(
          Temporal.Instant.from("2026-08-10T10:00:00.000Z")
        )
      ).toBe(true);

      const rotated = await Effect.runPromise(
        authentication.authenticateSession(`Bearer ${fixture.bearer}`)
      );
      expect(rotated.id).toBe(fixture.id);

      const malformedError = await Effect.runPromise(
        Effect.flip(
          authentication.authenticateSession("Bearer malformed-token")
        )
      );
      expect(malformedError).toBeInstanceOf(CliSessionUnauthorized);
    });

    test("rejects null, padded, malformed, and removed approvers at grant exchange before inserting a session", async () => {
      const sessionsBefore = await countSessions();

      const legacyGrant = await insertApprovedGrantFixture(null);
      const legacyError = await Effect.runPromise(
        Effect.flip(exchangeGrant(legacyGrant))
      );
      expect(legacyError).toBeInstanceOf(CliGrantRejected);
      expect(await countSessions()).toBe(sessionsBefore);

      const paddedGrant = await insertApprovedGrantFixture(
        ` ${alice} ` as AdministrationActorUsernameType
      );
      const paddedError = await Effect.runPromise(
        Effect.flip(exchangeGrant(paddedGrant))
      );
      expect(paddedError).toBeInstanceOf(CliGrantRejected);
      expect(await countSessions()).toBe(sessionsBefore);

      const malformedGrant = await insertApprovedGrantFixture(
        "   " as AdministrationActorUsernameType
      );
      const malformedError = await Effect.runPromise(
        Effect.flip(exchangeGrant(malformedGrant))
      );
      expect(malformedError).toBeInstanceOf(CliGrantRejected);
      expect(await countSessions()).toBe(sessionsBefore);

      const nonconformingGrant = await insertApprovedGrantFixture(
        AdministrationActorUsername.make("Alice!")
      );
      const nonconformingError = await Effect.runPromise(
        Effect.flip(exchangeGrant(nonconformingGrant))
      );
      expect(nonconformingError).toBeInstanceOf(CliGrantRejected);
      expect(await countSessions()).toBe(sessionsBefore);

      const removedGrant = await insertApprovedGrantFixture(alice);
      const removedError = await Effect.runPromise(
        Effect.flip(exchangeGrant(removedGrant, authenticationWithoutAlice))
      );
      expect(removedError).toBeInstanceOf(CliGrantRejected);
      expect(await countSessions()).toBe(sessionsBefore);

      const configuredGrant = await insertApprovedGrantFixture(alice);
      const granted = await Effect.runPromise(exchangeGrant(configuredGrant));
      fixtureSessionIds.push(granted.session.id);
      expect(granted.session.approvedBy).toBe(alice);
      expect(await countSessions()).toBe(sessionsBefore + 1);
    });

    test("attributes exchanged sessions to the approving administrator and keeps the flow owner-scoped", async () => {
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
      fixtureCodeHashes.push(
        await Effect.runPromise(digestSecret(started.code))
      );

      const approved = await Effect.runPromise(
        authentication.approve({
          approvedBy: alice,
          code: started.code,
          sessionLifetime: cliSessionLifetimeSchema.cases.Never.make({}),
        })
      );
      expect(approved.state).toBe("approved");

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
      expect(granted.session.approvedBy).toBe(alice);

      const aliceSessions = await Effect.runPromise(
        authentication.listSessions(alice)
      );
      expect(aliceSessions.map((row) => row.id)).toContain(granted.session.id);
      const bobSessions = await Effect.runPromise(
        authentication.listSessions(bob)
      );
      expect(bobSessions.map((row) => row.id)).not.toContain(
        granted.session.id
      );

      const authenticated = await Effect.runPromise(
        authentication.authenticateSession(`Bearer ${granted.accessToken}`)
      );
      expect(authenticated.id).toBe(granted.session.id);
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
        authentication.listSessions(alice)
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
