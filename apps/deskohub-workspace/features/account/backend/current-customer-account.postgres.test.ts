import "@/shared/testing/workspace-test-env";

import { afterAll, describe, expect, test } from "bun:test";
import type { DotyposCustomerId } from "@deskohub/dotypos";
import { Cause, Effect, Exit, Layer } from "effect";
import { redirect } from "next/navigation";
import { WorkspaceDatabaseAdvisoryLock } from "@/db/postgres-advisory-lock";
import { reservationCustomerEmailSchema } from "@/features/reservation/reservation-contact";
import { ReviewAccounts } from "@/features/review-accounts";
import { ReviewAccountsMock } from "@/features/review-accounts/backend/review-accounts.repository.mock";
import { findNextControlFlow } from "@/shared/backend/workspace-effect";
import { workspaceFixtures } from "@/shared/testing/workspace-fixtures.test-utils";
import { createWorkspacePostgresSuiteDatabase } from "@/shared/testing/workspace-postgres-test-database.test-utils";
import {
  CustomerAccountAccessError,
  type CustomerAccountId,
  customerAccountUnavailable,
} from "../customer-account";
import { CurrentCustomerAccount } from "./current-customer-account";
import { CustomerAccountLinkRepository } from "./customer-account-link.repository";
import {
  CustomerAccountSections,
  HeldCustomerAccount,
} from "./customer-account-sections";
import {
  type CustomerAccountSession,
  CustomerAuthentication,
} from "./customer-authentication.service";
import { testSessionProfile } from "./customer-authentication.test-utils";
import {
  CustomerDotyposAdapter,
  type ExactEmailCustomerMatch,
} from "./customer-dotypos-adapter.service";

const suiteDatabase = await createWorkspacePostgresSuiteDatabase(
  "current_customer_account"
);

