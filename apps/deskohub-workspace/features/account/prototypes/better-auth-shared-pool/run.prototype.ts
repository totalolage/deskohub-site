/**
 * THROWAWAY PROTOTYPE. Run only against a disposable PostgreSQL database:
 * DATABASE_URL=... bun features/account/prototypes/better-auth-shared-pool/run.prototype.ts
 */
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { Effect } from "effect";
import { makeDatabaseClient } from "@/db/database-client";
import { session, user, verification } from "@/db/schema/better-auth.prototype";
import {
  auth,
  prototypePool,
  prototypePromiseDatabase,
  takePrototypeMagicLink,
} from "./auth.prototype";

const originHeaders = new Headers({ origin: "http://localhost:3000" });
const email = "better-auth-shared-pool-346@example.test";

const run = async () => {
  assert.equal(prototypePromiseDatabase.$client, prototypePool);

  try {
    await auth.api.signInMagicLink({
      headers: originHeaders,
      body: { email, name: "Shared Pool Prototype" },
    });

    const issuedLink = new URL(takePrototypeMagicLink());
    const response = await auth.handler(
      new Request(issuedLink, { headers: originHeaders, redirect: "manual" })
    );
    assert.equal(response.status, 302);

    const cookie = response.headers.get("set-cookie");
    assert.ok(cookie, "verification must issue a session cookie");

    const currentSession = await auth.api.getSession({
      headers: new Headers({ cookie }),
    });
    assert.equal(currentSession?.user.email, email);

    const sessionRows = await prototypePromiseDatabase
      .select()
      .from(session)
      .where(eq(session.userId, currentSession.user.id));
    assert.equal(sessionRows.length, 1);
    assert.ok(sessionRows[0]?.expiresAt instanceof Date);

    const rawTimestamp = await prototypePool.query<{ value: unknown }>(
      "select now()::timestamp as value"
    );
    assert.equal(typeof rawTimestamp.rows[0]?.value, "string");

    const effectDatabase = await Effect.runPromise(
      makeDatabaseClient(prototypePool)
    );
    const effectRows = await Effect.runPromise(
      effectDatabase.select().from(user).where(eq(user.email, email))
    );
    assert.equal(effectRows.length, 1);
    assert.equal(effectRows[0]?.id, currentSession.user.id);

    const rollbackEmail = "better-auth-rollback-346@example.test";
    await assert.rejects(
      prototypePromiseDatabase.transaction(async (transaction) => {
        await transaction.insert(user).values({
          id: "rollback-prototype-user",
          name: "Rollback Prototype",
          email: rollbackEmail,
          emailVerified: true,
        });
        throw new Error("intentional rollback");
      }),
      /intentional rollback/
    );
    const rolledBack = await prototypePromiseDatabase
      .select()
      .from(user)
      .where(eq(user.email, rollbackEmail));
    assert.equal(rolledBack.length, 0);

    const expiredEmail = "better-auth-expired-346@example.test";
    await auth.api.signInMagicLink({
      headers: originHeaders,
      body: { email: expiredEmail, name: "Expired Link Prototype" },
    });
    const expiredLink = new URL(takePrototypeMagicLink());
    await prototypePromiseDatabase
      .update(verification)
      .set({ expiresAt: new Date(0) });
    const expiredResponse = await auth.handler(
      new Request(expiredLink, {
        headers: originHeaders,
        redirect: "manual",
      })
    );
    assert.equal(expiredResponse.status, 302);
    assert.equal(expiredResponse.headers.has("set-cookie"), false);
    const expiredUsers = await prototypePromiseDatabase
      .select()
      .from(user)
      .where(eq(user.email, expiredEmail));
    assert.equal(expiredUsers.length, 0);

    await auth.api.signOut({ headers: new Headers({ cookie }) });
    const revokedSession = await auth.api.getSession({
      headers: new Headers({ cookie }),
    });
    assert.equal(revokedSession, null);
    assert.ok(prototypePool.totalCount <= 2);

    console.log(
      "PASS: one pg.Pool served Better Auth's Promise Drizzle adapter and Workspace's Effect Drizzle client; raw timestamp strings decoded to Date, expired links failed, rollback held, and logout revoked the session."
    );
  } finally {
    await prototypePool.end();
  }
};

await run();