describe.skipIf(!suiteDatabase)(
  "CurrentCustomerAccount on disposable Postgres",
  () => {
    if (!suiteDatabase) return;
    const { pool, db } = suiteDatabase;

    afterAll(() => suiteDatabase.close());

    const uniqueDotyposId = () =>
      `${Math.floor(Math.random() * 900_000) + 100_000}${Math.floor(
        Math.random() * 900
      )}` as DotyposCustomerId;

    type Seeded = {
      readonly accountId: CustomerAccountId;
      readonly email: string;
    };

    const seedAccount = (
      options: {
        readonly deletionRequested?: boolean;
        readonly review?: boolean;
        readonly linkedCustomer?: DotyposCustomerId;
      } = {}
    ): Promise<Seeded> =>
      Effect.runPromise(
        workspaceFixtures(db).account("current-account", options)
      );

    /** The verified session of `account`, as Better Auth decodes it. */
    const sessionOf = (
      account: Seeded,
      options: { readonly deletionRequested?: boolean } = {}
    ): CustomerAccountSession => ({
      accountId: account.accountId,
      email: reservationCustomerEmailSchema.make(account.email),
      deletionRequested: options.deletionRequested ?? false,
      ...testSessionProfile,
    });

    /** What the faked session authority answers, one entry per read. */
    type SessionAnswer =
      | CustomerAccountSession
      | null
      | CustomerAccountAccessError;

    type Calls = {
      sessionReads: number;
      classify: string[];
      reactivate: DotyposCustomerId[];
    };

    /**
     * The real module over the real link repository, review marker, account
     * sections, and advisory lock on the disposable database. The session
     * authority and Dotypos are fakes: `sessions` answers each read in turn
     * (the last answer repeats), and `match` classifies the login email.
     */
    const makeCurrentAccount = (options: {
      readonly sessions: readonly SessionAnswer[];
      readonly match?: ExactEmailCustomerMatch;
      readonly reactivation?: Effect.Effect<void, never>;
      readonly reviewAccounts?: Layer.Layer<ReviewAccounts>;
      /** Stands in for the account sections the standing resolves in. */
      readonly sections?: Layer.Layer<CustomerAccountSections>;
    }) => {
      const calls: Calls = { sessionReads: 0, classify: [], reactivate: [] };
      const currentUser = Effect.suspend(() => {
        const answer =
          options.sessions[
            Math.min(calls.sessionReads, options.sessions.length - 1)
          ];
        calls.sessionReads += 1;
        return answer instanceof CustomerAccountAccessError
          ? Effect.fail(answer)
          : Effect.succeed(answer ?? null);
      });
      const authentication = Layer.succeed(CustomerAuthentication, {
        currentUser,
      });
      const links = CustomerAccountLinkRepository.Default.pipe(
        Layer.provide(suiteDatabase.layer)
      );
      const sections =
        options.sections ??
        CustomerAccountSections.Default.pipe(
          Layer.provide(
            Layer.mergeAll(
              authentication,
              links,
              WorkspaceDatabaseAdvisoryLock.makeLayer(pool)
            )
          )
        );
      const dotypos = Layer.mock(CustomerDotyposAdapter, {
        classifyExactEmailCustomers: (email) => {
          calls.classify.push(email);
          return Effect.succeed(options.match ?? { kind: "not-found" });
        },
        reactivateCustomer: (customerId) => {
          calls.reactivate.push(customerId);
          return options.reactivation ?? Effect.void;
        },
      });
      const layer = CurrentCustomerAccount.Default.pipe(
        Layer.provide(
          Layer.mergeAll(
            authentication,
            options.reviewAccounts ??
              ReviewAccounts.Default.pipe(Layer.provide(suiteDatabase.layer)),
            links,
            sections,
            dotypos
          )
        )
      );
      return { calls, layer, sections };
    };

    const currentAccount = Effect.service(CurrentCustomerAccount);

    const run = <A, E>(
      layer: Layer.Layer<CurrentCustomerAccount>,
      effect: Effect.Effect<A, E, CurrentCustomerAccount>
    ) => Effect.runPromise(effect.pipe(Effect.provide(layer)));

    const peek = (layer: Layer.Layer<CurrentCustomerAccount>) =>
      run(
        layer,
        Effect.flatMap(currentAccount, (account) => account.peek)
      );
    const resolve = (layer: Layer.Layer<CurrentCustomerAccount>) =>
      run(
        layer,
        Effect.flatMap(currentAccount, (account) => account.resolve)
      );
    const failureOf = <A>(
      layer: Layer.Layer<CurrentCustomerAccount>,
      effect: (
        account: CurrentCustomerAccount["Service"]
      ) => Effect.Effect<A, CustomerAccountAccessError>
    ) => run(layer, Effect.flip(Effect.flatMap(currentAccount, effect)));

    const storedLink = async (accountId: CustomerAccountId) =>
      (
        await pool.query<{ dotypos_customer_id: string | null }>(
          "select dotypos_customer_id from customer_accounts where id = $1",
          [accountId]
        )
      ).rows[0]?.dotypos_customer_id ?? null;

    /** Referral rows a claim could have written for the account. */
    const referralWrites = async (
      accountId: CustomerAccountId,
      customerId: DotyposCustomerId
    ) => {
      const intents = await pool.query<{ count: number }>(
        "select count(*)::int as count from referral_signup_intents where customer_account_id = $1",
        [accountId]
      );
      const attributions = await pool.query<{ count: number }>(
        "select count(*)::int as count from referral_attributions where invited_dotypos_customer_id = $1",
        [customerId]
      );
      return intents.rows[0]!.count + attributions.rows[0]!.count;
    };

    const failingReviewMarker = ReviewAccountsMock({
      isReviewAccount: () =>
        Effect.fail(new Error("review marker read failed")) as never,
    });

    describe("before the account is known", () => {
      test("no session is signed out for peek and resolve, with no marker, link, or Dotypos read", async () => {
        const { layer, calls } = makeCurrentAccount({
          sessions: [null],
          reviewAccounts: failingReviewMarker,
        });

        expect(await peek(layer)).toEqual({ kind: "signed-out" });
        expect(await resolve(layer)).toEqual({ kind: "signed-out" });
        expect(calls.classify).toEqual([]);
      });

      test("an unverified email is its own standing, not signed out", async () => {
        const { layer } = makeCurrentAccount({
          sessions: [
            new CustomerAccountAccessError({ reason: "unverified-email" }),
          ],
        });

        expect(await peek(layer)).toEqual({ kind: "unverified" });
        expect(await resolve(layer)).toEqual({ kind: "unverified" });
      });

      test("an unreadable or unconfigured session fails with its own reason", async () => {
        for (const error of [
          customerAccountUnavailable("authentication.session"),
          new CustomerAccountAccessError({ reason: "not-configured" }),
        ]) {
          const { layer } = makeCurrentAccount({ sessions: [error] });

          expect(await failureOf(layer, (account) => account.peek)).toBe(error);
          expect(await failureOf(layer, (account) => account.resolve)).toBe(
            error
          );
        }
      });
    });

    describe("deletion and review markers", () => {
      test("a deletion marker wins before any link or Dotypos work", async () => {
        const customerId = uniqueDotyposId();
        const account = await seedAccount({
          deletionRequested: true,
          linkedCustomer: customerId,
        });
        const session = sessionOf(account, { deletionRequested: true });
        const { layer, calls } = makeCurrentAccount({ sessions: [session] });

        const expected = {
          kind: "deletion-pending",
          session,
          reviewMarker: "absent",
        };
        expect(await peek(layer)).toEqual(expected);
        expect(await resolve(layer)).toEqual(expected);
        expect(calls.classify).toEqual([]);
        expect(calls.sessionReads).toBe(2);
      });

      test("a review account is reported before resolution and never reaches Dotypos", async () => {
        const account = await seedAccount({ review: true });
        const session = sessionOf(account);
        const { layer, calls } = makeCurrentAccount({ sessions: [session] });

        expect(await peek(layer)).toEqual({ kind: "review", session });
        expect(await resolve(layer)).toEqual({ kind: "review", session });
        expect(calls.classify).toEqual([]);
        expect(await storedLink(account.accountId)).toBeNull();
      });

      test("a review account awaiting deletion reads as pending deletion with its marker", async () => {
        const account = await seedAccount({
          review: true,
          deletionRequested: true,
        });
        const session = sessionOf(account, { deletionRequested: true });
        const { layer } = makeCurrentAccount({ sessions: [session] });

        expect(await resolve(layer)).toEqual({
          kind: "deletion-pending",
          session,
          reviewMarker: "present",
        });
      });

      test("an unreadable review marker is reported, and resolution still runs", async () => {
        const customerId = uniqueDotyposId();
        const linked = await seedAccount({ linkedCustomer: customerId });
        const unlinked = await seedAccount();
        const linkedSession = sessionOf(linked);
        const unlinkedSession = sessionOf(unlinked);

        const forLinked = makeCurrentAccount({
          sessions: [linkedSession],
          reviewAccounts: failingReviewMarker,
        });
        const linkedStanding = {
          kind: "linked",
          session: linkedSession,
          reviewMarker: "unreadable",
          account: {
            accountId: linked.accountId,
            dotyposCustomerId: customerId,
          },
          autoLinked: false,
        };
        expect(await peek(forLinked.layer)).toEqual(linkedStanding);
        expect(await resolve(forLinked.layer)).toEqual(linkedStanding);

        const forUnlinked = makeCurrentAccount({
          sessions: [unlinkedSession],
          reviewAccounts: failingReviewMarker,
        });
        expect(await peek(forUnlinked.layer)).toEqual({
          kind: "unlinked",
          session: unlinkedSession,
          reviewMarker: "unreadable",
        });
        // The held steps re-read the marker before asking Dotypos.
        const resolved = await resolve(forUnlinked.layer);
        expect(resolved.kind).toBe("unavailable");
        expect(forUnlinked.calls.classify).toEqual([]);
      });
    });

    describe("links", () => {
      test("a stored link is linked for peek and resolve without asking Dotypos", async () => {
        const customerId = uniqueDotyposId();
        const account = await seedAccount({ linkedCustomer: customerId });
        const session = sessionOf(account);
        const { layer, calls } = makeCurrentAccount({ sessions: [session] });

        const expected = {
          kind: "linked",
          session,
          reviewMarker: "absent",
          account: {
            accountId: account.accountId,
            dotyposCustomerId: customerId,
          },
          autoLinked: false,
        };
        expect(await peek(layer)).toEqual(expected);
        expect(await resolve(layer)).toEqual(expected);
        expect(calls.classify).toEqual([]);
      });

      test("peek reports an account without a stored link as unlinked and never asks Dotypos", async () => {
        const account = await seedAccount();
        const session = sessionOf(account);
        const { layer, calls } = makeCurrentAccount({
          sessions: [session],
          match: {
            kind: "matched",
            state: "active",
            customerId: uniqueDotyposId(),
          },
        });

        expect(await peek(layer)).toEqual({
          kind: "unlinked",
          session,
          reviewMarker: "absent",
        });
        expect(calls.classify).toEqual([]);
        expect(await storedLink(account.accountId)).toBeNull();
      });

      test("peek never enters the account section", async () => {
        const customerId = uniqueDotyposId();
        const linked = await seedAccount({ linkedCustomer: customerId });
        const unlinked = await seedAccount();
        // Any section entry would fail: the fake implements none.
        const noSections = Layer.mock(CustomerAccountSections, {});

        const forLinked = makeCurrentAccount({
          sessions: [sessionOf(linked)],
          sections: noSections,
        });
        expect((await peek(forLinked.layer)).kind).toBe("linked");

        const forUnlinked = makeCurrentAccount({
          sessions: [sessionOf(unlinked)],
          sections: noSections,
        });
        expect((await peek(forUnlinked.layer)).kind).toBe("unlinked");
      });

      test("resolve claims a unique active exact-email customer and writes no referral", async () => {
        const customerId = uniqueDotyposId();
        const account = await seedAccount();
        const session = sessionOf(account);
        const { layer, calls } = makeCurrentAccount({
          sessions: [session],
          match: { kind: "matched", state: "active", customerId },
        });

        expect(await resolve(layer)).toEqual({
          kind: "linked",
          session,
          reviewMarker: "absent",
          account: {
            accountId: account.accountId,
            dotyposCustomerId: customerId,
          },
          autoLinked: true,
        });
        expect(calls.classify).toEqual([account.email]);
        expect(calls.reactivate).toEqual([]);
        expect(await storedLink(account.accountId)).toBe(customerId);
        expect(await referralWrites(account.accountId, customerId)).toBe(0);

        // The next resolution finds the stored link.
        const again = makeCurrentAccount({ sessions: [session] });
        expect(await resolve(again.layer)).toMatchObject({
          kind: "linked",
          autoLinked: false,
        });
      });

      test("resolve reactivates an expired customer before it claims the link", async () => {
        const customerId = uniqueDotyposId();
        const account = await seedAccount();
        const session = sessionOf(account);
        const { layer, calls } = makeCurrentAccount({
          sessions: [session],
          match: { kind: "matched", state: "expired", customerId },
        });

        expect(await resolve(layer)).toMatchObject({
          kind: "linked",
          autoLinked: true,
        });
        expect(calls.reactivate).toEqual([customerId]);
        expect(await storedLink(account.accountId)).toBe(customerId);
        expect(await referralWrites(account.accountId, customerId)).toBe(0);
      });

      test("a failed reactivation leaves the link unclaimed and reports unavailable", async () => {
        const customerId = uniqueDotyposId();
        const account = await seedAccount();
        const session = sessionOf(account);
        const { layer } = makeCurrentAccount({
          sessions: [session],
          match: { kind: "matched", state: "expired", customerId },
          reactivation: Effect.fail(new Error("reactivation failed")) as never,
        });

        const resolved = await resolve(layer);
        expect(resolved).toMatchObject({
          kind: "unavailable",
          session,
          reviewMarker: "absent",
        });
        expect(
          resolved.kind === "unavailable" && resolved.failure.cause?.code
        ).toBe("dotypos.customer-expiration");
        expect(await storedLink(account.accountId)).toBeNull();
      });

      test("a resolution step that dies reports the unavailable lock with the session, and claims nothing", async () => {
        const customerId = uniqueDotyposId();
        const account = await seedAccount();
        const session = sessionOf(account);
        const { layer } = makeCurrentAccount({
          sessions: [session],
          match: { kind: "matched", state: "expired", customerId },
          reactivation: Effect.die(new Error("reactivation died")),
        });

        const resolved = await resolve(layer);
        expect(resolved).toMatchObject({
          kind: "unavailable",
          session,
          reviewMarker: "absent",
        });
        expect(
          resolved.kind === "unavailable" && resolved.failure.cause?.code
        ).toBe("account-link.lock");
        expect(await storedLink(account.accountId)).toBeNull();
      });

      test("Next.js control flow beside a resolution failure propagates instead of becoming a standing", async () => {
        const account = await seedAccount();
        const redirectError = Effect.runSync(
          Effect.flip(
            Effect.try({
              try: () => redirect("/target"),
              catch: (thrown) => thrown,
            })
          )
        );
        const { layer } = makeCurrentAccount({
          sessions: [sessionOf(account)],
          sections: Layer.mock(CustomerAccountSections, {
            withActiveAccount: () =>
              Effect.failCause(
                Cause.combine(
                  Cause.fail(customerAccountUnavailable("account-link.lock")),
                  Cause.die(redirectError)
                )
              ),
          }),
        });

        const exit = await Effect.runPromiseExit(
          currentAccount.pipe(
            Effect.flatMap((service) => service.resolve),
            Effect.provide(layer)
          )
        );
        expect(Exit.isFailure(exit) && findNextControlFlow(exit.cause)).toBe(
          redirectError
        );
        expect(await storedLink(account.accountId)).toBeNull();
      });

      test("an interrupted resolution is not answered as a standing", async () => {
        const account = await seedAccount();
        const { layer } = makeCurrentAccount({
          sessions: [sessionOf(account)],
          match: {
            kind: "matched",
            state: "expired",
            customerId: uniqueDotyposId(),
          },
          reactivation: Effect.interrupt,
        });

        const exit = await Effect.runPromiseExit(
          currentAccount.pipe(
            Effect.flatMap((service) => service.resolve),
            Effect.provide(layer)
          )
        );
        expect(Exit.hasInterrupts(exit)).toBe(true);
        expect(await storedLink(account.accountId)).toBeNull();
      });

      test("no matching customer is profile-missing, with nothing written", async () => {
        const account = await seedAccount();
        const session = sessionOf(account);
        const { layer } = makeCurrentAccount({ sessions: [session] });

        expect(await resolve(layer)).toEqual({
          kind: "profile-missing",
          session,
          reviewMarker: "absent",
        });
        expect(await storedLink(account.accountId)).toBeNull();
      });

      test("ambiguous and unusable customers need support, with nothing claimed or reactivated", async () => {
        for (const reason of ["ambiguous", "unusable"] as const) {
          const account = await seedAccount();
          const session = sessionOf(account);
          const { layer, calls } = makeCurrentAccount({
            sessions: [session],
            match: { kind: reason },
          });

          expect(await resolve(layer)).toEqual({
            kind: "support-required",
            reason,
            session,
            reviewMarker: "absent",
          });
          expect(calls.reactivate).toEqual([]);
          expect(await storedLink(account.accountId)).toBeNull();
        }
      });

      test("a customer another account holds needs support as claimed", async () => {
        const customerId = uniqueDotyposId();
        await seedAccount({ linkedCustomer: customerId });
        const account = await seedAccount();
        const session = sessionOf(account);
        const { layer } = makeCurrentAccount({
          sessions: [session],
          match: { kind: "matched", state: "active", customerId },
        });

        expect(await resolve(layer)).toEqual({
          kind: "support-required",
          reason: "claimed",
          session,
          reviewMarker: "absent",
        });
        expect(await storedLink(account.accountId)).toBeNull();
      });
    });

    describe("the locked recheck", () => {
      test("a session that ends while resolution waits for the lock is signed out", async () => {
        const account = await seedAccount();
        const { layer, calls } = makeCurrentAccount({
          sessions: [sessionOf(account), null],
          match: {
            kind: "matched",
            state: "active",
            customerId: uniqueDotyposId(),
          },
        });

        expect(await resolve(layer)).toEqual({ kind: "signed-out" });
        expect(calls.classify).toEqual([]);
        expect(await storedLink(account.accountId)).toBeNull();
      });

      test("a deletion marker found under the lock is unavailable with that refusal, not pending deletion", async () => {
        const account = await seedAccount({ deletionRequested: true });
        const session = sessionOf(account);
        const { layer, calls } = makeCurrentAccount({
          sessions: [session],
          match: {
            kind: "matched",
            state: "active",
            customerId: uniqueDotyposId(),
          },
        });

        const resolved = await resolve(layer);
        expect(resolved).toMatchObject({
          kind: "unavailable",
          session,
          reviewMarker: "absent",
        });
        expect(resolved.kind === "unavailable" && resolved.failure).toEqual(
          new CustomerAccountAccessError({
            reason: "link-required",
            linkReason: "deletion-requested",
          })
        );
        expect(calls.classify).toEqual([]);
        expect(await storedLink(account.accountId)).toBeNull();
      });

      test("an email the locked recheck finds unverified is unavailable with that refusal, not unverified", async () => {
        const account = await seedAccount();
        const session = sessionOf(account);
        const refusal = new CustomerAccountAccessError({
          reason: "unverified-email",
        });
        const { layer, calls } = makeCurrentAccount({
          sessions: [session, refusal],
          match: {
            kind: "matched",
            state: "active",
            customerId: uniqueDotyposId(),
          },
        });

        const resolved = await resolve(layer);
        expect(resolved).toMatchObject({
          kind: "unavailable",
          session,
          reviewMarker: "absent",
        });
        expect(resolved.kind === "unavailable" && resolved.failure).toBe(
          refusal
        );
        expect(calls.classify).toEqual([]);
        expect(await storedLink(account.accountId)).toBeNull();
      });

      test("inside an enclosing hold of the same account it resolves under that hold, without a second lock or recheck", async () => {
        const customerId = uniqueDotyposId();
        const account = await seedAccount();
        const session = sessionOf(account);
        const { layer, sections, calls } = makeCurrentAccount({
          sessions: [session],
          match: { kind: "matched", state: "active", customerId },
        });

        const outcome = await Effect.runPromise(
          Effect.gen(function* () {
            const { withActiveAccount } = yield* CustomerAccountSections;
            const { resolve } = yield* CurrentCustomerAccount;
            return yield* withActiveAccount(
              account.accountId,
              Effect.gen(function* () {
                const held = yield* HeldCustomerAccount;
                const standing = yield* resolve;
                const locks = yield* Effect.promise(() =>
                  pool.query<{ granted: number }>(
                    `select count(*)::int as granted
                       from pg_locks
                      where locktype = 'advisory' and granted
                        and classid::bigint = (hashtext('customer-account')::bigint & 4294967295)
                        and objid::bigint = (hashtext($1)::bigint & 4294967295)
                        and objsubid = 2`,
                    [account.accountId]
                  )
                );
                return { held, standing, granted: locks.rows[0]!.granted };
              }),
              { recheck: "active" }
            );
          }).pipe(Effect.provide(Layer.merge(layer, sections)))
        );

        expect(outcome.standing).toMatchObject({
          kind: "linked",
          autoLinked: true,
        });
        expect(outcome.granted).toBe(1);
        // The pre-lock read only: the enclosing `active` hold read no session
        // and the reused hold rechecked nothing.
        expect(calls.sessionReads).toBe(1);
        expect(await storedLink(account.accountId)).toBe(customerId);
      });
    });

    describe("requireActive", () => {
      test("returns the verified session of an account not awaiting deletion", async () => {
        const account = await seedAccount();
        const session = sessionOf(account);
        const { layer } = makeCurrentAccount({ sessions: [session] });

        expect(
          await run(
            layer,
            Effect.flatMap(currentAccount, (current) => current.requireActive)
          )
        ).toEqual(session);
      });

      test("refuses no session, an unverified email, and a pending deletion", async () => {
        const account = await seedAccount({ deletionRequested: true });
        const cases = [
          { session: null, reason: "unauthenticated" },
          {
            session: new CustomerAccountAccessError({
              reason: "unverified-email",
            }),
            reason: "unverified-email",
          },
          {
            session: sessionOf(account, { deletionRequested: true }),
            reason: "link-required",
            linkReason: "deletion-requested",
          },
        ] as const;
        for (const entry of cases) {
          const { layer } = makeCurrentAccount({ sessions: [entry.session] });

          const failure = await failureOf(
            layer,
            (current) => current.requireActive
          );
          expect(failure.reason).toBe(entry.reason);
          expect(failure.linkReason).toBe(
            "linkReason" in entry ? entry.linkReason : undefined
          );
        }
      });
    });

    describe("LinksUnavailable", () => {
      test("keeps the session and marker and reports every link step unavailable", async () => {
        const account = await seedAccount();
        const session = sessionOf(account);
        const layer = CurrentCustomerAccount.LinksUnavailable.pipe(
          Layer.provide(
            Layer.mergeAll(
              Layer.succeed(CustomerAuthentication, {
                currentUser: Effect.succeed(session),
              }),
              ReviewAccounts.Default.pipe(Layer.provide(suiteDatabase.layer))
            )
          )
        );

        for (const standing of [await peek(layer), await resolve(layer)]) {
          expect(standing).toMatchObject({
            kind: "unavailable",
            session,
            reviewMarker: "absent",
          });
          expect(
            standing.kind === "unavailable" && standing.failure.cause?.code
          ).toBe("account-link.lock");
        }
      });
    });
  }
);
